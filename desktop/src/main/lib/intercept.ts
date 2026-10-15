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

// YTPremium: Google sign-in (accounts.google.com and friends) must never go
// through the https handler above. Its non-YouTube branch fetches with the
// default session and follows redirects itself, so Google's cookies end up in
// the wrong jar and the sign-in pages answer "401 ... formato incorrecto".
// The renderer turns interception off on did-navigate, which is too late: the
// first request to accounts.google.com has already gone through the handler.
// Here it is turned off as soon as a webview starts (or is redirected to) a
// main-frame navigation outside YouTube; the renderer turns it back on when
// the tab is back on YouTube.
function isYouTubeNavigation(url: string) {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'https:' && protocol !== 'http:') return true
    return (
      hostname === 'youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'music.youtube.com' ||
      hostname === 'youtu.be'
    )
  } catch {
    return true
  }
}

function watchWebview(contents: WebContents) {
  const onNavigation = (event: any, legacyUrl?: string, _inPlace?: boolean, legacyMainFrame?: boolean) => {
    const url: string | undefined = event?.url ?? legacyUrl
    const isMainFrame: boolean | undefined = event?.isMainFrame ?? legacyMainFrame
    const isSameDocument: boolean | undefined = event?.isSameDocument ?? _inPlace
    if (!url || isMainFrame === false || isSameDocument) return
    if (!isYouTubeNavigation(url)) {
      toggleInterception(false)
    }
    applySignInUserAgent(contents, url)
  }
  contents.on('did-start-navigation', onNavigation)
  contents.on('will-redirect', onNavigation)
}

// Google refuses to sign in from embedded Chromium ("No puedes acceder… es
// posible que no sean seguros este navegador o la app"). It does not run that
// check against Firefox, so the Google sign-in pages are asked for as Firefox,
// without Chromium client hints; the tab goes back to its own user agent as
// soon as it leaves accounts.google.com.
const SIGN_IN_USER_AGENT =
  process.platform === 'darwin'
    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:151.0) Gecko/20100101 Firefox/151.0'
    : process.platform === 'linux'
      ? 'Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0'

const SIGN_IN_HOSTS = ['accounts.google.com']

function isSignInUrl(url: string) {
  try {
    return SIGN_IN_HOSTS.includes(new URL(url).hostname)
  } catch {
    return false
  }
}

const originalUserAgents = new WeakMap<WebContents, string>()

function applySignInUserAgent(contents: WebContents, url: string) {
  if (isSignInUrl(url)) {
    if (!originalUserAgents.has(contents)) {
      originalUserAgents.set(contents, contents.getUserAgent())
      contents.setUserAgent(SIGN_IN_USER_AGENT)
    }
  } else {
    const original = originalUserAgents.get(contents)
    if (original !== undefined) {
      originalUserAgents.delete(contents)
      contents.setUserAgent(original)
    }
  }
}

let signInHeadersInstalled = false

function installSignInHeaders() {
  if (signInHeadersInstalled) return
  signInHeadersInstalled = true
  const ses = session.fromPartition('persist:webview')
  ses.webRequest.onBeforeSendHeaders({ urls: SIGN_IN_HOSTS.map((host) => `https://${host}/*`) }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase()
      if (lower === 'user-agent' || lower.startsWith('sec-ch-ua')) {
        delete headers[name]
      }
    }
    headers['User-Agent'] = SIGN_IN_USER_AGENT
    callback({ requestHeaders: headers })
  })
}

let watchingWebviews = false

export function watchWebviewNavigations() {
  if (watchingWebviews) return
  watchingWebviews = true
  installSignInHeaders()
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      watchWebview(contents)
    }
  })
}
