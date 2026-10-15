// Pinch in fullscreen to switch the video between "fit" (whole picture, black
// bars) and "fill" (no bars, edges cropped), like the official YouTube app.
// Spreading two fingers fills the screen, pinching them together goes back.
//
// Nothing about YouTube's layout is assumed: the visible picture is measured on
// screen (the <video> box, its object-fit and the stream's own aspect), and the
// video's container is scaled and shifted so that picture covers the
// fullscreen element, centred. The result is measured again and corrected, so
// sizes or transforms YouTube puts on the player do not throw it off.

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

type Box = { x: number; y: number; w: number; h: number }

// The part of the <video> box the picture actually occupies.
function pictureBox(video: HTMLVideoElement): Box | null {
  const r = video.getBoundingClientRect()
  const { videoWidth: iw, videoHeight: ih } = video
  if (!iw || !ih || !r.width || !r.height) {
    return null
  }
  const fit = getComputedStyle(video).objectFit
  if (fit === 'fill' || fit === 'cover') {
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }
  const k = Math.min(r.width / iw, r.height / ih)
  const w = iw * k
  const h = ih * k
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h }
}

const getTarget = (video: HTMLVideoElement) =>
  (video.parentElement?.classList.contains('html5-video-container') ? video.parentElement : video) as HTMLElement

function clearFill() {
  document.querySelectorAll<HTMLElement>('[data-nou-fill]').forEach((el) => {
    el.style.removeProperty('transform')
    el.style.removeProperty('transform-origin')
    delete el.dataset.nouFill
  })
}

function applyFill() {
  const host = getFullscreenElement()
  const video = host && getVideo(host)
  clearFill()
  if (!host || !video || !isFillSaved()) {
    return
  }
  const screen = host.getBoundingClientRect()
  const target = getTarget(video)
  let scale = 1
  let tx = 0
  let ty = 0
  // Two passes: the first from the untouched layout, the second corrects for
  // anything the first could not see (transforms on the player, rounding).
  for (let pass = 0; pass < 2; pass++) {
    const pic = pictureBox(video)
    if (!pic || !screen.width || !screen.height) {
      break
    }
    const k = Math.max(screen.width / pic.w, screen.height / pic.h)
    const cx = screen.left + screen.width / 2 - (pic.x + pic.w / 2)
    const cy = screen.top + screen.height / 2 - (pic.y + pic.h / 2)
    if (pass === 1 && Math.abs(k - 1) < 0.005 && Math.abs(cx) < 1 && Math.abs(cy) < 1) {
      break
    }
    // Scale around the picture's centre, then move that centre to the screen's.
    // In the target's own (pre-transform) coordinates, with origin at its
    // top-left corner and the current transform already applied.
    const box = target.getBoundingClientRect()
    const ox = (pic.x + pic.w / 2 - box.left) / (box.width / target.offsetWidth || 1)
    const oy = (pic.y + pic.h / 2 - box.top) / (box.height / target.offsetHeight || 1)
    const ps = scale
    scale = ps * k
    tx = tx + (ox * ps) * (1 - k) + cx
    ty = ty + (oy * ps) * (1 - k) + cy
    if (scale < 1.01 && pass === 0) {
      // The picture already fills the screen.
      return
    }
    scale = Math.min(scale, 3)
    target.style.setProperty('transform-origin', '0 0', 'important')
    target.style.setProperty(
      'transform',
      `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(4)})`,
      'important',
    )
    target.dataset.nouFill = '1'
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

// YouTube speeds the video up to 2x while one finger is held on the player.
// The first finger of a pinch lands alone, so YouTube starts that hold before
// the second one arrives, and since the rest of the gesture is swallowed it
// never sees the finger lift. So: remember the speed while a single finger is
// down, tell YouTube that touch was cancelled as soon as it becomes a pinch,
// and put the speed back when the pinch ends.
let rateBeforeTouch: number | undefined
let cancelling = false

function getRate() {
  const host = getFullscreenElement()
  const video = host && getVideo(host)
  return video?.playbackRate
}

function restoreRate() {
  const rate = rateBeforeTouch
  if (!rate) {
    return
  }
  const host = getFullscreenElement()
  const video = host && getVideo(host)
  const player: any = document.getElementById('movie_player')
  if (video && Math.abs(video.playbackRate - rate) > 0.01) {
    if (typeof player?.setPlaybackRate == 'function') {
      player.setPlaybackRate(rate)
    }
    video.playbackRate = rate
  }
}

function cancelHeldTouch(event: TouchEvent) {
  const first = event.touches[0]
  const target = first?.target
  if (!first || !target) {
    return
  }
  cancelling = true
  try {
    target.dispatchEvent(
      new TouchEvent('touchcancel', {
        bubbles: true,
        cancelable: false,
        composed: true,
        touches: [],
        targetTouches: [],
        changedTouches: [first],
      }),
    )
  } catch {
    // Older WebViews without the TouchEvent constructor: restoreRate covers it.
  } finally {
    cancelling = false
  }
}

function onTouchStart(event: TouchEvent) {
  if (cancelling) {
    return
  }
  if (event.touches.length === 1 && !pinching) {
    rateBeforeTouch = getRate()
  }
  if (event.touches.length === 2 && isActive()) {
    pinching = true
    decided = false
    startDistance = distance(event.touches)
    swallow(event)
    cancelHeldTouch(event)
    restoreRate()
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
  if (cancelling || !pinching) {
    return
  }
  swallow(event)
  if (event.touches.length === 0) {
    pinching = false
    // The hold timer may have fired just before the cancel landed.
    restoreRate()
    setTimeout(restoreRate, 150)
    setTimeout(restoreRate, 600)
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
      clearFill()
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
