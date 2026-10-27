import { session, webContents } from 'electron'
import { closeLoginWindow } from './login-window'

// Google remembers the "browser" through its own cookies, which stay after a
// plain YouTube sign-out. A second account signing in on a browser Google
// already knows gets its strictest check, and that check catches the embedded
// browser ("No puedes acceder"). The very first sign-in on a clean app works,
// so signing out wipes every Google/YouTube trace and the next sign-in is a
// first one again.
const GOOGLE_DOMAINS = ['google.com', 'youtube.com', 'googlevideo.com', 'ytimg.com', 'ggpht.com', 'gstatic.com']

function isGoogleDomain(domain = '') {
  const host = domain.replace(/^\./, '')
  return GOOGLE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) || /(^|\.)google\.[a-z.]+$/.test(host)
}

let signingOut: Promise<void> | null = null

export function signOutAll() {
  signingOut ??= doSignOut().finally(() => {
    signingOut = null
  })
  return signingOut
}

async function doSignOut() {
  closeLoginWindow({ reloadTabs: false })

  // The YouTube tabs and the sign-in window: nothing else lives here.
  const webviewSession = session.fromPartition('persist:webview')
  // Everything except the HTTP cache: the cache holds no identity, and keeping
  // it lets Google's sign-in page (and YouTube) load fast the next time.
  await webviewSession
    .clearData({
      dataTypes: [
        'backgroundFetch',
        'cookies',
        'downloads',
        'fileSystems',
        'indexedDB',
        'localStorage',
        'serviceWorkers',
        'webSQL',
      ],
    })
    .catch((e) => console.error('clearData failed:', e))
  await webviewSession.clearAuthCache().catch(() => {})
  webviewSession.flushStorageData()

  // The default session also holds the access code and settings, so only its
  // Google cookies go (older builds leaked some there).
  const defaultSession = session.defaultSession
  const cookies = await defaultSession.cookies.get({}).catch(() => [])
  await Promise.all(
    cookies
      .filter((cookie) => isGoogleDomain(cookie.domain))
      .map((cookie) => {
        const host = (cookie.domain || '').replace(/^\./, '')
        const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`
        return defaultSession.cookies.remove(url, cookie.name).catch(() => {})
      }),
  )
  defaultSession.flushStorageData()

  for (const contents of webContents.getAllWebContents()) {
    if (contents.getType() !== 'webview' || contents.isDestroyed()) continue
    let target = 'https://www.youtube.com/'
    try {
      if (new URL(contents.getURL()).hostname === 'music.youtube.com') {
        target = 'https://music.youtube.com/'
      }
    } catch {}
    contents.loadURL(target).catch(() => {})
  }
}
