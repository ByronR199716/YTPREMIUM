import { app, ipcMain } from 'electron'
import { execFileSync } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'

/*
 * Identificador de esta PC para el acceso por códigos (YTPremium).
 *
 * En Windows usa el MachineGuid del registro, que no cambia aunque se borre la app
 * o se reinstale. Se envía como hash (con prefijo del servicio) para no mandar el
 * GUID real. Si no se puede leer, se genera uno y se guarda en la carpeta de datos.
 */

export const ACCESS_DEVICE_CHANNEL = 'ytpremium-access-device'

function systemMachineId(): string {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 },
      )
      return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)?.[1] ?? ''
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 })
      return out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? ''
    }
    for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      if (existsSync(file)) return readFileSync(file, 'utf8').trim()
    }
  } catch {
    // se usa el ID guardado
  }
  return ''
}

function savedMachineId(): string {
  const file = join(app.getPath('userData'), 'device-id')
  try {
    if (existsSync(file)) {
      const saved = readFileSync(file, 'utf8').trim()
      if (saved) return saved
    }
    const generated = randomBytes(16).toString('hex')
    writeFileSync(file, generated)
    return generated
  } catch {
    return ''
  }
}

function osLabel(): string {
  if (process.platform === 'win32') {
    // Windows 11 reporta versión 10.0.22000 o mayor.
    const build = Number(os.release().split('.')[2] ?? 0)
    return build >= 22000 ? 'Windows 11' : 'Windows 10'
  }
  if (process.platform === 'darwin') return 'Mac'
  return 'Linux'
}

let cached: { id: string; name: string } | null = null

export function getAccessDevice(): { id: string; name: string } {
  if (cached) return cached
  const raw = systemMachineId() || savedMachineId()
  if (!raw) return { id: '', name: 'PC' }
  const id = 'pc-' + createHash('sha256').update('ytpremium:' + raw).digest('hex').slice(0, 32)
  // El nombre lo ve el panel; lleva los últimos 4 del ID para distinguir varias PCs.
  cached = { id, name: `PC · ${osLabel()} (${id.slice(-4).toUpperCase()})` }
  return cached
}

export function initAccessDeviceChannel(): void {
  ipcMain.on(ACCESS_DEVICE_CHANNEL, (event) => {
    event.returnValue = getAccessDevice()
  })
}
