import { preparePictureInPicture, setPictureInPicture, watchPictureInPictureVideo } from './picture-in-picture'
import {
  hideShorts,
  showShorts,
} from './css'
import { playDefaultAudio, restoreLastPlaying } from './player'
import { getPlayerFormats } from './player-formats'
import { emit, isYTMusic } from './utils'
import { createDefaultUserStylesSnapshot, type UserStylesSnapshot } from '../lib/user-styles'
import { createDefaultBlocklistSnapshot, type BlocklistSnapshot } from '../lib/blocklist'

export const noutubeSettingsEvent = 'noutube:settings'
export const noutubeUserStylesEvent = 'noutube:user-styles'
export const noutubeBlocklistEvent = 'noutube:blocklist'

let settings: Record<string, unknown> = {}
let userStyles = createDefaultUserStylesSnapshot()
let blocklist = createDefaultBlocklistSnapshot()

const getPlayer = (): any => document.getElementById('movie_player')

let bridged = false
function bridgeShortcuts() {
  if (bridged) {
    return
  }
  bridged = true
  window.addEventListener('keyup', (e) => {
    emit('keyup', { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey })
  })
  window.addEventListener('paste', (e) => {
    /* Leave pastes into YouTube's search box, comment box etc. alone. */
    if (isEditable(e.target) || isEditable(document.activeElement)) {
      return
    }
    const text = e.clipboardData?.getData('text')
    if (text) {
      emit('paste', text)
    }
  })
}

function isEditable(target: any) {
  if (!target) {
    return false
  }
  const tag = target.tagName?.toUpperCase?.()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
}

function getSettings() {
  return settings
}

function setSettings(next: Record<string, unknown> = {}) {
  settings = { ...settings, ...next }
  window.dispatchEvent(new CustomEvent(noutubeSettingsEvent, { detail: settings }))
  return settings
}

function getUserStyles() {
  return userStyles
}

function setUserStyles(next?: UserStylesSnapshot) {
  userStyles = next || createDefaultUserStylesSnapshot()
  window.dispatchEvent(new CustomEvent(noutubeUserStylesEvent, { detail: userStyles }))
  return userStyles
}

function getBlocklist() {
  return blocklist
}

function setBlocklist(next?: BlocklistSnapshot) {
  blocklist = next || createDefaultBlocklistSnapshot()
  window.dispatchEvent(new CustomEvent(noutubeBlocklistEvent, { detail: blocklist }))
  return blocklist
}

function skipToPrevious() {
  const player = getPlayer()
  // YouTube restarts the current video instead of going back once it has
  // played a few seconds; rewinding first makes one press go back.
  player?.seekTo?.(0)
  player?.previousVideo()
}

// The skip itself, once the app has ruled out its own queue (NouTube.next()
// asks the app first). nextVideo() only walks the player's own playlist:
// - YouTube Music keeps the real "Up next" queue (shuffle included) in its own
//   UI, so the player's playlist can be empty or stale. Pressing its own next
//   button is what the user would do, and works in the background too.
// - A lone m.youtube.com video has no playlist at all; the next song is the
//   one autoplay starts at the end, so jump to the end.
function skipToNext() {
  const player = getPlayer()
  if (isYTMusic) {
    const button = document.querySelector<HTMLElement>(
      'ytmusic-player-bar .next-button, ytmusic-player-controls .next-button, ytmusic-player-page .next-button',
    )
    if (button) {
      button.click()
      return
    }
  } else if (!new URL(document.location.href).searchParams.has('list')) {
    const duration = player?.getDuration?.()
    if (duration > 0 && !player?.getVideoData?.()?.isLive) {
      player.seekTo(duration, true)
      return
    }
  }
  player?.nextVideo()
}

// YouTube Music's own previous buttons follow the same restart rule.
function handlePreviousButtons() {
  document.addEventListener(
    'click',
    (e) => {
      const button = (e.target as HTMLElement).closest?.('.previous-button')
      if (!button?.closest('ytmusic-player-bar,ytmusic-player-controls')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      skipToPrevious()
    },
    true,
  )
}

export function initNouTube() {
  if (window.NouTubeInitialSettings) {
    setSettings(window.NouTubeInitialSettings)
  }

  if (window.NouTubeBlocklist) {
    setBlocklist(window.NouTubeBlocklist)
  }

  if (window.NouTubeUserStyles) {
    setUserStyles(window.NouTubeUserStyles)
  }

  watchPictureInPictureVideo()
  if (isYTMusic) {
    handlePreviousButtons()
  }

  return {
    getSettings,
    setSettings,
    getUserStyles,
    setUserStyles,
    getBlocklist,
    setBlocklist,
    preparePictureInPicture,
    setPictureInPicture,
    shortsHidden: true,
    play: () => getPlayer()?.playVideo(),
    pause: () => getPlayer()?.pauseVideo(),
    prev: skipToPrevious,
    next: () => {
      // The app only needs to be asked when its own queue has something in
      // it. Asking goes through the app's event loop, which does not run while
      // the app is in the background: every skip then waited until the app
      // was opened again. With an empty queue (the usual case) skip right here,
      // the same way prev does.
      const queueSize = (getSettings() as { queueSize?: number }).queueSize
      if (window.NouTubeI && queueSize !== 0) {
        // The page url stops naming the playing video once the user browses
        // away with the mini player, so prefer the player's own.
        const videoUrl = getPlayer()?.getVideoUrl?.() || ''
        emit('playback-next', { url: videoUrl.includes('v=') ? videoUrl : document.location.href })
      } else {
        skipToNext()
      }
    },
    skipToNext,
    seekBy: (delta: number) => getPlayer()?.seekBy(delta),
    seekTo: (seconds: number) => getPlayer()?.seekTo(seconds),
    getVideoUrl: () => getPlayer()?.getVideoUrl?.() || '',
    getPlaybackRate: () => getPlayer()?.getPlaybackRate?.(),
    setPlaybackRate: (rate: number) => getPlayer()?.setPlaybackRate?.(rate),
    getPlaybackQuality: () => getPlayer()?.getPlaybackQuality?.(),
    setPlaybackQuality: (quality: string) => {
      const p = getPlayer()
      if (p) {
        if (p.setPlaybackQualityRange) {
          p.setPlaybackQualityRange(quality, quality)
        } else if (p.setPlaybackQuality) {
          p.setPlaybackQuality(quality)
        }
      }
    },
    hideShorts() {
      hideShorts()
      this.shortsHidden = true
    },
    showShorts() {
      showShorts()
      this.shortsHidden = false
    },
    playDefaultAudio,
    restoreLastPlaying,
    bridgeShortcuts,
    getPlayerFormats,
  }
}
