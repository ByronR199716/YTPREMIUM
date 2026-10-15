import { Modal, Platform, Pressable, Text, View } from 'react-native'
import { useState } from 'react'
import { createMMKV } from 'react-native-mmkv'

/**
 * YTPremium: aviso que sale una sola vez en el celular al abrir la versión que lo
 * trae. Pedido por el admin: si tras actualizar fallan las descargas, borrar los
 * datos de la app lo arregla. Reinstalar no siempre sirve: la copia de seguridad
 * automática de Android devuelve los datos viejos (comprobado con la 1.0.9).
 * v1 (1.0.9) decía "desinstala y vuelve a instalar"; v2 sale otra vez con el texto corregido.
 * Para mostrar otro aviso más adelante, cambiar NOTICE_KEY.
 */
const NOTICE_KEY = 'notice_reinstall_downloads_v2'
const ACCENT = '#7C4DFF'

let storage: ReturnType<typeof createMMKV> | null = null
const store = () => (storage ??= createMMKV({ id: 'ytpremium-access' }))

function alreadySeen() {
  try {
    return store().getString(NOTICE_KEY) === '1'
  } catch {
    return true
  }
}

export const PostUpdateNotice = () => {
  const [visible, setVisible] = useState(() => Platform.OS === 'android' && !alreadySeen())
  if (!visible) return null

  const close = () => {
    try {
      store().set(NOTICE_KEY, '1')
    } catch {}
    setVisible(false)
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View className="flex-1 items-center justify-center bg-black/60 p-6">
        <View className="w-full rounded-3xl bg-zinc-900 p-6" style={{ maxWidth: 420 }}>
          <Text className="mb-3 text-xl font-bold text-white">Aviso importante</Text>
          <Text className="text-base leading-6 text-zinc-300">
            Si la descarga de los videos falla, borra los datos de la aplicación:
          </Text>
          <Text className="mt-3 text-base font-bold leading-6 text-white">
            Ajustes del teléfono {'>'} Apps {'>'} YTPremium {'>'} Almacenamiento {'>'} Borrar datos
          </Text>
          <Text className="mt-3 text-base leading-6 text-zinc-300">
            Después abre YTPremium y vuelve a ingresar tu código.
          </Text>
          <View className="mt-6 flex-row justify-end">
            <Pressable
              onPress={close}
              className="h-11 justify-center rounded-xl px-5 active:opacity-80"
              style={{ backgroundColor: ACCENT }}
            >
              <Text className="font-bold text-white">Entendido</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}
