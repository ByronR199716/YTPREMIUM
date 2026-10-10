import { AccessConfig } from './config'

/** Respuesta del servidor a validate_access. */
export interface ServerAccess {
  ok: boolean
  reason: string
  kind: string
  expiresMs: number | null
  serverMs: number | null
  revalidateHours: number
  graceHours: number
}

/** No se pudo hablar con el servidor (sin internet, servidor pausado, error HTTP). */
export class AccessUnavailableError extends Error {}

async function rpc(fn: string, body: Record<string, unknown>): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  let res: Response
  try {
    res = await fetch(`${AccessConfig.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: AccessConfig.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${AccessConfig.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new AccessUnavailableError('Sin conexión')
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  if (!res.ok) {
    throw new AccessUnavailableError(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new AccessUnavailableError('Respuesta inválida')
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function validateCode(code: string, deviceId: string, deviceName: string): Promise<ServerAccess> {
  const o = (await rpc('validate_access', {
    p_code: code,
    p_device_id: deviceId,
    p_device_name: deviceName,
    p_service: AccessConfig.SERVICE,
  })) as Record<string, unknown> | null
  return {
    ok: o?.ok === true,
    reason: typeof o?.reason === 'string' ? o.reason : 'invalid',
    kind: typeof o?.kind === 'string' ? o.kind : 'code',
    expiresMs: num(o?.expires_ms),
    serverMs: num(o?.server_ms),
    revalidateHours: num(o?.revalidate_hours) ?? 12,
    graceHours: num(o?.offline_grace_hours) ?? 72,
  }
}

/** Versión publicada en el panel (Servicios > Actualizaciones de las apps). */
export interface AppUpdateInfo {
  versionCode: number
  minVersionCode: number
  url: string
  notes: string
}

/** null = no hay versión publicada (o el servicio está apagado en el panel). */
export async function fetchAppUpdate(platform = 'android'): Promise<AppUpdateInfo | null> {
  const o = (await rpc('get_app_update', { p_service: AccessConfig.SERVICE, p_platform: platform })) as Record<
    string,
    unknown
  > | null
  const versionCode = num(o?.version_code) ?? 0
  const url = typeof o?.url === 'string' ? o.url : ''
  if (versionCode <= 0 || !url) return null
  return {
    versionCode,
    minVersionCode: num(o?.min_version_code) ?? 0,
    url,
    notes: typeof o?.notes === 'string' ? o.notes : '',
  }
}
