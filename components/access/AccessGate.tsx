import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useEffect, useState } from 'react'
import { useValue } from '@legendapp/state/react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { access$, checkAccess, formatCode, submitCode } from '@/lib/access/controller'
import { AccessConfig } from '@/lib/access/config'

const REDEEM_COLOR = '#7C4DFF'
const LOGO_RED = '#d91e2e'
// Versión de escritorio (react-native-web): ocupar toda la ventana.
const FULL = Platform.OS === 'web' ? ({ height: '100%' } as const) : undefined
const MONO = Platform.OS === 'android' ? 'monospace' : Platform.OS === 'web' ? 'Consolas, Menlo, monospace' : 'Menlo'

export const LogoMark: React.FC<{ size?: number }> = ({ size = 96 }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024">
    <Circle cx={512} cy={512} r={480} fill={LOGO_RED} />
    <Path d="M262 330 Q240 316 240 344 L240 680 Q240 708 262 694 L540 530 Q564 512 540 494 Z" fill="#fff" />
    <Rect x={600} y={430} width={44} height={164} rx={22} fill="#fff" />
    <Rect x={672} y={350} width={44} height={324} rx={22} fill="#fff" />
    <Rect x={744} y={400} width={44} height={224} rx={22} fill="#fff" />
  </Svg>
)

/**
 * Pantalla de acceso: no deja abrir la app hasta canjear un código válido
 * del servicio "ytpremium" (se generan en el panel).
 */
export const AccessGate: React.FC<React.PropsWithChildren> = ({ children }) => {
  const status = useValue(access$.status)

  useEffect(() => {
    void checkAccess()
    const timer = setInterval(() => void checkAccess(), 60_000)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkAccess()
    })
    return () => {
      clearInterval(timer)
      sub.remove()
    }
  }, [])

  if (status === 'unlocked') {
    return <>{children}</>
  }
  if (status === 'checking') {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950" style={FULL}>
        <LogoMark size={88} />
        <ActivityIndicator style={{ marginTop: 32 }} color="#ffffff" />
      </View>
    )
  }
  return <RedeemScreen />
}

const RedeemScreen = () => {
  const message = useValue(access$.message)
  const busy = useValue(access$.busy)
  const [code, setCode] = useState('')

  const onSubmit = () => {
    if (!busy) void submitCode(code)
  }

  return (
    // Android moderno dibuja la app de borde a borde y ya no achica la ventana al abrir
    // el teclado, así que también aquí hay que dejarle espacio a mano.
    <KeyboardAvoidingView className="flex-1 bg-zinc-950" behavior="padding" style={FULL}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full items-center self-center" style={{ maxWidth: 440 }}>
          <LogoMark size={104} />
          <Text className="mt-6 text-3xl font-bold text-white">{AccessConfig.APP_TITLE}</Text>
          <Text className="mt-2 text-base text-zinc-400">Ingresa tu código de acceso</Text>
        </View>

        <View className="mt-10 w-full self-center" style={{ maxWidth: 440 }}>
          <Text className="mb-2 px-1 text-sm text-zinc-400">Código</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(formatCode(v))}
            placeholder="XXXX-XXXX-XXXX"
            placeholderTextColor="#52525b"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={39}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            editable={!busy}
            className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-center text-xl tracking-widest text-white"
            style={{ fontFamily: MONO }}
          />

          {message ? <Text className="mt-4 px-1 text-center text-sm leading-5 text-red-400">{message}</Text> : null}

          <Pressable
            onPress={onSubmit}
            disabled={busy}
            className="mt-6 h-14 items-center justify-center rounded-2xl active:opacity-80"
            style={{ backgroundColor: REDEEM_COLOR, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-base font-bold text-white">Canjear código</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
