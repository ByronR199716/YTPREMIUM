import { app, net, session, type WebContents } from 'electron'
import {
  RE_INTERCEPT,
  transformBrowseResponse,
  transformGetWatchResponse,
  transformPlayerResponse,
  transformReelResponse,
  transformSearchResponse,
} from 'noutube/lib/intercept'
import { createDefaultBlocklistSnapshot, normalizeBlocklist, type BlocklistSnapshot } from 'noutube/lib/blocklist'

let currentBlocklist = createDefaultBlocklistSnapshot()
// Ad blocking is opt-out and separate from the interception itself, which the
// blocklist and the title rewriting need either way (see states/settings.ts).
let transformOptions = { blockAds: true }

export function setInterceptionBlocklist(blocklist?: BlocklistSnapshot) {
  currentBlocklist = normalizeBlocklist(blocklist)
}

export function setInterceptionBlockAds(enabled: boolean) {
  transformOptions = { blockAds: enabled !== false }
}

function findJsonBounds(text: string, startIndex: number) {
  let braceCount = 0
  let inString = false
  let stringChar = ''
  let escaped = false
  const jsonStart = text.indexOf('{', startIndex)
  if (jsonStart === -1) return null

  for (let i = jsonStart; i < text.length; i++) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (inString) {
      if (char === stringChar) {
        inString = false
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      inString = true
      stringChar = char
      continue
    }
    if (char === '{') {
      braceCount++
    } else if (char === '}') {
      braceCount--
      if (braceCount === 0) {
        return { start: jsonStart, end: i + 1 }
      }
    }
  }
  return null
}

// JSON.stringify happily emits `<`, which would end the inline <script> early.
// YouTube itself escapes these, so mirror that.
function escapeForScriptTag(json: string) {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

function transformEmbeddedJson(html: string, key: string, transform: (json: string) => string) {
  let index = html.indexOf(`var ${key} =`)
  if (index === -1) {
    index = html.indexOf(`${key} =`)
    if (index === -1) {
      return html
    }
  }

  const bounds = findJsonBounds(html, index)
  if (!bounds) {
    return html
  }

  try {
    const transformed = escapeForScriptTag(transform(html.slice(bounds.start, bounds.end)))
    return html.slice(0, bounds.start) + transformed + html.slice(bounds.end)
  } catch (e) {
    console.error(`Failed to transform ${key} inside HTML:`, e)
    return html
  }
}

function transformHtml(html: string) {
  // ytInitialData carries the server-rendered feed (home, subscriptions, watch
  // sidebar), which is where feed ads and blocklisted items come from on first
  // paint; continuations go through /youtubei/v1/browse below.
  const withoutAds = transformEmbeddedJson(html, 'ytInitialData', (json) =>
    transformBrowseResponse(json, currentBlocklist, transformOptions),
  )
  return transformEmbeddedJson(withoutAds, 'ytInitialPlayerResponse', (json) =>
    transformPlayerResponse(json, undefined, transformOptions),
  )
}

function isYouTubeHost(url: string) {
  try {
    const { hostname } = new URL(url)
    return hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
  } catch {
    return false
  }
}

function getTransformTarget(url: string) {
  const { hostname, pathname } = new URL(url)
  const isYT = hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
  if (!isYT) {
    return null
  }

  const match = pathname.match(RE_INTERCEPT)
  if (pathname.startsWith('/watch') || match) {
    return { pathname, match }
  }

  return null
}

// Any YouTube page navigation, so the server-rendered ytInitialData of the home
// feed gets filtered too, not just /watch.
function isDocumentRequest(req: Request) {
  if (req.method !== 'GET') {
    return false
  }
  return (req.headers.get('accept') || '').includes('text/html')
}

export function interceptHttpRequest() {
  const ses = session.fromPartition('persist:webview')

  ses.setCertificateVerifyProc((request, callback) => {
    if (
      request.hostname.endsWith('.youtube.com') ||
      request.hostname.endsWith('.googlevideo.com') ||
      request.hostname.endsWith('.ytimg.com') ||
      request.hostname.endsWith('.ggpht.com') ||
      request.hostname === 'youtube.com'
    ) {
      callback(0)
    } else {
      callback(-3)
    }
  })

  if (ses.protocol.isProtocolHandled('https')) {
    return
  }

  ses.protocol.handle('https', async (req) => {
    // Keep signed media/CDN requests out of YouTube session rewriting.
    if (!isYouTubeHost(req.url)) {
      return net.fetch(req, {
        bypassCustomProtocolHandlers: true,
      })
    }

    const target = getTransformTarget(req.url)
    const isDocument = isDocumentRequest(req)
    if (!target && !isDocument) {
      return ses.fetch(req, {
        bypassCustomProtocolHandlers: true,
      })
    }

    let res: Response
    try {
      res = await ses.fetch(req, {
        bypassCustomProtocolHandlers: true,
      })
    } catch (e) {
      console.error(`Interception fetch failed for ${req.url}:`, e)
      return Response.error()
    }

    const isHtml = (res.headers.get('content-type') || '').includes('text/html')
    if (res.status > 200 || (!isHtml && !target?.match)) {
      return res
    }

    const match = target?.match
    const text = await res.text()
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    headers.delete('transfer-encoding')
    const responseInit = {
      status: res.status,
      headers,
    }
    try {
      if (isHtml) {
        return new Response(transformHtml(text), responseInit)
      }

      if (match) {
        switch (match[1]) {
          case 'browse':
          case 'next':
            return new Response(transformBrowseResponse(text, currentBlocklist, transformOptions), responseInit)
          case 'search':
            return new Response(transformSearchResponse(text, currentBlocklist, transformOptions), responseInit)
          case 'get_watch':
            return new Response(transformGetWatchResponse(text, transformOptions), responseInit)
          case 'reel':
            return new Response(transformReelResponse(text, currentBlocklist, transformOptions), responseInit)
          default:
            return new Response(transformPlayerResponse(text, undefined, transformOptions), responseInit)
        }
      }
    } catch (e) {
      console.error(e)
    }
    return new Response(text, responseInit)
  })
}

export function toggleInterception(enabled: boolean) {
  if (enabled) {
    interceptHttpRequest()
  } else {
    const ses = session.fromPartition('persist:webview')
    if (ses.protocol.isProtocolHandled('https')) {
      ses.protocol.unhandle('https')
    }
  }
}

// YTPremium: Google sign-in never happens inside the YouTube tabs.
// - The https handler above breaks it (Google's cookies land in the wrong
//   jar: "401 ... formato incorrecto").
// - Google refuses embedded Chromium ("No puedes acceder").
// - Switching the tab's user agent in the middle of the redirect chain makes
//   Chromium reload the page and the sign-in hangs.
// So any tab navigation to accounts.google.com is cancelled and the sign-in
// opens in its own window (login-window.ts), which is Firefox for its whole
// life and runs with the interception off.
function isSignInUrl(url: string) {
  try {
    return new URL(url).hostname === 'accounts.google.com'
  } catch {
    return false
  }
}

let pendingSignIn = false
let pendingSignOut = false

// YouTube's own "Salir" (youtube.com/logout → accounts.google.com/Logout) and
// Google's "Agregar cuenta" (AddSession): both mean a different account is
// next, so the app wipes Google's memory of this browser first (sign-out.ts).
function isSignOutUrl(url: string) {
  try {
    const { hostname, pathname } = new URL(url)
    const path = pathname.toLowerCase()
    if (hostname === 'accounts.google.com') {
      return path.startsWith('/logout')
    }
    return (
      (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) && (path === '/logout' || path.startsWith('/logout/'))
    )
  } catch {
    return false
  }
}

function isAddAccountUrl(url: string) {
  try {
    const { hostname, pathname, search } = new URL(url)
    return hostname === 'accounts.google.com' && /addsession/i.test(pathname + search)
  } catch {
    return false
  }
}

function signOutLater(then?: () => void) {
  if (pendingSignOut) return
  pendingSignOut = true
  setTimeout(() => {
    void import('./sign-out')
      .then(({ signOutAll }) => signOutAll())
      .catch((e) => console.error('Sign-out failed:', e))
      .finally(() => {
        pendingSignOut = false
        then?.()
      })
  }, 0)
}

// Never stop or start navigations from inside a navigation event: Chromium
// crashes the whole app if a navigation is cancelled while it is still being
// set up (the app closed as soon as "Acceder" was clicked in pc-build-7).
// Only the cancellable events call preventDefault; everything else is
// deferred to the next turn of the event loop.
function openSignInLater(url?: string) {
  if (pendingSignIn) return
  pendingSignIn = true
  setTimeout(() => {
    pendingSignIn = false
    void import('./login-window')
      .then(({ openLoginWindow }) => openLoginWindow(url))
      .catch((e) => console.error('Sign-in window failed:', e))
  }, 0)
}

function navigationDetails(event: any, legacyUrl?: string, legacyMainFrame?: boolean) {
  const url: string | undefined = event?.url ?? legacyUrl
  const isMainFrame: boolean | undefined = event?.isMainFrame ?? legacyMainFrame
  return { url, isMainFrame }
}

function watchWebview(contents: WebContents) {
  // Cancellable: the tab stays where it was and the sign-in window opens.
  const onCancellable = (event: any, legacyUrl?: string, _inPlace?: boolean, legacyMainFrame?: boolean) => {
    const { url, isMainFrame } = navigationDetails(event, legacyUrl, legacyMainFrame)
    if (!url || isMainFrame === false) return
    if (isSignOutUrl(url)) {
      event?.preventDefault?.()
      signOutLater()
      return
    }
    if (!isSignInUrl(url)) return
    event?.preventDefault?.()
    if (isAddAccountUrl(url)) {
      signOutLater(() => openSignInLater())
      return
    }
    openSignInLater(url)
  }
  contents.on('will-navigate', onCancellable)
  contents.on('will-redirect', onCancellable)

  // Anything that still ends up on Google inside a tab (typed URL, loadURL):
  // once it has committed, go back and open the sign-in window instead.
  contents.on('did-navigate', (_event, url) => {
    if (isSignOutUrl(url)) {
      signOutLater()
      return
    }
    if (!isSignInUrl(url)) return
    setTimeout(() => {
      if (contents.isDestroyed()) return
      if (contents.navigationHistory?.canGoBack?.()) {
        contents.navigationHistory.goBack()
      } else {
        contents.loadURL('https://www.youtube.com/')
      }
    }, 0)
    openSignInLater(url)
  })
}

let watchingWebviews = false

export function watchWebviewNavigations() {
  if (watchingWebviews) return
  watchingWebviews = true
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      watchWebview(contents)
    }
  })
}
