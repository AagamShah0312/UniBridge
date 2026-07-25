import { StyleSheet, Text, View } from 'react-native'
import { hodApi, type LoginResponse } from '../api'
import { useApi } from '../useApi'
import { Bar, Card, EmptyView, ErrorView, Loading, Pill, Row, Screen, SectionTitle, Stat, initialsOf, pctTone } from '../ui'
import { theme } from '../theme'

const c = theme.color
export type ScreenProps = { session: LoginResponse }

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Wraps the loading / error / empty states every screen needs. */
function State<T>({
  q,
  children,
  empty,
}: {
  q: { data: T | null; error: string | null; loading: boolean }
  children: (data: T) => React.ReactNode
  empty?: string
}) {
  if (q.loading) return <Loading />
  if (q.error) return <ErrorView message={q.error} />
  if (!q.data) return <EmptyView text={empty ?? 'No data'} />
  return <>{children(q.data)}</>
}

// ── Dashboard ────────────────────────────────────────────────
export function DashboardScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const scope = useApi(() => hodApi.scope(t), [t])
  const summary = useApi(() => hodApi.summary(t), [t])
  const results = useApi(() => hodApi.resultsOverview(t), [t])

  const firstName = session.user.name.split(' ').slice(0, 2).join(' ')

  return (
    <Screen refreshing={scope.refreshing} onRefresh={() => { scope.refresh(); summary.refresh(); results.refresh() }}>
      <Text style={s.eyebrow}>
        DEPARTMENT{scope.data?.hod.sectionTag ? ` — ${scope.data.hod.sectionTag}` : scope.data?.hod.year ? ` — ${scope.data.hod.year}` : ''}
      </Text>
      <Text style={s.greeting}>Good day, {firstName}.</Text>
      <Text style={s.sub}>
        Here's how your department is tracking this term.
        {scope.data ? ` ${scope.data.activeSemester.label} is currently active.` : ''}
      </Text>

      {scope.data ? (
        <View style={s.chips}>
          <Pill text={`${scope.data.activeSemester.label} Active`} tone="good" />
          <Pill text={`${scope.data.totalStudents} students`} />
          <Pill text={`${scope.data.totalFaculty} faculty`} />
        </View>
      ) : null}

      <State q={summary}>
        {(d) => (
          <View style={s.statGrid}>
            <Stat value={String(d.totalStudents.value)} label="Total Students" hint={d.totalStudents.deltaLabel} />
            <Stat value={String(d.totalFaculty.value)} label="Faculty" hint={d.totalFaculty.deltaLabel} />
            <Stat value={String(d.activeBatches.value)} label="Active Batches" hint={d.activeBatches.deltaLabel} />
            <Stat value={`${Math.round(d.avgAttendance.value)}%`} label="Avg Attendance" hint={d.avgAttendance.deltaLabel} />
            <Stat value={`${Math.round(d.resultsUploadedPct.value)}%`} label="Results Uploaded" hint={d.resultsUploadedPct.deltaLabel} />
          </View>
        )}
      </State>

      <SectionTitle sub="Avg marks by phase">Results Overview</SectionTitle>
      <Card>
        <State q={results}>
          {(d) => <>{d.phases.map((p) => <Bar key={p.phase} label={p.phase} pct={p.avgMarksPct} />)}</>}
        </State>
      </Card>

      <SectionTitle sub={scope.data ? `${scope.data.batches.length} batches` : undefined}>Your Batches</SectionTitle>
      <Card>
        <State q={scope}>
          {(d) =>
            d.batches.length === 0 ? (
              <EmptyView text="No batches assigned" />
            ) : (
              <>
                {d.batches.map((b) => (
                  <Row key={b.id} title={b.code} subtitle={b.yearLevel} value={`${b.studentCount}`} />
                ))}
              </>
            )
          }
        </State>
      </Card>
    </Screen>
  )
}

// ── Students ─────────────────────────────────────────────────
export function StudentsScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const q = useApi(() => hodApi.students(t), [t])
  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      <SectionTitle sub={q.data ? `${q.data.total} enrolled` : undefined}>Students</SectionTitle>
      <Card>
        <State q={q} empty="No students">
          {(d) =>
            d.data.length === 0 ? (
              <EmptyView text="No students" />
            ) : (
              <>
                {d.data.map((st) => (
                  <Row
                    key={st.enrollmentNo}
                    initials={initialsOf(st.name)}
                    title={st.name}
                    subtitle={`${st.enrollmentNo} · ${st.batchCode} · Roll ${st.rollNo}`}
                    value={st.attendancePct == null ? '—' : `${Math.round(st.attendancePct)}%`}
                    valueTone={pctTone(st.attendancePct)}
                  />
                ))}
                {d.total > d.data.length ? (
                  <Text style={s.more}>Showing {d.data.length} of {d.total}</Text>
                ) : null}
              </>
            )
          }
        </State>
      </Card>
    </Screen>
  )
}

// ── Faculty ──────────────────────────────────────────────────
export function FacultyScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const q = useApi(() => hodApi.faculty(t), [t])
  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      <SectionTitle sub={q.data ? `${q.data.total} members` : undefined}>Faculty</SectionTitle>
      <Card>
        <State q={q} empty="No faculty">
          {(d) => (
            <>
              {d.data.map((f) => (
                <Row
                  key={f.id}
                  initials={initialsOf(f.name)}
                  title={f.name}
                  subtitle={`${f.employeeId}${f.mentorCode ? ` · ${f.mentorCode}` : ''} · ${f.assignedSubjects} subj`}
                  pill={{ text: f.isActive ? 'Active' : 'Inactive', tone: f.isActive ? 'good' : 'neutral' }}
                />
              ))}
            </>
          )}
        </State>
      </Card>
    </Screen>
  )
}

// ── Attendance ───────────────────────────────────────────────
export function AttendanceScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const q = useApi(() => hodApi.attendanceSummary(t), [t])
  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      <SectionTitle sub="Department-wide">Attendance</SectionTitle>
      <State q={q}>
        {(d) => (
          <>
            <View style={s.statGrid}>
              <Stat value={`${Math.round(d.overallAvgPct)}%`} label="Overall Average" hint={d.deltaLabel} />
              <Stat value={String(d.belowThresholdCount)} label="Below Threshold" hint="Students at risk" />
              <Stat value={String(d.totalLectures)} label="Lectures" hint="Recorded" />
              <Stat value={`${Math.round(d.lockedRecordsPct)}%`} label="Locked" hint="Finalised records" />
            </View>
            <Card style={{ marginTop: 16 }}>
              <Bar label="Department average" pct={d.overallAvgPct} />
            </Card>
          </>
        )}
      </State>
    </Screen>
  )
}

// ── Results ──────────────────────────────────────────────────
export function ResultsScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const overview = useApi(() => hodApi.resultsOverview(t), [t])
  const summary = useApi(() => hodApi.summary(t), [t])
  return (
    <Screen refreshing={overview.refreshing} onRefresh={() => { overview.refresh(); summary.refresh() }}>
      <SectionTitle sub="Average marks by phase">Results</SectionTitle>
      <State q={summary}>
        {(d) => (
          <View style={s.statGrid}>
            <Stat value={`${Math.round(d.resultsUploadedPct.value)}%`} label="Uploaded" hint={d.resultsUploadedPct.deltaLabel} />
            <Stat value={String(d.totalStudents.value)} label="Students" hint="In scope" />
          </View>
        )}
      </State>
      <Card style={{ marginTop: 16 }}>
        <State q={overview}>
          {(d) => <>{d.phases.map((p) => <Bar key={p.phase} label={p.phase} pct={p.avgMarksPct} />)}</>}
        </State>
      </Card>
    </Screen>
  )
}

// ── Subjects ─────────────────────────────────────────────────
export function SubjectsScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const q = useApi(() => hodApi.subjects(t), [t])
  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      <SectionTitle sub={q.data ? `${q.data.data.length} subjects` : undefined}>Subjects</SectionTitle>
      <Card>
        <State q={q} empty="No subjects">
          {(d) => (
            <>
              {d.data.map((sub) => (
                <Row
                  key={sub.id}
                  title={`${sub.code} — ${sub.name}`}
                  subtitle={`${sub.credits} credits · ${sub.type}${sub.assignedFaculty ? ` · ${sub.assignedFaculty.name}` : ''}`}
                />
              ))}
            </>
          )}
        </State>
      </Card>
    </Screen>
  )
}

// ── Timetable ────────────────────────────────────────────────
export function TimetableScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const q = useApi(() => hodApi.timetable(t), [t])
  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      <SectionTitle sub="Weekly schedule">Timetable</SectionTitle>
      <State q={q} empty="No timetable">
        {(d) => {
          const byDay = new Map<number, typeof d.slots>()
          for (const slot of d.slots) {
            byDay.set(slot.dayOfWeek, [...(byDay.get(slot.dayOfWeek) ?? []), slot])
          }
          const days = [...byDay.keys()].sort((a, b) => a - b)
          if (days.length === 0) return <EmptyView text="No slots scheduled" />
          return (
            <>
              {days.map((day) => (
                <View key={day}>
                  <SectionTitle>{DAYS[day] ?? `Day ${day}`}</SectionTitle>
                  <Card>
                    {(byDay.get(day) ?? [])
                      .sort((a, b) => a.slotStart.localeCompare(b.slotStart))
                      .map((slot) => (
                        <Row
                          key={slot.id}
                          title={`${slot.subjectCode} · ${slot.batchCode}`}
                          subtitle={`${slot.slotStart}–${slot.slotEnd}${slot.room ? ` · Room ${slot.room}` : ''}`}
                        />
                      ))}
                  </Card>
                </View>
              ))}
            </>
          )
        }}
      </State>
    </Screen>
  )
}

// ── Exam Panel ───────────────────────────────────────────────
export function ExamPanelScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const q = useApi(() => hodApi.examCoordinators(t), [t])
  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      <SectionTitle sub="Appointed coordinators for this semester">Exam Panel</SectionTitle>
      <Card>
        <State q={q}>
          {(d) => (
            <>
              {d.coordinators.map((co) => (
                <Row
                  key={co.slot}
                  title={`Coordinator ${co.slot}`}
                  subtitle={co.employeeId ?? 'Not appointed'}
                  pill={{ text: co.name ? 'Assigned' : 'Vacant', tone: co.name ? 'good' : 'neutral' }}
                />
              ))}
            </>
          )}
        </State>
      </Card>
    </Screen>
  )
}

// ── Announcements ────────────────────────────────────────────
export function AnnouncementsScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const q = useApi(() => hodApi.announcements(t), [t])
  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      <SectionTitle sub={q.data ? `${q.data.total} posted` : undefined}>Announcements</SectionTitle>
      <Card>
        <State q={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyView text="No announcements yet" />
            ) : (
              <>
                {d.data.map((a) => (
                  <Row
                    key={a.id}
                    title={a.title}
                    subtitle={new Date(a.createdAt).toLocaleDateString()}
                  />
                ))}
              </>
            )
          }
        </State>
      </Card>
    </Screen>
  )
}

// ── Analytics ────────────────────────────────────────────────
export function AnalyticsScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const summary = useApi(() => hodApi.summary(t), [t])
  const att = useApi(() => hodApi.attendanceSummary(t), [t])
  const res = useApi(() => hodApi.resultsOverview(t), [t])
  return (
    <Screen refreshing={summary.refreshing} onRefresh={() => { summary.refresh(); att.refresh(); res.refresh() }}>
      <SectionTitle sub="Department performance">Analytics</SectionTitle>
      <State q={summary}>
        {(d) => (
          <View style={s.statGrid}>
            <Stat value={`${Math.round(d.avgAttendance.value)}%`} label="Avg Attendance" />
            <Stat value={`${Math.round(d.resultsUploadedPct.value)}%`} label="Results Published" />
            <Stat value={String(d.totalStudents.value)} label="Students" />
            <Stat value={String(d.activeBatches.value)} label="Batches" />
          </View>
        )}
      </State>

      <SectionTitle>Attendance health</SectionTitle>
      <Card>
        <State q={att}>
          {(d) => (
            <>
              <Bar label="Overall" pct={d.overallAvgPct} />
              <View style={{ marginTop: 12 }}>
                <Row title="Below threshold" value={String(d.belowThresholdCount)} valueTone="bad" />
                <Row title="Lectures recorded" value={String(d.totalLectures)} />
              </View>
            </>
          )}
        </State>
      </Card>

      <SectionTitle>Marks by phase</SectionTitle>
      <Card>
        <State q={res}>{(d) => <>{d.phases.map((p) => <Bar key={p.phase} label={p.phase} pct={p.avgMarksPct} />)}</>}</State>
      </Card>
    </Screen>
  )
}

// ── Archive ──────────────────────────────────────────────────
export function ArchiveScreen({ session }: ScreenProps) {
  const t = session.accessToken
  const q = useApi(() => hodApi.archive(t), [t])
  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      <SectionTitle sub="Every batch you have ever owned">Archive</SectionTitle>
      <State q={q}>
        {(d) =>
          d.years.length === 0 ? (
            <EmptyView text="No archived records yet" />
          ) : (
            <>
              {d.years.map((y) => (
                <View key={y.academicYearId}>
                  <SectionTitle sub={`${y.totalStudents} students`}>{y.academicYear}</SectionTitle>
                  {y.semesters.map((sem) => (
                    <Card key={sem.semesterId} style={{ marginBottom: 10 }}>
                      <View style={s.semHead}>
                        <Text style={s.semLabel}>{sem.label}</Text>
                        {sem.isActive ? <Pill text="Active" tone="good" /> : null}
                      </View>
                      <View style={s.batchWrap}>
                        {sem.batches.map((b) => (
                          <View key={b.batchId} style={s.batchChip}>
                            <Text style={s.batchCode}>{b.batchCode}</Text>
                            <Text style={s.batchCount}>{b.students}</Text>
                          </View>
                        ))}
                      </View>
                    </Card>
                  ))}
                </View>
              ))}
            </>
          )
        }
      </State>
    </Screen>
  )
}

// ── Settings ─────────────────────────────────────────────────
export function SettingsScreen({ session }: ScreenProps) {
  const u = session.user
  return (
    <Screen>
      <SectionTitle sub="Your account">Settings</SectionTitle>
      <Card>
        <Row initials={initialsOf(u.name)} title={u.name} subtitle={u.email} />
        <Row title="Employee ID" value={u.employeeId ?? '—'} />
        <Row title="Year level" value={u.year ?? '—'} />
        <Row title="Role" value={u.isHod ? 'HOD' : u.role} />
      </Card>
      <Text style={s.version}>UniPortal Mobile · HOD</Text>
    </Screen>
  )
}

const s = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.3, color: c.primary },
  greeting: { marginTop: 8, fontSize: 25, fontWeight: '700', color: c.ink },
  sub: { marginTop: 6, fontSize: 14, color: c.muted, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  more: { marginTop: 12, fontSize: 12, color: c.muted, textAlign: 'center' },
  semHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  semLabel: { fontSize: 14, fontWeight: '700', color: c.ink },
  batchWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  batchChip: {
    flexDirection: 'row',
    gap: 7,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  batchCode: { fontSize: 12.5, fontWeight: '700', color: c.ink },
  batchCount: { fontSize: 12, color: c.muted },
  version: { marginTop: 26, textAlign: 'center', fontSize: 12, color: c.mutedLight },
})
