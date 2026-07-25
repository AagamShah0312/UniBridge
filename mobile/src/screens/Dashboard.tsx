import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg'
import { hodApi, type LoginResponse } from '../api'
import { useApi } from '../useApi'
import { c, theme } from '../theme'
import { IconCalendarCheck, IconClipboard, IconFaculty, IconShield, IconStudents, IconTrend } from '../icons'

const MONTHS = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']
// Per-phase accent, exactly as the design colours T1–T3.
const PHASE_COLORS = [c.primary, c.purple, c.teal, c.primary]

/** Dashboard — a 1:1 build of the "iOS — Human Interface" frame. */
export function Dashboard({ session, onNavigate }: { session: LoginResponse; onNavigate: (id: string) => void }) {
  const t = session.accessToken
  const scope = useApi(() => hodApi.scope(t), [t])
  const summary = useApi(() => hodApi.summary(t), [t])
  const results = useApi(() => hodApi.resultsOverview(t), [t])
  const trend = useApi(() => hodApi.attendanceTrend(t), [t])
  const atRisk = useApi(() => hodApi.atRisk(t), [t])

  const firstName = session.user.name.split(' ').slice(0, 2).join(' ')
  const refreshing = scope.refreshing || summary.refreshing
  const refreshAll = () => { scope.refresh(); summary.refresh(); results.refresh(); trend.refresh(); atRisk.refresh() }

  const s = summary.data

  return (
    <ScrollView
      style={st.flex}
      contentContainerStyle={st.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={c.primary} />}
    >
      <Text style={st.eyebrow}>
        DEPARTMENT{scope.data?.hod.sectionTag ? ` — ${scope.data.hod.sectionTag}` : ''}
      </Text>
      <Text style={st.greeting}>Good day,{'\n'}{firstName}.</Text>
      <Text style={st.lede}>
        Here's how your department is tracking this term.
        {scope.data ? ` ${scope.data.activeSemester.label} is currently active.` : ''}
      </Text>

      {/* chips */}
      <View style={st.chips}>
        {scope.data ? (
          <>
            <View style={st.chipActive}>
              <View style={st.chipDot} />
              <Text style={st.chipActiveText}>{scope.data.activeSemester.label} Active</Text>
            </View>
            <View style={st.chip}><Text style={st.chipText}>{scope.data.totalStudents} students</Text></View>
            <View style={st.chip}><Text style={st.chipText}>{scope.data.totalFaculty} faculty</Text></View>
          </>
        ) : null}
      </View>

      {/* primary actions */}
      <View style={st.actions}>
        <Pressable style={st.btnPrimary} onPress={() => onNavigate('exams')}>
          <IconShield />
          <Text style={st.btnPrimaryText}>Exam Panel</Text>
        </Pressable>
        <Pressable style={st.btnGhost} onPress={() => onNavigate('results')}>
          <IconClipboard />
          <Text style={st.btnGhostText}>Results</Text>
        </Pressable>
      </View>

      {/* stat cards 2×2 */}
      {summary.loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={c.primary} />
      ) : s ? (
        <View style={st.grid}>
          <StatCard value={String(s.totalStudents.value)} label="Total Students" hint={s.totalStudents.deltaLabel} tint="rgba(37,99,235,.1)" icon={<IconStudents />} />
          <StatCard value={String(s.totalFaculty.value)} label="Faculty Members" hint={s.totalFaculty.deltaLabel} tint="rgba(124,58,237,.1)" icon={<IconFaculty />} />
          <StatCard value={`${Math.round(s.avgAttendance.value)}%`} label="Avg Attendance" hint={s.avgAttendance.deltaLabel} tint="rgba(13,148,136,.1)" icon={<IconCalendarCheck />} />
          <StatCard value={`${Math.round(s.resultsUploadedPct.value)}%`} label="Results Uploaded" hint={s.resultsUploadedPct.deltaLabel} tint="rgba(217,119,6,.12)" icon={<IconTrend />} />
        </View>
      ) : null}

      {/* attendance trend */}
      <View style={st.card}>
        <View style={st.cardHeadRow}>
          <Text style={st.cardTitle}>Attendance Trend</Text>
          <Text style={st.cardMeta}>Last 6 months</Text>
        </View>
        <TrendChart points={trend.data?.series?.[0]?.data ?? null} loading={trend.loading} />
        <View style={st.axis}>
          {(trend.data?.labels?.length ? trend.data.labels : MONTHS).slice(0, 6).map((m) => (
            <Text key={m} style={st.axisText}>{m}</Text>
          ))}
        </View>
      </View>

      {/* results overview */}
      <View style={st.card}>
        <Text style={st.cardTitle}>Results Overview</Text>
        <Text style={[st.cardMeta, { marginTop: 5 }]}>Avg marks by phase</Text>
        <View style={{ marginTop: 16, gap: 12 }}>
          {results.loading ? (
            <ActivityIndicator color={c.primary} />
          ) : (
            (results.data?.phases ?? []).map((p, i) => (
              <View key={p.phase} style={st.barRow}>
                <Text style={st.barLabel}>{p.phase}</Text>
                <View style={st.barTrack}>
                  {p.avgMarksPct == null ? (
                    <View style={st.barPendingWrap}>
                      <Text style={st.barPending}>Pending</Text>
                    </View>
                  ) : (
                    <View style={[st.barFill, { width: `${Math.max(12, Math.min(100, p.avgMarksPct))}%`, backgroundColor: PHASE_COLORS[i % 4] }]}>
                      <Text style={st.barValue}>{Math.round(p.avgMarksPct)}%</Text>
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      {/* at-risk students */}
      <View style={st.card}>
        <View style={st.cardHeadRow}>
          <View>
            <Text style={st.cardTitle}>At-Risk Students</Text>
            <Text style={[st.cardMeta, { marginTop: 5 }]}>
              {atRisk.data ? `${atRisk.data.total ?? atRisk.data.data.length} flagged` : '—'}
            </Text>
          </View>
          <Pressable onPress={() => onNavigate('students')}>
            <Text style={st.viewAll}>View all</Text>
          </Pressable>
        </View>
        <View style={{ marginTop: 14 }}>
          {atRisk.loading ? (
            <ActivityIndicator color={c.primary} />
          ) : (atRisk.data?.data.length ?? 0) === 0 ? (
            <Text style={st.none}>No students are currently at risk.</Text>
          ) : (
            atRisk.data!.data.slice(0, 5).map((r) => {
              const high = (r.attendancePct ?? 100) < 50
              return (
                <View key={r.enrollmentNo} style={st.riskRow}>
                  <View style={[st.riskAvatar, { backgroundColor: high ? c.dangerBg : c.warnBg }]}>
                    <Text style={[st.riskAvatarText, { color: high ? c.danger : c.warn }]}>
                      {r.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={st.flex}>
                    <Text style={st.riskName} numberOfLines={1}>{r.name}</Text>
                    <Text style={st.riskMeta} numberOfLines={1}>
                      {r.batchCode ? `Batch ${r.batchCode} · ` : ''}{r.attendancePct == null ? '—' : `${Math.round(r.attendancePct)}% attendance`}
                    </Text>
                  </View>
                  <View style={[st.riskPill, { backgroundColor: high ? c.dangerBg : c.warnBg }]}>
                    <Text style={[st.riskPillText, { color: high ? c.danger : c.warn }]}>{high ? 'High' : 'Med'}</Text>
                  </View>
                </View>
              )
            })
          )}
        </View>
      </View>
    </ScrollView>
  )
}

function StatCard({ value, label, hint, tint, icon }: { value: string; label: string; hint: string; tint: string; icon: React.ReactNode }) {
  return (
    <View style={st.stat}>
      <View style={st.statTop}>
        <Text style={st.statValue}>{value}</Text>
        <View style={[st.statBadge, { backgroundColor: tint }]}>{icon}</View>
      </View>
      <Text style={st.statLabel}>{label}</Text>
      <Text style={st.statHint}>{hint}</Text>
    </View>
  )
}

/** Smooth area chart matching the design's curve, scaled to real data when available. */
function TrendChart({ points, loading }: { points: (number | null)[] | null; loading: boolean }) {
  const W = 300
  const H = 120
  if (loading) return <ActivityIndicator style={{ height: H }} color={c.primary} />

  // The series carries nulls for months with no lectures — drop them before plotting.
  const real = (points ?? []).filter((v): v is number => typeof v === 'number')
  const vals = real.length >= 2 ? real.slice(-6) : [58, 60, 56, 62, 66, 70]
  // Pad the domain to at least 20 points around the mean. Attendance clusters tightly
  // (e.g. 76–79%), and scaling min→max would blow that noise up into a dramatic slope.
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const mid = (lo + hi) / 2
  const half = Math.max(10, (hi - lo) / 2 + 2)
  const dMin = mid - half
  const span = half * 2
  // Map to the design's vertical band (y 30–100), inverted so higher % sits higher.
  const xy = vals.map((v, i) => ({
    x: (i / (vals.length - 1)) * W,
    y: 100 - ((v - dMin) / span) * 62,
  }))
  const line = xy.map((p, i) => (i === 0 ? `M${p.x} ${p.y.toFixed(1)}` : `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`)).join(' ')
  const area = `${line} L${W} ${H} L0 ${H} Z`
  const last = xy[xy.length - 1]

  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ marginTop: 14 }}>
      <Defs>
        <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.primary} stopOpacity={0.22} />
          <Stop offset="1" stopColor={c.primary} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Line x1="0" y1="30" x2={W} y2="30" stroke={c.grid} />
      <Line x1="0" y1="60" x2={W} y2="60" stroke={c.grid} />
      <Line x1="0" y1="90" x2={W} y2="90" stroke={c.grid} />
      <Path d={area} fill="url(#area)" />
      <Path d={line} fill="none" stroke={c.primary} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={last.x} cy={last.y} r={4} fill={c.primary} stroke="#fff" strokeWidth={2} />
    </Svg>
  )
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 18, paddingTop: 20, paddingBottom: 40 },

  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.5, color: c.primary, marginBottom: 8 },
  greeting: { fontFamily: theme.serif, fontSize: 30, lineHeight: 33, fontWeight: '600', color: c.ink, letterSpacing: -0.3 },
  lede: { fontSize: 14, lineHeight: 21, color: c.body, marginTop: 10 },

  chips: { flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  chipActive: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(37,99,235,.09)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.chip },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.primary },
  chipActiveText: { color: c.primary, fontSize: 12, fontWeight: '600' },
  chip: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,.08)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.chip },
  chipText: { color: '#4b4842', fontSize: 12, fontWeight: '600' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, borderRadius: theme.radius.btn, paddingVertical: 14,
    shadowColor: c.primary, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnGhost: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,.1)', borderRadius: theme.radius.btn, paddingVertical: 14,
  },
  btnGhostText: { color: '#1a1a1a', fontSize: 14, fontWeight: '600' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  stat: { flexGrow: 1, flexBasis: '46%', backgroundColor: '#fff', borderWidth: 1, borderColor: c.border, borderRadius: theme.radius.card, padding: 16 },
  statTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  statValue: { fontFamily: theme.serif, fontSize: 28, fontWeight: '600', color: c.ink },
  statBadge: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  statLabel: { fontSize: 12.5, fontWeight: '500', color: c.label, marginTop: 8 },
  statHint: { fontSize: 11, fontWeight: '500', color: c.hint, marginTop: 8 },

  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: c.border, borderRadius: theme.radius.card, padding: 18, marginTop: 16 },
  cardHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontFamily: theme.serif, fontSize: 16, fontWeight: '600', color: c.ink },
  cardMeta: { fontSize: 11, fontWeight: '500', color: c.hint },
  viewAll: { fontSize: 12, fontWeight: '600', color: c.primary },

  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 10, fontWeight: '500', color: c.axis },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 20, fontSize: 12, fontWeight: '600', color: c.label },
  barTrack: { flex: 1, height: 22, backgroundColor: c.track, borderRadius: 6, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 6, justifyContent: 'center', paddingLeft: 9 },
  barValue: { color: '#fff', fontSize: 11, fontWeight: '600' },
  barPendingWrap: { flex: 1, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 10 },
  barPending: { fontSize: 11, fontWeight: '500', color: c.faint },

  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.track },
  riskAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  riskAvatarText: { fontSize: 12, fontWeight: '600' },
  riskName: { fontSize: 13, fontWeight: '600', color: c.inkRow },
  riskMeta: { fontSize: 11, fontWeight: '500', color: c.hint, marginTop: 4 },
  riskPill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: theme.radius.chip },
  riskPillText: { fontSize: 11, fontWeight: '600' },
  none: { fontSize: 12.5, color: c.hint, paddingVertical: 10 },
})
