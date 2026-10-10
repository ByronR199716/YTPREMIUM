import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Acceso por códigos (YTPremium): ID de esta PC. Solo para la ventana de la app,
// no para las páginas de YouTube (este preload también se carga en los webview).
const ACCESS_DEVICE_CHANNEL = 'ytpremium-access-device'
const isAppPage = location.protocol === 'file:' || location.hostname === 'localhost'
// Aviso de nueva versión (ver src/main/lib/app-update.ts).
const UPDATE = {
  info: 'ytpremium-update-info',
  download: 'ytpremium-update-download',
  install: 'ytpremium-update-install',
  progress: 'ytpremium-update-progress',
}
const ytpremium = {
  getAccessDevice: (): { id: string; name: string } => ipcRenderer.sendSync(ACCESS_DEVICE_CHANNEL),
  appUpdate: {
    info: (): { versionCode: number; supported: boolean } => ipcRenderer.sendSync(UPDATE.info),
    download: (url: string): Promise<{ size: number }> => ipcRenderer.invoke(UPDATE.download, url),
    install: (): Promise<void> => ipcRenderer.invoke(UPDATE.install),
    onProgress: (cb: (p: { progress: number }) => void): (() => void) => {
      const listener = (_: unknown, p: { progress: number }): void => cb(p)
      ipcRenderer.on(UPDATE.progress, listener)
      return () => ipcRenderer.removeListener(UPDATE.progress, listener)
    },
  },
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
