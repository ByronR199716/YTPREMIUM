import { ActivityIndicator, AppState, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useEffect, useRef, useState } from 'react'
import NouTubeViewModule from '@/modules/nou-tube-view'
import { fetchAppUpdate, type AppUpdateInfo } from '@/lib/access/api'

/**
 * YTPremium: aviso de nueva versión dentro de la app (Android y PC con Windows).
 *
 * El admin publica la versión en el panel (Servicios > Actualizaciones de las apps,
 * filas ytpremium/android y ytpremium/pc). En ambas se pone 100 + N.
 * - Android (release build-N): el APK instalado lleva 100 * (100 + N) + abi, por eso se compara
 *   contra la "versión base" que da el módulo nativo.
 * - PC (release pc-build-N, versión 1.0.N): la descarga y el instalador están en
 *   desktop/src/main/lib/app-update.ts; el instalador corre en silencio y vuelve a abrir la app.
 * Si la instalada es menor que la mínima, la actualización es obligatoria (sin "Más tarde").
 */

type State =
  | { kind: 'hidden' }
  | { kind: 'available'; info: AppUpdateInfo; required: boolean }
  | { kind: 'downloading'; info: AppUpdateInfo; required: boolean; progress: number }
  | { kind: 'needPermission'; info: AppUpdateInfo; required: boolean }
  | { kind: 'ready'; info: AppUpdateInfo; required: boolean }
  | { kind: 'installing'; info: AppUpdateInfo; required: boolean }
  | { kind: 'failed'; info: AppUpdateInfo; required: boolean; message: string }

const ACCENT = '#7C4DFF'
const native = NouTubeViewModule as any

/** Versión de escritorio: lo que expone el preload (desktop/src/preload/index.ts). */
type DesktopUpdate = {
  info(): { versionCode: number; supported: boolean }
  download(url: string): Promise<{ size: number }>
  install(): Promise<void>
  onProgress(cb: (p: { progress: number }) => void): () => void
}
const desktop: DesktopUpdate | undefined =
  Platform.OS === 'web' ? ((globalThis as any).ytpremium?.appUpdate as DesktopUpdate | undefined) : undefined

/** El enlace fijo YTPremium.apk es arm64; los teléfonos de 32 bits bajan su propia versión. */
function urlForDevice(url: string, abi: string) {
  if (abi && abi !== 'arm64-v8a' && /\/YTPremium\.apk$/.test(url)) {
    return url.replace(/YTPremium\.apk$/, 'YTPremium-armeabi-v7a.apk')
  }
  return url
}

// Una sola vez por inicio de la app ("Más tarde" lo oculta hasta el próximo inicio).
let checkedThisLaunch = false

export const AppUpdatePrompt = () => {
  const [state, setState] = useState<State>({ kind: 'hidden' })
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const install = (info: AppUpdateInfo, required: boolean) => {
    if (desktop) {
      // La app se cierra sola; el instalador la vuelve a abrir al terminar.
      setState({ kind: 'installing', info, required })
      desktop
        .install()
        .catch((e: any) => setState({ kind: 'failed', info, required, message: String(e?.message ?? e) }))
      return
    }
    try {
      native.installAppUpdate()
      setState({ kind: 'ready', info, required })
    } catch (e: any) {
      setState({ kind: 'failed', info, required, message: String(e?.message ?? e) })
    }
  }

  const start = async (info: AppUpdateInfo, required: boolean) => {
    setState({ kind: 'downloading', info, required, progress: 0 })
    try {
      if (desktop) {
        await desktop.download(info.url)
        install(info, required)
        return
      }
      const abi = (native.getAppUpdateInfo?.()?.abi as string) ?? ''
      await native.downloadAppUpdate(urlForDevice(info.url, abi))
      if (!native.canInstallAppUpdate()) {
        setState({ kind: 'needPermission', info, required })
        return
      }
      install(info, required)
    } catch (e: any) {
      setState({ kind: 'failed', info, required, message: String(e?.message ?? e) })
    }
  }

  useEffect(() => {
    if (checkedThisLaunch) return
    const android = Platform.OS === 'android' && typeof native.getAppUpdateInfo === 'function'
    if (!android && !desktop) return
    checkedThisLaunch = true
    ;(async () => {
      try {
        let local: { baseVersion: number }
        if (desktop) {
          const d = desktop.info()
          if (!d?.supported) return
          local = { baseVersion: d.versionCode }
        } else {
          local = native.getAppUpdateInfo() as { baseVersion: number }
          try {
            native.cleanupAppUpdate?.()
          } catch {}
        }
        const info = await fetchAppUpdate(desktop ? 'pc' : 'android')
        if (!info || !local?.baseVersion) return
        if (info.versionCode > local.baseVersion) {
          setState({ kind: 'available', info, required: local.baseVersion < info.minVersionCode })
        }
      } catch {
        // Sin internet o servidor caído: no molestar, se revisa en el próximo inicio.
      }
    })()
  }, [])

  // Progreso de la descarga.
  useEffect(() => {
    const onProgress = (p: { progress: number }) =>
      setState((s) => (s.kind === 'downloading' ? { ...s, progress: p.progress } : s))
    if (desktop) return desktop.onProgress(onProgress)
    if (typeof native.addListener !== 'function') return
    const sub = native.addListener('appUpdateProgress', onProgress)
    return () => sub?.remove?.()
  }, [])

  // Al volver de Ajustes (permiso "instalar apps desconocidas"), seguir solos.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      const s = stateRef.current
      if (st === 'active' && s.kind === 'needPermission' && native.canInstallAppUpdate?.()) {
        install(s.info, s.required)
      }
    })
    return () => sub.remove()
  }, [])

  if (state.kind === 'hidden') return null
  const { info, required } = state
  const later = required ? null : () => setState({ kind: 'hidden' })

  let body: React.ReactNode
  let primary: { label: string; onPress: () => void } | null = null

  switch (state.kind) {
    case 'available':
      body = (
        <>
          <Text className="text-base text-zinc-300">
            {required
              ? 'Esta versión ya no funciona. Instala la actualización para seguir usando la app.'
              : 'Hay una versión nueva de YTPremium.'}
          </Text>
          {info.notes ? (
            <ScrollView style={{ maxHeight: 200, marginTop: 12 }}>
              <Text className="text-sm leading-5 text-zinc-400">{info.notes}</Text>
            </ScrollView>
          ) : null}
        </>
      )
      primary = { label: 'Actualizar', onPress: () => void start(info, required) }
      break
    case 'downloading':
      body = (
        <View>
          <Text className="text-base text-zinc-300">Descargando… {Math.round(state.progress * 100)}%</Text>
          <View className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-700">
            <View style={{ width: `${Math.round(state.progress * 100)}%`, backgroundColor: ACCENT, height: '100%' }} />
          </View>
          {state.progress === 0 ? <ActivityIndicator style={{ marginTop: 16 }} color="#ffffff" /> : null}
        </View>
      )
      break
    case 'needPermission':
      body = (
        <Text className="text-base text-zinc-300">
          Para instalar la actualización, permite a YTPremium instalar apps (activa “Permitir de esta fuente”) y vuelve
          aquí.
        </Text>
      )
      primary = { label: 'Dar permiso', onPress: () => native.openInstallPermissionSettings() }
      break
    case 'ready':
      body = (
        <Text className="text-base text-zinc-300">
          Toca “Actualizar” en la ventana de Android. Si la cerraste, puedes abrirla otra vez.
        </Text>
      )
      primary = { label: 'Instalar', onPress: () => install(info, required) }
      break
    case 'installing':
      body = (
        <View>
          <Text className="text-base text-zinc-300">
            Instalando… YTPremium se cerrará y volverá a abrirse sola en unos segundos.
          </Text>
          <ActivityIndicator style={{ marginTop: 16 }} color="#ffffff" />
        </View>
      )
      break
    case 'failed':
      body = (
        <Text className="text-base text-zinc-300">
          No se pudo descargar la actualización. Revisa tu internet e inténtalo otra vez.{'\n\n'}
          <Text className="text-xs text-zinc-500">{state.message}</Text>
        </Text>
      )
      primary = { label: 'Reintentar', onPress: () => void start(info, required) }
      break
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => later?.()}>
      <View className="flex-1 items-center justify-center bg-black/60 p-6">
        <View className="w-full rounded-3xl bg-zinc-900 p-6" style={{ maxWidth: 420 }}>
          <Text className="mb-3 text-xl font-bold text-white">
            {required ? 'Actualización obligatoria' : 'Nueva versión disponible'}
          </Text>
          {body}
          <View className="mt-6 flex-row justify-end gap-3">
            {later && state.kind !== 'downloading' && state.kind !== 'installing' ? (
              <Pressable onPress={later} className="h-11 justify-center rounded-xl px-4 active:opacity-70">
                <Text className="font-semibold text-zinc-300">Más tarde</Text>
              </Pressable>
            ) : null}
            {primary ? (
              <Pressable
                onPress={primary.onPress}
                className="h-11 justify-center rounded-xl px-5 active:opacity-80"
                style={{ backgroundColor: ACCENT }}
              >
                <Text className="font-bold text-white">{primary.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  )
}
