import { app } from 'electron'
import { join } from 'path'
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { gunzipSync } from 'zlib'

// YTPremium: yt-dlp needs FFmpeg to join YouTube's separate video and audio
// streams (every quality above 360p) and to make MP3s. Windows has none, so a
// static build is fetched once on first use, the same way yt-dlp itself is
// (~30 MB compressed), and kept next to it in the app data folder.
const FFMPEG_RELEASE = 'b6.1.1'
const FFMPEG_URLS: Record<string, string> = {
  win32: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/ffmpeg-win32-x64.gz`,
}

export function getFfmpegPath(): string {
  return join(app.getPath('userData'), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

let pending: Promise<string | null> | null = null

// Path to pass as --ffmpeg-location, or null where the system's own FFmpeg is
// used (Linux, macOS) or it could not be fetched; yt-dlp then reports the
// missing FFmpeg itself.
export function ensureFfmpeg(): Promise<string | null> {
  const url = FFMPEG_URLS[process.arch === 'x64' ? process.platform : '']
  if (!url) return Promise.resolve(null)
  const binaryPath = getFfmpegPath()
  if (existsSync(binaryPath)) return Promise.resolve(binaryPath)
  pending ??= (async () => {
    try {
      console.log(`Downloading FFmpeg from ${url}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to download FFmpeg: ${res.status} ${res.statusText}`)
      const data = gunzipSync(Buffer.from(await res.arrayBuffer()))
      // Written aside and renamed, so an interrupted download never leaves a
      // broken ffmpeg.exe that existsSync would then trust.
      const temp = `${binaryPath}.download`
      writeFileSync(temp, data)
      renameSync(temp, binaryPath)
      console.log(`FFmpeg downloaded to ${binaryPath}`)
      return binaryPath
    } catch (e) {
      console.error('FFmpeg download failed', e)
      try {
        unlinkSync(`${binaryPath}.download`)
      } catch {}
      return null
    } finally {
      pending = null
    }
  })()
  return pending
}

// YouTube now needs a JavaScript runtime to unlock its formats ("No supported
// JavaScript runtime could be found ... some formats may be missing"). Electron
// already ships one: its own executable runs as plain Node with
// ELECTRON_RUN_AS_NODE, so yt-dlp is pointed at it instead of asking the user
// to install Deno.
export function ytDlpRuntimeArgs(): string[] {
  return ['--js-runtimes', `node:${process.execPath}`, '--remote-components', 'ejs:github']
}

export function ytDlpEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
}
