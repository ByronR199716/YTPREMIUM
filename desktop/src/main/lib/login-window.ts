import { BrowserWindow, session, webContents } from 'electron'
import { setInterceptionLocked, toggleInterception } from './intercept'
import { mainWindow } from './main-window'

// Google blocks sign-in from embedded Chromium but not from Firefox. The
// window is Firefox from its first request to its last, so Google never sees
// the identity change halfway through the redirect chain.
const SIGN_IN_USER_AGENT =
  process.platform === 'darwin'
    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:151.0) Gecko/20100101 Firefox/151.0'
    : process.platform === 'linux'
      ? 'Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0'

const DEFAULT_SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Des%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F&hl=es'

let loginWindow: BrowserWindow | null = null
let reloadTabsOnClose = true

export function closeLoginWindow({ reloadTabs = true } = {}) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    reloadTabsOnClose = reloadTabs
    loginWindow.close()
  }
}
let headersInstalled = false

function installSignInHeaders() {
  if (headersInstalled) return
  headersInstalled = true
  const ses = session.fromPartition('persist:webview')
  // Only Google's sign-in hosts. Without a filter this ran on the main thread
  // for every thumbnail and video chunk of the YouTube tabs too, and typing in
  // the sign-in window lagged 3–4 s behind. Requests of other windows on
  // these hosts pass through unchanged.
  const filter = {
    urls: [
      'https://accounts.google.com/*',
      'https://*.google.com/*',
      'https://*.gstatic.com/*',
      'https://*.googleusercontent.com/*',
      'https://accounts.youtube.com/*',
    ],
  }
  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (!loginWindow || loginWindow.isDestroyed() || details.webContentsId !== loginWindow.webContents.id) {
      callback({})
      return
    }
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

function isSignedInLanding(url: string) {
  try {
    const { hostname, pathname } = new URL(url)
    const isYouTube = hostname === 'www.youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtube.com'
    return isYouTube && !pathname.startsWith('/signin')
  } catch {
    return false
  }
}

// A playing video keeps the app busy downloading while the user types the
// email; the tabs are reloaded once the sign-in window closes anyway.
function pauseYouTubeTabs() {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.getType() === 'webview' && !contents.isDestroyed()) {
      contents
        .executeJavaScript('document.querySelectorAll("video,audio").forEach((m) => { try { m.pause() } catch {} })', false)
        .catch(() => {})
    }
  }
}

function reloadYouTubeTabs() {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.getType() === 'webview' && !contents.isDestroyed()) {
      contents.reload()
    }
  }
}

export async function openLoginWindow(url = DEFAULT_SIGN_IN_URL) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }
  setInterceptionLocked(true)
  toggleInterception(false)
  installSignInHeaders()
  pauseYouTubeTabs()
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    autoHideMenuBar: true,
    title: 'Iniciar sesión — YTPremium',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      partition: 'persist:webview',
    },
  })
  loginWindow = win
  win.webContents.setUserAgent(SIGN_IN_USER_AGENT)
  win.on('page-title-updated', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  let done = false
  const finish = () => {
    if (done) return
    done = true
    if (!win.isDestroyed()) win.close()
  }
  // Google is done once the window lands back on a YouTube page.
  win.webContents.on('did-navigate', (_event, navigatedUrl) => {
    if (isSignedInLanding(navigatedUrl)) {
      win.webContents.once('did-finish-load', finish)
      setTimeout(finish, 5000)
    }
  })
  win.on('closed', () => {
    loginWindow = null
    setInterceptionLocked(false)
    toggleInterception(true)
    if (reloadTabsOnClose) reloadYouTubeTabs()
    reloadTabsOnClose = true
  })

  // Google's redirects abort the first load (ERR_ABORTED); that is expected.
  await win.loadURL(url, { userAgent: SIGN_IN_USER_AGENT }).catch(() => {})
}
