import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Check, Clock, MapPin, X } from 'lucide-react'
import { facultyApi } from '@/api/faculty'
import { errorMessage } from '@/api/client'
import type { TodayLecture } from '@/types/faculty'
import { PageShell } from '@/components/shared/PageShell'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'

// slotId -> enrollmentId -> present
type Marks = Record<string, Record<string, boolean>>

export default function FacultyAttendancePage() {
  const today = useQuery({ queryKey: ['faculty', 'att-today'], queryFn: facultyApi.todayLectures })
  const summary = useQuery({ queryKey: ['faculty', 'att-summary'], queryFn: facultyApi.attendanceSummary })
  const [marks, setMarks] = useState<Marks>({})

  // Seed local marks from whatever was already recorded for each lecture today.
  useEffect(() => {
    if (!today.data) return
    const seeded: Marks = {}
    today.data.lectures.forEach((lec) => { seeded[lec.slotId] = { ...lec.marks } })
    setMarks(seeded)
  }, [today.data])

  const toggle = (slotId: string, enrollmentId: string) =>
    setMarks((m) => ({ ...m, [slotId]: { ...(m[slotId] ?? {}), [enrollmentId]: !(m[slotId]?.[enrollmentId] ?? false) } }))
  const markAll = (lec: TodayLecture, value: boolean) =>
    setMarks((m) => ({ ...m, [lec.slotId]: Object.fromEntries(lec.students.map((s) => [s.enrollmentId, value])) }))

  const save = useMutation({
    mutationFn: (lec: TodayLecture) => facultyApi.attendanceDaySave({
      batchId: lec.batchId, date: today.data!.date,
      lectures: [{ slotId: lec.slotId, subjectId: lec.subjectId, marks: marks[lec.slotId] ?? {} }],
    }),
    onSuccess: (res: { inserted?: number; updated?: number }) => {
      toast.success(`Saved (${res.inserted ?? 0} new, ${res.updated ?? 0} updated)`)
      today.refetch(); summary.refetch()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const [savingSlot, setSavingSlot] = useState<string | null>(null)

  const dateLabel = today.data ? new Date(today.data.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : ''

  return (
    <PageShell title="Attendance" subtitle="Today's lectures, straight from your timetable — no batch to pick">
      {summary.data && (
        <div className="mb-5 grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Overall" />
            <CardBody className="pt-0">
              <div className="text-3xl font-bold text-text-primary">{summary.data.overall.avgAttendancePct}%</div>
              <div className="mt-1 text-xs text-text-muted">{summary.data.overall.totalLectures} lectures conducted · {summary.data.semesterLabel}</div>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="By subject & batch" />
            <CardBody className="pt-0">
              {summary.data.bySubjectAndBatch.length === 0 ? (
                <p className="text-xs text-text-muted">No lectures marked yet.</p>
              ) : (
                <div className="scrollbar-thin max-h-44 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] uppercase text-text-muted">
                      <th className="pb-1.5 font-semibold">Subject</th><th className="font-semibold">Batch</th><th className="font-semibold">Lectures</th><th className="font-semibold">Avg %</th><th className="font-semibold">Below 75%</th>
                    </tr></thead>
                    <tbody>
                      {summary.data.bySubjectAndBatch.map((r, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-1.5 font-medium">{r.subjectCode}</td>
                          <td>{r.batchCode}</td>
                          <td className="tabular-nums">{r.totalLecturesMarked}</td>
                          <td><Badge tone={r.avgAttendancePct >= 75 ? 'success' : r.avgAttendancePct >= 60 ? 'warning' : 'danger'}>{r.avgAttendancePct}%</Badge></td>
                          <td className="tabular-nums">{r.belowThresholdCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="font-semibold text-text-primary">{dateLabel}</span>
        {today.data?.dayStatus.isWorkingDay && <Badge tone="primary" dot>Today</Badge>}
        {today.data && !today.data.dayStatus.isWorkingDay && <Badge tone="warning" dot>{today.data.dayStatus.reason ?? today.data.dayStatus.status}</Badge>}
      </div>

      {today.isLoading ? (
        <CardSkeleton height={300} />
      ) : today.data && !today.data.dayStatus.isWorkingDay ? (
        <EmptyState icon={<AlertTriangle size={22} />} title={`No attendance — ${today.data.dayStatus.reason ?? today.data.dayStatus.status}`}
          description="The academic calendar marks today as a non-working day, so attendance is disabled." />
      ) : today.data && today.data.lectures.length === 0 ? (
        <EmptyState icon={<AlertTriangle size={22} />} title="No lectures today"
          description="You have no timetabled lectures today. If a coordinator assigns you a proxy lecture, it will appear here." />
      ) : (
        <div className="space-y-4">
          {today.data?.lectures.map((lec) => {
            const cells = marks[lec.slotId] ?? {}
            const present = lec.students.filter((s) => cells[s.enrollmentId]).length
            const marked = lec.students.filter((s) => cells[s.enrollmentId] != null).length
            return (
              <Card key={lec.slotId}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <span>Batch {lec.batchCode} · {lec.subjectCode}</span>
                      {lec.isProxy && <Badge tone="warning">Proxy</Badge>}
                    </span>
                  }
                  subtitle={
                    <span className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                      <span className="flex items-center gap-1"><Clock size={12} /> {lec.slotStart}–{lec.slotEnd}</span>
                      {lec.room && <span className="flex items-center gap-1"><MapPin size={12} /> {lec.room}</span>}
                      <span>{lec.subjectName}</span>
                      <span>{present}/{lec.students.length} present · {marked} marked</span>
                    </span>
                  }
                  action={
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => markAll(lec, true)} className="rounded-sm border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-success hover:bg-success-light">All present</button>
                      <button onClick={() => markAll(lec, false)} className="rounded-sm border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-danger hover:bg-danger-light">All absent</button>
                      <Button size="sm" loading={save.isPending && savingSlot === lec.slotId} disabled={!today.data!.isEditable}
                        onClick={() => { setSavingSlot(lec.slotId); save.mutate(lec) }}>Save</Button>
                    </div>
                  }
                />
                <CardBody className="pt-0">
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {lec.students.map((stu) => {
                      const state = cells[stu.enrollmentId]
                      return (
                        <button key={stu.enrollmentId} disabled={!today.data!.isEditable}
                          onClick={() => toggle(lec.slotId, stu.enrollmentId)}
                          className={cn(
                            'flex items-center gap-2 rounded-sm border px-2 py-1.5 text-left text-xs transition',
                            state === true && 'border-success bg-success-light',
                            state === false && 'border-danger bg-danger-light',
                            state == null && 'border-border hover:bg-surface-2',
                            !today.data!.isEditable && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                            state === true ? 'bg-success text-white' : state === false ? 'bg-danger text-white' : 'bg-surface-2 text-text-muted')}>
                            {state === true ? <Check size={12} /> : state === false ? <X size={12} /> : '·'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-text-primary">{stu.name}</span>
                            <span className="block font-mono text-[10px] text-text-muted">{stu.rollNo}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
