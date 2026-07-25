import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { fetchHodScope, type LoginResponse } from '../api'
import { theme } from '../theme'

const c = theme.color

type Scope = Awaited<ReturnType<typeof fetchHodScope>>

/**
 * Post-login landing. Deliberately small for this milestone — its job is to prove the
 * access token is accepted by the real backend (it calls /hod/my-scope).
 */
export function HomeScreen({ session, onSignOut }: { session: LoginResponse; onSignOut: () => void }) {
  const [scope, setScope] = useState<Scope | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchHodScope(session.accessToken)
      .then((s) => alive && setScope(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
    return () => {
      alive = false
    }
  }, [session.accessToken])

  const initials = session.user.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.content}>
      <View style={s.header}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        <View style={s.flex}>
          <Text style={s.name}>{session.user.name}</Text>
          <Text style={s.role}>
            HOD{session.user.year ? ` · ${session.user.year}` : ''}
            {session.user.employeeId ? ` · ${session.user.employeeId}` : ''}
          </Text>
        </View>
        <Pressable onPress={onSignOut} hitSlop={8}>
          <Text style={s.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={s.greeting}>Good day, {session.user.name.split(' ').slice(0, 2).join(' ')}.</Text>

      {error ? (
        <View style={s.error}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : !scope ? (
        <ActivityIndicator style={{ marginTop: 28 }} color={c.primary} />
      ) : (
        <>
          <Text style={s.sub}>
            {scope.activeSemester.label} is currently active.
          </Text>

          <View style={s.statRow}>
            <Stat value={String(scope.totalStudents)} label="Students" />
            <Stat value={String(scope.totalFaculty)} label="Faculty" />
            <Stat value={String(scope.batches.length)} label="Batches" />
          </View>

          <Text style={s.sectionTitle}>Your batches</Text>
          <View style={s.batchWrap}>
            {scope.batches.map((b) => (
              <View key={b.id} style={s.batch}>
                <Text style={s.batchCode}>{b.code}</Text>
                <Text style={s.batchCount}>{b.studentCount}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20, paddingTop: 64, paddingBottom: 48, backgroundColor: c.bg, minHeight: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.heroFrom,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: c.primary, fontWeight: '700', fontSize: 15 },
  name: { fontSize: 15, fontWeight: '700', color: c.ink },
  role: { fontSize: 12, color: c.muted, marginTop: 2 },
  signOut: { color: c.primary, fontSize: 13, fontWeight: '600' },

  greeting: { marginTop: 26, fontSize: 25, fontWeight: '700', color: c.ink },
  sub: { marginTop: 6, fontSize: 14, color: c.muted },

  error: { marginTop: 20, backgroundColor: c.dangerBg, padding: 12, borderRadius: theme.radius.sm },
  errorText: { color: c.danger, fontSize: 13 },

  statRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  stat: {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '700', color: c.ink },
  statLabel: { marginTop: 4, fontSize: 12, color: c.muted },

  sectionTitle: { marginTop: 28, fontSize: 16, fontWeight: '700', color: c.ink },
  batchWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  batch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  batchCode: { fontSize: 13, fontWeight: '700', color: c.ink },
  batchCount: { fontSize: 12, color: c.muted },
})
