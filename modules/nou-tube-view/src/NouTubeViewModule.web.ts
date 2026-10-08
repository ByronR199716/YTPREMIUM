import { registerWebModule, NativeModule } from 'expo'

class NouTubeViewModule extends NativeModule {
  setSettings() {}

  extractTakeoutCsvFiles() {
    throw new Error('extractTakeoutCsvFiles is only available on Android')
  }

  async setSleepTimer() {
    throw new Error('sleep timer is only available on Android')
  }

  async clearSleepTimer() {
    throw new Error('sleep timer is only available on Android')
  }

  async getSleepTimerRemainingMs() {
    return null
  }

  getSystemCaptionStyle() {
    return null
  }

  getAccessDevice() {
    // Versión de escritorio (Electron): el preload expone el ID de la PC.
    const desktop = (globalThis as any).ytpremium?.getAccessDevice?.()
    if (desktop?.id) return desktop as { id: string; name: string }
    return { id: '', name: 'Web' }
  }
}

export default registerWebModule(NouTubeViewModule, 'NouTubeViewModule')
