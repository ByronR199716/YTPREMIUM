import { app, ipcMain, net, type WebContents } from 'electron'
import { spawn } from 'child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  rmSync,
  renameSync,
  statSync,
} from 'fs'
import { join } from 'path'

/*
 * YTPremium PC: aviso de nueva versión.
 *
 * El admin publica la versión en el panel (Servicios > Actualizaciones de las apps, fila ytpremium / pc).
 * La ventana del aviso es la misma del móvil (components/access/AppUpdatePrompt.tsx); aquí está la parte
 * de Windows: descargar el instalador y ejecutarlo en silencio.
 *
 * Números: el workflow pone la versión 1.0.N (release pc-build-N) y en el panel va 100 + N.
 */

export const APP_UPDATE_CHANNELS = {
  info: 'ytpremium-update-info',
  download: 'ytpremium-update-download',
  install: 'ytpremium-update-install',
  progress: 'ytpremium-update-progress',
} as const

const FILE = 'YTPremium-Update-Setup.exe'

function versionCode(): number {
  const m = app.getVersion().match(/^1\.0\.(\d+)$/)
  return m ? 100 + Number(m[1]) : 0
}

function updateDir(): string {
  return join(app.getPath('temp'), 'YTPremium-update')
}

function updateFile(): string {
  return join(updateDir(), FILE)
}

async function download(url: string, sender: WebContents): Promise<{ size: number }> {
  if (process.platform !== 'win32') throw new Error('Solo disponible en Windows')
  const dir = updateDir()
  mkdirSync(dir, { recursive: true })
  const tmp = updateFile() + '.part'
  rmSync(tmp, { force: true })
  rmSync(updateFile(), { force: true })

  // net.fetch sigue las redirecciones de GitHub y usa el proxy del sistema.
  const res = await net.fetch(url, { headers: { 'User-Agent': 'YTPremium-updater' } })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const out = createWriteStream(tmp)
  const reader = res.body.getReader()
  let done = 0
  let last = -1
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      done += chunk.value.length
      if (!out.write(chunk.value)) await new Promise<void>((r) => out.once('drain', () => r()))
      if (total > 0) {
        const pct = Math.floor((done * 100) / total)
        if (pct !== last) {
          last = pct
          if (!sender.isDestroyed()) sender.send(APP_UPDATE_CHANNELS.progress, { progress: pct / 100 })
        }
      }
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()))
  }

  // Comprobaciones básicas: tamaño completo y que sea un ejecutable de Windows ("MZ").
  const size = statSync(tmp).size
  if (total > 0 && size !== total) throw new Error('La descarga quedó incompleta')
  if (size < 5_000_000) throw new Error('El archivo descargado no es el instalador')
  const fd = openSync(tmp, 'r')
  const head = Buffer.alloc(2)
  readSync(fd, head, 0, 2, 0)
  closeSync(fd)
  if (head.toString('latin1') !== 'MZ') throw new Error('El archivo descargado no es el instalador')
  renameSync(tmp, updateFile())
  return { size }
}

/**
 * Ejecuta el instalador en silencio, en la misma carpeta donde está instalada la app, y cierra la app.
 * Mismos argumentos que usa electron-updater con los instaladores NSIS de electron-builder:
 * --updated (espera a que se cierre la app), /S (sin ventanas), --force-run (vuelve a abrir la app al terminar).
 * Es una instalación "solo para este usuario": no pide permisos de administrador.
 */
function install(): void {
  const file = updateFile()
  if (!existsSync(file)) throw new Error('Primero hay que descargar la actualización')
  const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
  child.unref()
  setTimeout(() => app.quit(), 300)
}

export function initAppUpdateChannel(): void {
  ipcMain.on(APP_UPDATE_CHANNELS.info, (event) => {
    event.returnValue = {
      versionCode: versionCode(),
      supported: process.platform === 'win32' && app.isPackaged,
    }
  })
  ipcMain.handle(APP_UPDATE_CHANNELS.download, (event, url: string) => download(String(url), event.sender))
  ipcMain.handle(APP_UPDATE_CHANNELS.install, () => install())
  // Instalador viejo de una actualización ya hecha.
  app.whenReady().then(() => {
    try {
      rmSync(updateDir(), { recursive: true, force: true })
    } catch {
      // en uso o sin permisos: no importa
    }
  })
}
