import { observable } from '@legendapp/state'
import { createMMKV } from 'react-native-mmkv'
import NouTubeViewModule from '@/modules/nou-tube-view'
import { AccessUnavailableError, validateCode, type ServerAccess } from './api'

/*
 * Decide si la app puede abrirse (mismas reglas que PremiumMusic).
 *
 * - Con un acceso guardado y validado hace menos de `revalidate_hours`, abre sin usar internet.
 * - Si toca revalidar y no hay internet, deja usar la app hasta `offline_grace_hours`
 *   desde la última validación, siempre que el acceso no haya vencido.
 * - Si el reloj del teléfono se atrasa a propósito, exige validar en línea.
 */

export type AccessStatus = 'checking' | 'locked' | 'unlocked'

export const access$ = observable({
  status: 'checking' as AccessStatus,
  message: null as string | null,
  busy: false,
  code: '',
  expiresMs: 0,
  serverOffsetMs: 0,
})

const HOUR_MS = 3_600_000
const CLOCK_TOLERANCE_MS = 10 * 60_000

const K = {
  device: 'device_id',
  kind: 'kind',
  code: 'code',
  expires: 'expires_ms',
  validated: 'validated_ms',
  offset: 'server_offset_ms',
  lastSeen: 'last_seen_ms',
  revalidate: 'revalidate_h',
  grace: 'grace_h',
} as const

let storage: ReturnType<typeof createMMKV> | null = null
const store = () => (storage ??= createMMKV({ id: 'ytpremium-access' }))
const get = (key: string) => store().getString(key) ?? ''
const set = (key: string, value: string) => store().set(key, value)
const int = (v: string, fallback: number) => {
  const n = Number(v)
  return v !== '' && Number.isFinite(n) ? n : fallback
}

export const normalizeCode = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 32)

export const formatCode = (raw: string) => normalizeCode(raw).match(/.{1,4}/g)?.join('-') ?? ''

/** XXXX-XXXX-1234: solo se muestran los últimos 4 caracteres. */
export const maskCode = (raw: string) => {
  const code = normalizeCode(raw)
  if (code.length <= 4) return code
  const masked = 'X'.repeat(code.length - 4) + code.slice(-4)
  return formatCode(masked)
}

function nativeDevice(): { id: string; name: string } {
  try {
    const d = NouTubeViewModule.getAccessDevice?.()
    return { id: d?.id || '', name: d?.name || 'Dispositivo' }
  } catch {
    return { id: '', name: 'Dispositivo' }
  }
}

function deviceId() {
  const system = nativeDevice().id
  if (system) return system
  const saved = get(K.device)
  if (saved) return saved
  const hex = '0123456789abcdef'
  const generated = 'gen-' + Array.from({ length: 16 }, () => hex[Math.floor(Math.random() * 16)]).join('')
  set(K.device, generated)
  return generated
}

const deviceName = () => nativeDevice().name.slice(0, 80)

interface Session {
  code: string
  expiresMs: number
  validatedAt: number
  offsetMs: number
  lastSeen: number
  revalidateHours: number
  graceHours: number
}

function loadSession(): Session | null {
  if (get(K.kind) !== 'code') return null
  const expires = get(K.expires)
  if (!expires) return null
  return {
    code: get(K.code),
    expiresMs: int(expires, 0),
    validatedAt: int(get(K.validated), 0),
    offsetMs: int(get(K.offset), 0),
    lastSeen: int(get(K.lastSeen), 0),
    revalidateHours: int(get(K.revalidate), 12),
    graceHours: int(get(K.grace), 72),
  }
}

function saveSession(code: string, r: ServerAccess) {
  const t = Date.now()
  set(K.kind, 'code')
  set(K.code, code)
  set(K.expires, String(r.expiresMs ?? t))
  set(K.validated, String(t))
  set(K.offset, String((r.serverMs ?? t) - t))
  set(K.lastSeen, String(t))
  set(K.revalidate, String(r.revalidateHours))
  set(K.grace, String(r.graceHours))
}

function clearSession() {
  for (const key of [K.kind, K.code, K.expires, K.validated, K.offset, K.lastSeen]) {
    store().remove(key)
  }
}

function unlock(s: Session) {
  access$.assign({
    status: 'unlocked',
    message: null,
    code: s.code,
    expiresMs: s.expiresMs,
    serverOffsetMs: s.offsetMs,
  })
}

function lock(message: string | null) {
  access$.assign({ status: 'locked', message })
}

const EXPIRED = 'Tu código venció. Pide uno nuevo para seguir usando YTPremium.'
const TRIAL_USED = 'Ya usaste tu prueba gratis en este dispositivo. Para seguir usando YTPremium, pide un código.'

function messageFor(reason: string) {
  switch (reason) {
    case 'invalid':
      return 'Ese código no existe. Revisa que esté bien escrito.'
    case 'disabled':
      return 'Este código fue desactivado. Contacta al administrador.'
    case 'expired':
      return EXPIRED
    case 'device_limit':
      return 'Este código ya se usa en el máximo de dispositivos. Pide al administrador que libere uno.'
    case 'bad_request':
      return 'No se pudo identificar este dispositivo.'
    default:
      return 'No se pudo validar el acceso.'
  }
}

function applyResult(code: string, r: ServerAccess) {
  if (r.ok && r.expiresMs != null) {
    saveSession(code, r)
    const s = loadSession()
    if (s) unlock(s)
  } else {
    clearSession()
    // Una segunda prueba en el mismo teléfono: el servidor responde "expired" sin fecha
    // (un código vencido de verdad siempre trae su fecha de vencimiento).
    lock(r.reason === 'expired' && r.expiresMs == null ? TRIAL_USED : messageFor(r.reason))
  }
}

let running: Promise<void> | null = null
const exclusive = (fn: () => Promise<void>) => {
  const next = (running ?? Promise.resolve()).then(fn, fn)
  running = next.catch(() => {})
  return next
}

/** Revisa el acceso guardado. Se llama al abrir la app y cada minuto mientras está abierta. */
export const checkAccess = () =>
  exclusive(async () => {
    const s = loadSession()
    if (!s) {
      if (access$.status.peek() !== 'locked') lock(null)
      return
    }
    const t = Date.now()
    const clockMovedBack = t + CLOCK_TOLERANCE_MS < s.lastSeen || t < s.validatedAt - CLOCK_TOLERANCE_MS
    const expired = t + s.offsetMs >= s.expiresMs
    const due = t - s.validatedAt >= s.revalidateHours * HOUR_MS

    if (!clockMovedBack && !expired && !due) {
      if (t > s.lastSeen) set(K.lastSeen, String(t))
      unlock(s)
      return
    }

    try {
      applyResult(s.code, await validateCode(s.code, deviceId(), deviceName()))
    } catch (e) {
      if (!(e instanceof AccessUnavailableError)) throw e
      const withinGrace = !clockMovedBack && t - s.validatedAt < s.graceHours * HOUR_MS
      if (expired) {
        lock(EXPIRED + ' Si ya te lo renovaron, conéctate a internet y vuelve a abrir la app.')
      } else if (withinGrace) {
        if (t > s.lastSeen) set(K.lastSeen, String(t))
        unlock(s)
      } else {
        lock('Conéctate a internet para verificar tu acceso y vuelve a abrir la app.')
      }
    }
  })

/** El usuario escribió un código en la pantalla de acceso. */
export async function submitCode(raw: string) {
  const code = normalizeCode(raw)
  if (code.length < 6) {
    lock('Escribe el código completo.')
    return
  }
  if (access$.busy.peek()) return
  access$.busy.set(true)
  try {
    await exclusive(async () => {
      try {
        applyResult(code, await validateCode(code, deviceId(), deviceName()))
      } catch (e) {
        if (!(e instanceof AccessUnavailableError)) throw e
        lock('No se pudo conectar. Revisa tu internet e inténtalo de nuevo.')
      }
    })
  } finally {
    access$.busy.set(false)
  }
}

/** Tiempo restante legible, ej. "12 días", "5 h 20 min". */
export function formatRemaining(ms: number) {
  if (ms <= 0) return 'Vencido'
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days >= 1) return hours > 0 ? `${days} d ${hours} h` : `${days} ${days === 1 ? 'día' : 'días'}`
  if (hours >= 1) return `${hours} h ${mins} min`
  return `${Math.max(mins, 1)} min`
}

export function formatDate(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
