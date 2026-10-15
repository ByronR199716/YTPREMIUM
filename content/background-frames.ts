// YouTube Music finishes a skip (queue update, loading the next song) inside
// requestAnimationFrame callbacks. Android draws no frames for an app in the
// background, so those callbacks wait until the app is opened again: the first
// "next" from the notification may go through, the rest pile up and all fire at
// once when the user comes back.
//
// While the app is in the background (window.NouTubeBackground, set by the
// native side), every frame callback also gets a timer, and whichever comes
// first runs it. In the foreground real frames always win, so nothing changes
// there; in the background YouTube Music keeps working at a few frames per
// second instead of freezing.

const backgroundFrameMs = 100

type FrameCallback = (time: number) => void

export function installBackgroundFrames() {
  const root = window as Window & typeof globalThis & { __nouBackgroundFrames?: boolean }
  if (!window.isAndroid || root.__nouBackgroundFrames) {
    return
  }
  root.__nouBackgroundFrames = true

  const nativeRequest = window.requestAnimationFrame.bind(window)
  const nativeCancel = window.cancelAnimationFrame.bind(window)
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  window.requestAnimationFrame = (callback: FrameCallback) => {
    if (window.NouTubeBackground !== true) {
      return nativeRequest(callback)
    }
    let done = false
    const run = (time: number) => {
      if (done) return
      done = true
      clearTimeout(timers.get(id))
      timers.delete(id)
      callback(time)
    }
    const id = nativeRequest(run)
    timers.set(
      id,
      setTimeout(() => {
        nativeCancel(id)
        run(performance.now())
      }, backgroundFrameMs),
    )
    return id
  }

  window.cancelAnimationFrame = (id: number | null | undefined) => {
    if (id == null) {
      return
    }
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
    nativeCancel(id)
  }
}
