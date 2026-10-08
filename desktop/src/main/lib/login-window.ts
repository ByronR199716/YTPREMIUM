import { BrowserWindow } from 'electron'
import { toggleInterception } from './intercept'

export async function openLoginWindow() {
  toggleInterception(false)
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      partition: 'persist:webview',
    },
  })
  await win.loadURL('https://www.youtube.com')
  win.setTitle('Cuando inicies sesión, cierra esta ventana y vuelve a abrir YTPremium')
}
