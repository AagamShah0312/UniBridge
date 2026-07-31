import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CalendarDays, Download, FileBarChart, ShieldAlert, Repeat, ClipboardCheck, PencilLine, CheckCircle2, Clock } from 'lucide-react'
import { facultyApi } from '@/api/faculty'
import { errorMessage } from '@/api/client'
import { PageShell } from '@/components/shared/PageShell'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

const today = () => new Date().toISOString().slice(0, 10)
const statusTone = (s: 'done' | 'partial' | 'none') => (s === 'done' ? 'success' : s === 'partial' ? 'warning' : 'neutral')
const statusLabel = (s: 'done' | 'partial' | 'none') => (s === 'done' ? 'Finished' : s === 'partial' ? 'Partial' : 'Not started')

export default function AttendanceCoordinatorPage() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['faculty', 'attendance-coordinator', 'status'], queryFn: () => facultyApi.attendanceCoordinatorStatus() })
  const [dailyDate, setDailyDate] = useState(today())
  const [weeklyUpto, setWeeklyUpto] = useState(today())
  const [proxyDate, setProxyDate] = useState(today())
  const [statusDate, setStatusDate] = useState(today())

  const isCoord = Boolean(status.data?.isCoordinator)

  // Feature 1: who has filled today's attendance (all their lectures marked = finished).
  const dayStatus = useQuery({
    queryKey: ['faculty', 'coordinator-today-status', statusDate],
    queryFn: () => facultyApi.coordinatorTodayStatus(statusDate),
    enabled: isCoord,
  })

  const proxies = useQuery({
    queryKey: ['faculty', 'attendance-proxies', proxyDate],
    queryFn: () => facultyApi.attendanceProxies(proxyDate),
    enabled: isCoord,
  })
  const setProxy = useMutation({
    mutationFn: ({ slotId, proxyFacultyId }: { slotId: string; proxyFacultyId: string }) =>
      proxyFacultyId
        ? facultyApi.assignProxyLecture(slotId, proxyDate, proxyFacultyId)
        : facultyApi.removeProxyLecture(slotId, proxyDate),
    onSuccess: () => { toast.success('Proxy updated'); qc.invalidateQueries({ queryKey: ['faculty', 'attendance-proxies'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const daily = useMutation({ mutationFn: () => facultyApi.downloadDailyAttendancePdf(dailyDate), onError: (e) => toast.error(errorMessage(e)) })
  const weekly = useMutation({ mutationFn: () => facultyApi.downloadWeeklyAttendancePdf(weeklyUpto), onError: (e) => toast.error(errorMessage(e)) })

  // Feature 2: edit any batch's attendance for any date.
  const [editBatch, setEditBatch] = useState('')
  const [editDate, setEditDate] = useState(today())
  const [marks, setMarks] = useState<Record<string, boolean>>({})
  const editDay = useQuery({
    queryKey: ['faculty', 'coordinator-edit-day', editBatch, editDate],
    queryFn: () => facultyApi.coordinatorAttendanceDay(editBatch, editDate),
    enabled: isCoord && Boolean(editBatch),
  })
  useEffect(() => {
    const d = editDay.data
    if (!d) return
    const seed: Record<string, boolean> = {}
    for (const s of d.students) for (const l of d.lectures) { const k = `${s.enrollmentId}:${l.slotId}`; seed[k] = d.marks[k] ?? true }
    setMarks(seed)
  }, [editDay.data])
  const saveEdit = useMutation({
    mutationFn: () => {
      const d = editDay.data!
      return facultyApi.coordinatorAttendanceDaySave({
        batchId: editBatch, date: editDate,
        lectures: d.lectures.map((l) => ({
          slotId: l.slotId, subjectId: l.subjectId,
          marks: Object.fromEntries(d.students.map((s) => [s.enrollmentId, marks[`${s.enrollmentId}:${l.slotId}`] ?? true])),
        })),
      })
    },
    onSuccess: (r: { inserted: number; updated: number }) => {
      toast.success(`Saved · ${r.inserted} added, ${r.updated} updated`)
      qc.invalidateQueries({ queryKey: ['faculty', 'coordinator-edit-day'] })
      qc.invalidateQueries({ queryKey: ['faculty', 'coordinator-today-status'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const setColumn = (slotId: string, present: boolean) => {
    const d = editDay.data!
    setMarks((m) => { const next = { ...m }; for (const s of d.students) next[`${s.enrollmentId}:${slotId}`] = present; return next })
  }

  if (status.isLoading) {
    return <PageShell title="Attendance Coordinator"><div className="py-20 text-center text-text-muted">Loading…</div></PageShell>
  }
  if (!isCoord) {
    return (
      <PageShell title="Attendance Coordinator">
        <EmptyState icon={<ShieldAlert size={22} />} title="Not an attendance coordinator"
          description="Only faculty assigned as attendance coordinators by the HOD can access this page." />
      </PageShell>
    )
  }

  const sm = dayStatus.data?.summary
  const ed = editDay.data

  return (
    <PageShell title="Attendance Coordinator" subtitle={`Department-wide attendance · ${status.data!.semesterLabel}`}>
      {/* Feature 1: who has filled attendance for the day */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><ClipboardCheck size={16} /> Attendance Filling Status</span>}
          subtitle="A faculty is marked finished only when every lecture they take that day is filled." />
        <CardBody>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input type="date" value={statusDate} max={today()} onChange={(e) => setStatusDate(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            {sm && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="success" className="gap-1"><CheckCircle2 size={13} /> {sm.finished} finished</Badge>
                <Badge tone="warning" className="gap-1"><Clock size={13} /> {sm.pending} remaining</Badge>
                <span className="text-text-muted">of {sm.totalFaculty} faculty · {sm.markedLectures}/{sm.totalLectures} lectures filled</span>
              </div>
            )}
          </div>
          {dayStatus.isLoading ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : (dayStatus.data?.faculty.length ?? 0) === 0 ? (
            <p className="text-sm text-text-muted">No lectures scheduled on this day.</p>
          ) : (
            <div className="scrollbar-thin overflow-x-auto rounded-sm border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left text-[11px] uppercase text-text-muted">
                    <th className="px-3 py-2 font-semibold">Faculty</th>
                    <th className="px-3 py-2 font-semibold">Code</th>
                    <th className="px-3 py-2 text-center font-semibold">Lectures</th>
                    <th className="px-3 py-2 text-center font-semibold">Filled</th>
                    <th className="px-3 py-2 text-center font-semibold">Remaining</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dayStatus.data!.faculty.map((f) => (
                    <tr key={f.facultyId ?? 'unassigned'} className="border-t border-border-light">
                      <td className="px-3 py-2 font-medium">{f.name}{f.employeeId && <span className="ml-1 text-xs text-text-muted">({f.employeeId})</span>}</td>
                      <td className="px-3 py-2 font-mono text-xs text-text-secondary">{f.mentorCode ?? '—'}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{f.total}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-success">{f.marked}</td>
                      <td className={`px-3 py-2 text-center tabular-nums ${f.remaining > 0 ? 'font-semibold text-warning' : 'text-text-muted'}`}>{f.remaining}</td>
                      <td className="px-3 py-2"><Badge tone={statusTone(f.status)}>{statusLabel(f.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><CalendarDays size={16} /> Daily Attendance</span>}
            subtitle="One PDF with every batch's absentees for a chosen day." />
          <CardBody>
            <label className="mb-1 block text-xs font-medium text-text-muted">Date</label>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={dailyDate} max={today()} onChange={(e) => setDailyDate(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
              <Button leftIcon={<Download size={15} />} loading={daily.isPending} disabled={!dailyDate} onClick={() => daily.mutate()}>Download Daily PDF</Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><FileBarChart size={16} /> Weekly Compiled Attendance</span>}
            subtitle="Per-student subject-wise + overall attendance up to a date." />
          <CardBody>
            <label className="mb-1 block text-xs font-medium text-text-muted">Up to date</label>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={weeklyUpto} max={today()} onChange={(e) => setWeeklyUpto(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
              <Button leftIcon={<Download size={15} />} loading={weekly.isPending} disabled={!weeklyUpto} onClick={() => weekly.mutate()}>Download Weekly PDF</Button>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Feature 2: edit any batch's attendance */}
      <Card className="mt-4">
        <CardHeader title={<span className="flex items-center gap-2"><PencilLine size={16} /> Edit Attendance</span>}
          subtitle="Correct any batch's attendance for any working day (locks and the 7-day window don't apply to you)." />
        <CardBody>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Batch</label>
              <Select className="min-w-[140px]" value={editBatch} onChange={(e) => setEditBatch(e.target.value)}
                options={[{ value: '', label: '— Select batch —' }, ...(dayStatus.data?.batches ?? []).map((b) => ({ value: b.id, label: b.code }))]} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Date</label>
              <input type="date" value={editDate} max={today()} onChange={(e) => setEditDate(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            </div>
            {ed && ed.lectures.length > 0 && (
              <Button leftIcon={<ClipboardCheck size={15} />} loading={saveEdit.isPending} onClick={() => saveEdit.mutate()}>Save changes</Button>
            )}
          </div>

          {!editBatch ? (
            <p className="text-sm text-text-muted">Pick a batch and date to edit its attendance.</p>
          ) : editDay.isLoading ? (
            <p className="text-sm text-text-muted">Loading matrix…</p>
          ) : !ed?.dayStatus?.isWorkingDay ? (
            <p className="text-sm text-warning">Not a working day{ed?.dayStatus?.reason ? ` — ${ed.dayStatus.reason}` : ''}. Attendance can't be edited.</p>
          ) : ed.lectures.length === 0 ? (
            <p className="text-sm text-text-muted">No lectures scheduled for this batch on this day.</p>
          ) : (
            <div className="scrollbar-thin overflow-x-auto rounded-sm border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left text-[11px] uppercase text-text-muted">
                    <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 font-semibold">Roll · Student</th>
                    {ed.lectures.map((l) => (
                      <th key={l.slotId} className="px-2 py-2 text-center font-semibold">
                        <div>{l.subjectCode}</div>
                        <div className="font-normal normal-case text-text-muted">{l.slotStart}</div>
                        <div className="mt-1 flex justify-center gap-1">
                          <button className="rounded bg-success/15 px-1 text-[10px] text-success" onClick={() => setColumn(l.slotId, true)}>All P</button>
                          <button className="rounded bg-danger/15 px-1 text-[10px] text-danger" onClick={() => setColumn(l.slotId, false)}>All A</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ed.students.map((s) => (
                    <tr key={s.enrollmentId} className="border-t border-border-light">
                      <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 font-medium">
                        <span className="tabular-nums text-text-muted">{s.rollNo}</span> · {s.name}
                      </td>
                      {ed.lectures.map((l) => {
                        const k = `${s.enrollmentId}:${l.slotId}`
                        const present = marks[k] ?? true
                        return (
                          <td key={l.slotId} className="px-2 py-1.5 text-center">
                            <button
                              onClick={() => setMarks((m) => ({ ...m, [k]: !(m[k] ?? true) }))}
                              className={`h-7 w-9 rounded text-xs font-bold ${present ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}
                              title={present ? 'Present — click to mark absent' : 'Absent — click to mark present'}>
                              {present ? 'P' : 'A'}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Proxy lectures */}
      <Card className="mt-4">
        <CardHeader title={<span className="flex items-center gap-2"><Repeat size={16} /> Proxy Lectures</span>}
          subtitle="Reassign a lecture for a day. The original faculty stops seeing it in Attendance; the proxy starts seeing it." />
        <CardBody>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Date</label>
              <input type="date" value={proxyDate} onChange={(e) => setProxyDate(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            </div>
          </div>
          {proxies.isLoading ? (
            <p className="text-sm text-text-muted">Loading lectures…</p>
          ) : (proxies.data?.lectures.length ?? 0) === 0 ? (
            <p className="text-sm text-text-muted">No lectures scheduled on this day.</p>
          ) : (
            <div className="scrollbar-thin overflow-x-auto rounded-sm border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left text-[11px] uppercase text-text-muted">
                    <th className="px-3 py-2 font-semibold">Batch</th>
                    <th className="px-3 py-2 font-semibold">Subject</th>
                    <th className="px-3 py-2 font-semibold">Time</th>
                    <th className="px-3 py-2 font-semibold">Assigned Faculty</th>
                    <th className="px-3 py-2 font-semibold">Proxy (for this day)</th>
                  </tr>
                </thead>
                <tbody>
                  {proxies.data!.lectures.map((lec) => (
                    <tr key={lec.slotId} className="border-t border-border-light">
                      <td className="px-3 py-2 font-medium">{lec.batchCode}</td>
                      <td className="px-3 py-2">{lec.subjectCode}</td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">{lec.slotStart}–{lec.slotEnd}</td>
                      <td className="px-3 py-2">
                        {lec.originalFaculty}
                        {lec.proxyFacultyId && <Badge tone="warning" className="ml-2">Proxied</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        <Select className="min-w-[200px]" value={lec.proxyFacultyId ?? ''}
                          onChange={(e) => setProxy.mutate({ slotId: lec.slotId, proxyFacultyId: e.target.value })}
                          options={[{ value: '', label: '— No proxy (original) —' }, ...(proxies.data!.facultyOptions)
                            .filter((f) => f.id !== lec.originalFacultyId)
                            .map((f) => ({ value: f.id, label: `${f.name} (${f.employeeId})` }))]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </PageShell>
  )
}
