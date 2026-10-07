import { View, useColorScheme } from 'react-native'
import { useEffect, useState } from 'react'
import { useValue } from '@legendapp/state/react'
import MaterialIcons, { type MaterialIconsIconName } from '@react-native-vector-icons/material-icons'
import { access$, formatDate, formatRemaining, maskCode } from '@/lib/access/controller'
import { clsx } from '@/lib/utils'
import { useTwColor } from '@/lib/theme'
import { NouText } from '../NouText'

const surfaceCls = 'overflow-hidden rounded-[24px] bg-white dark:bg-zinc-900'
const sectionLabelCls = 'mb-2 px-1 text-[11px] uppercase tracking-[0.18em] text-zinc-600 dark:text-zinc-500'
const iconWrapCls = 'h-10 w-10 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-950'

const Row: React.FC<{ icon: MaterialIconsIconName; title: string; value: string; isLast?: boolean }> = ({
  icon,
  title,
  value,
  isLast = false,
}) => {
  const tw = useTwColor()
  const isDark = useColorScheme() !== 'light'
  return (
    <View
      className={clsx(
        'flex-row items-center gap-3 px-4 py-4',
        !isLast && 'border-b-2 border-zinc-100 dark:border-zinc-950',
      )}
    >
      <View className={iconWrapCls}>
        <MaterialIcons name={icon} color={isDark ? tw('zinc-300') : tw('slate-600')} size={18} />
      </View>
      <NouText className="flex-1 font-medium">{title}</NouText>
      <NouText className="text-sm text-zinc-600 dark:text-zinc-400">{value}</NouText>
    </View>
  )
}

/** "Mi acceso": tiempo restante, vencimiento y código enmascarado. */
export const AccessStatusSection = () => {
  const status = useValue(access$.status)
  const expiresMs = useValue(access$.expiresMs)
  const offsetMs = useValue(access$.serverOffsetMs)
  const code = useValue(access$.code)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (status !== 'unlocked') {
    return null
  }

  return (
    <View>
      <NouText className={sectionLabelCls}>Mi acceso</NouText>
      <View className={surfaceCls}>
        <Row icon="timer" title="Tiempo restante" value={formatRemaining(expiresMs - (now + offsetMs))} />
        <Row icon="event" title="Vence" value={formatDate(expiresMs - offsetMs)} />
        <Row icon="vpn-key" title="Suscripción" value={maskCode(code)} isLast />
      </View>
    </View>
  )
}
