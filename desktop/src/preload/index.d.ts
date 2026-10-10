import { ElectronAPI } from '@electron-toolkit/preload'
import 'noutube/content/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    ytpremium?: {
      getAccessDevice(): { id: string; name: string }
      appUpdate: {
        info(): { versionCode: number; supported: boolean }
        download(url: string): Promise<{ size: number }>
        install(): Promise<void>
        onProgress(cb: (p: { progress: number }) => void): () => void
      }
    }
  }
}
