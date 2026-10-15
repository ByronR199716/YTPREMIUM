// Pinch in fullscreen to switch the video between "fit" (whole picture, black
// bars) and "fill" (no bars, edges cropped), like the official YouTube app.
// Spreading two fingers fills the screen, pinching them together goes back.
//
// The fill is a scale transform on the <video> element rather than object-fit:
// the mobile player sizes and positions the element itself, and depending on
// the build it either sizes it to the picture or to the screen with the picture
// contained. Scaling by cover/contain ratio around the screen centre gives the
// same result in both cases and leaves YouTube's own layout untouched.

const fillKey = 'nou:fsFill'
const toastId = '_nou_fill_toast'
// Panel and lock overlay from fullscreen-controls.ts: while either is up, its
// own handlers own every touch.
const blockingIds = ['_nou_fs_panel', '_nou_lock_overlay']
const spreadRatio = 1.15
const pinchRatio = 0.87

let pinching = false
let decided = false
let startDistance = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined

const getFullscreenElement = () =>
  (document.fullscreenElement || (document as any).webkitFullscreenElement) as HTMLElement | null

const getVideo = (host: HTMLElement) => {
  const video = host.querySelector('video')
  return video instanceof HTMLVideoElement ? video : null
}

function isFillSaved() {
  try {
    return localStorage.getItem(fillKey) === '1'
  } catch {
    return false
  }
}

function saveFill(fill: boolean) {
  try {
    localStorage.setItem(fillKey, fill ? '1' : '0')
  } catch {}
}

function fillScale(host: HTMLElement, video: HTMLVideoElement) {
  const { videoWidth, videoHeight } = video
  const rect = host.getBoundingClientRect()
  if (!videoWidth || !videoHeight || !rect.width || !rect.height) {
    return 1
  }
  const sx = rect.width / videoWidth
  const sy = rect.height / videoHeight
  const scale = Math.max(sx, sy) / Math.min(sx, sy)
  // A picture that already matches the screen needs nothing; cap the zoom so a
  // vertical video in landscape is not blown up into a few pixels.
  return scale < 1.01 ? 1 : Math.min(scale, 3)
}

function applyFill() {
  const host = getFullscreenElement()
  const video = host && getVideo(host)
  if (!host || !video) {
    return
  }
  const scale = isFillSaved() ? fillScale(host, video) : 1
  if (scale > 1) {
    video.style.setProperty('transform', `scale(${scale.toFixed(4)})`, 'important')
    video.style.setProperty('transform-origin', 'center center', 'important')
    video.dataset.nouFill = '1'
  } else {
    clearFill(video)
  }
}

function clearFill(video: HTMLVideoElement | null) {
  if (video?.dataset.nouFill) {
    video.style.removeProperty('transform')
    video.style.removeProperty('transform-origin')
    delete video.dataset.nouFill
  }
}

function showToast(host: HTMLElement, text: string) {
  let toast = document.getElementById(toastId)
  if (!toast) {
    toast = document.createElement('div')
    toast.id = toastId
    toast.style.cssText =
      'position:absolute;left:50%;top:18%;transform:translateX(-50%);z-index:2147483647;' +
      'background:rgba(0,0,0,.7);color:#fff;font:500 14px/1.2 Roboto,Arial,sans-serif;' +
      'padding:8px 14px;border-radius:16px;pointer-events:none;transition:opacity .2s;'
  }
  if (toast.parentElement !== host) {
    host.append(toast)
  }
  toast.textContent = text
  toast.style.opacity = '1'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (toast) toast.style.opacity = '0'
  }, 1200)
}

function setFill(fill: boolean) {
  const host = getFullscreenElement()
  if (!host) {
    return
  }
  saveFill(fill)
  applyFill()
  showToast(host, fill ? 'Ampliado para llenar la pantalla' : 'Original')
}

const distance = (touches: TouchList) =>
  Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

const isActive = () => {
  const host = getFullscreenElement()
  return Boolean(host && getVideo(host) && !blockingIds.some((id) => document.getElementById(id)))
}

function swallow(event: TouchEvent) {
  // Keeps YouTube's tap/double-tap handlers out of the gesture and stops the
  // WebView from zooming the page instead.
  event.stopImmediatePropagation()
  if (event.cancelable) {
    event.preventDefault()
  }
}

function onTouchStart(event: TouchEvent) {
  if (event.touches.length === 2 && isActive()) {
    pinching = true
    decided = false
    startDistance = distance(event.touches)
    swallow(event)
  } else if (pinching) {
    swallow(event)
  }
}

function onTouchMove(event: TouchEvent) {
  if (!pinching) {
    return
  }
  swallow(event)
  if (decided || event.touches.length < 2 || !startDistance) {
    return
  }
  const ratio = distance(event.touches) / startDistance
  if (ratio >= spreadRatio) {
    decided = true
    if (!isFillSaved()) setFill(true)
  } else if (ratio <= pinchRatio) {
    decided = true
    if (isFillSaved()) setFill(false)
  }
}

function onTouchEnd(event: TouchEvent) {
  if (!pinching) {
    return
  }
  swallow(event)
  if (event.touches.length === 0) {
    pinching = false
  }
}

export function installPinchToFill() {
  // Android only: the desktop player has no touch fullscreen to speak of.
  if (!window.isAndroid) {
    return
  }
  const options = { capture: true, passive: false }
  document.addEventListener('touchstart', onTouchStart, options)
  document.addEventListener('touchmove', onTouchMove, options)
  document.addEventListener('touchend', onTouchEnd, options)
  document.addEventListener('touchcancel', onTouchEnd, options)

  const onFullscreenChange = () => {
    pinching = false
    if (getFullscreenElement()) {
      applyFill()
    } else {
      clearFill(document.querySelector<HTMLVideoElement>('video[data-nou-fill]'))
      document.getElementById(toastId)?.remove()
    }
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  // Rotation changes the screen shape, and a new video can change the picture's.
  window.addEventListener('resize', () => setTimeout(applyFill, 100))
  document.addEventListener(
    'loadedmetadata',
    () => {
      if (getFullscreenElement()) applyFill()
    },
    true,
  )
}
