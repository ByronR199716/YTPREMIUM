import { ElectronAPI } from '@electron-toolkit/preload'
import 'noutube/content/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    ytpremium?: { getAccessDevice(): { id: string; name: string } }
  }
}
