import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Acceso por códigos (YTPremium): ID de esta PC. Solo para la ventana de la app,
// no para las páginas de YouTube (este preload también se carga en los webview).
const ACCESS_DEVICE_CHANNEL = 'ytpremium-access-device'
const isAppPage = location.protocol === 'file:' || location.hostname === 'localhost'
const ytpremium = {
  getAccessDevice: (): { id: string; name: string } => ipcRenderer.sendSync(ACCESS_DEVICE_CHANNEL),
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    if (isAppPage) contextBridge.exposeInMainWorld('ytpremium', ytpremium)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  if (isAppPage) window.ytpremium = ytpremium
}
