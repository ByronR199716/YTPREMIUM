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
    return { id: '', name: 'Web' }
  }
}

export default registerWebModule(NouTubeViewModule, 'NouTubeViewModule')
