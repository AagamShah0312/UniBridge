import type { ReactNode } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { theme } from './theme'

const c = theme.color

/** Screen body with pull-to-refresh + consistent padding. */
export function Screen({
  children,
  refreshing,
  onRefresh,
}: {
  children: ReactNode
  refreshing?: boolean
  onRefresh?: () => void
}) {
  return (
    <ScrollView
      style={u.flex}
      contentContainerStyle={u.screen}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.primary} /> : undefined
      }
    >
      {children}
    </ScrollView>
  )
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={u.sectionWrap}>
      <Text style={u.section}>{children}</Text>
      {sub ? <Text style={u.sectionSub}>{sub}</Text> : null}
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[u.card, style]}>{children}</View>
}

/** KPI tile — the mockup's stat cards. */
export function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <View style={u.stat}>
      <Text style={u.statValue}>{value}</Text>
      <Text style={u.statLabel}>{label}</Text>
      {hint ? <Text style={u.statHint}>{hint}</Text> : null}
    </View>
  )
}

/** List row: leading avatar/initials, title + subtitle, trailing value. */
export function Row({
  initials,
  title,
  subtitle,
  value,
  valueTone,
  pill,
}: {
  initials?: string
  title: string
  subtitle?: string
  value?: string
  valueTone?: 'good' | 'warn' | 'bad'
  pill?: { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }
}) {
  return (
    <View style={u.row}>
      {initials ? (
        <View style={u.rowAvatar}>
          <Text style={u.rowAvatarText}>{initials}</Text>
        </View>
      ) : null}
      <View style={u.flex}>
        <Text style={u.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={u.rowSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <Text style={[u.rowValue, valueTone ? u[valueTone] : null]}>{value}</Text> : null}
      {pill ? <Pill text={pill.text} tone={pill.tone} /> : null}
    </View>
  )
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <View style={[u.pill, u[`pill_${tone}`]]}>
      <Text style={[u.pillText, u[`pillText_${tone}`]]}>{text}</Text>
    </View>
  )
}

/** Horizontal percentage bar (results overview / attendance). */
export function Bar({ pct, label, right }: { pct: number | null; label: string; right?: string }) {
  return (
    <View style={u.barWrap}>
      <View style={u.barHead}>
        <Text style={u.barLabel}>{label}</Text>
        <Text style={u.barRight}>{right ?? (pct == null ? 'Pending' : `${Math.round(pct)}%`)}</Text>
      </View>
      <View style={u.barTrack}>
        <View style={[u.barFill, { width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }]} />
      </View>
    </View>
  )
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
}

export function ErrorView({ message }: { message: string }) {
  return (
    <View style={u.error}>
      <Text style={u.errorText}>{message}</Text>
    </View>
  )
}

export function EmptyView({ text }: { text: string }) {
  return (
    <View style={u.empty}>
      <Text style={u.emptyText}>{text}</Text>
    </View>
  )
}

export const initialsOf = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

/** Attendance/marks colour coding used across screens. */
export const pctTone = (pct: number | null): 'good' | 'warn' | 'bad' | undefined =>
  pct == null ? undefined : pct >= 75 ? 'good' : pct >= 60 ? 'warn' : 'bad'

const u = StyleSheet.create({
  flex: { flex: 1 },
  screen: { padding: 16, paddingBottom: 40 },

  sectionWrap: { marginTop: 22, marginBottom: 10 },
  section: { fontSize: 17, fontWeight: '700', color: c.ink },
  sectionSub: { marginTop: 3, fontSize: 12.5, color: c.muted },

  card: {
    backgroundColor: c.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
  },

  stat: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: c.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  statValue: { fontSize: 24, fontWeight: '700', color: c.ink },
  statLabel: { marginTop: 3, fontSize: 12.5, fontWeight: '600', color: c.ink },
  statHint: { marginTop: 3, fontSize: 11, color: c.muted },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  rowAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.heroFrom,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarText: { color: c.primary, fontWeight: '700', fontSize: 12.5 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: c.ink },
  rowSub: { marginTop: 2, fontSize: 12, color: c.muted },
  rowValue: { fontSize: 13.5, fontWeight: '700', color: c.ink },
  good: { color: '#15803d' },
  warn: { color: '#b45309' },
  bad: { color: '#b91c1c' },

  pill: { borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pill_good: { backgroundColor: '#dcfce7' },
  pill_warn: { backgroundColor: '#fef3c7' },
  pill_bad: { backgroundColor: '#fee2e2' },
  pill_neutral: { backgroundColor: '#eef2f7' },
  pillText: { fontSize: 11, fontWeight: '700' },
  pillText_good: { color: '#15803d' },
  pillText_warn: { color: '#b45309' },
  pillText_bad: { color: '#b91c1c' },
  pillText_neutral: { color: c.muted },

  barWrap: { marginTop: 12 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barLabel: { fontSize: 13, fontWeight: '600', color: c.ink },
  barRight: { fontSize: 12.5, color: c.muted, fontWeight: '600' },
  barTrack: { height: 8, borderRadius: 99, backgroundColor: '#eef2f7', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 99, backgroundColor: c.primary },

  error: { marginTop: 20, backgroundColor: c.dangerBg, padding: 12, borderRadius: theme.radius.sm },
  errorText: { color: c.danger, fontSize: 13 },
  empty: { paddingVertical: 34, alignItems: 'center' },
  emptyText: { color: c.muted, fontSize: 13 },
})
