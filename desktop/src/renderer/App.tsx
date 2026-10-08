import contentJs from 'noutube/assets/scripts/main.bjs?raw'
import { MainPage } from 'noutube/components/page/MainPage'
import { Toaster } from 'react-hot-toast'
import { useObserveEffect } from '@legendapp/state/react'
import { useEffect } from 'react'
import { initUiChannel } from './ipc/ui'
import { handleShortcuts } from './lib/shortcuts'
import { AccessGate } from 'noutube/components/access/AccessGate'

function App(): React.JSX.Element {
  useEffect(() => {
    initUiChannel()
    window.addEventListener('keyup', handleShortcuts)
    return () => window.removeEventListener('keyup', handleShortcuts)
  }, [])

  return (
    <>
      <AccessGate>
        <MainPage contentJs={contentJs} />
      </AccessGate>
      <Toaster position="bottom-right" />
    </>
  )
}
export default App
