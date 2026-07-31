import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Check, Copy, MapPin, X } from 'lucide-react'
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
type BatchGroup = { batchId: string; batchCode: string; students: TodayLecture['students']; lectures: TodayLecture[] }

export default function FacultyAttendancePage() {
  const today = useQuery({ queryKey: ['faculty', 'att-today'], queryFn: facultyApi.todayLectures })
  const summary = useQuery({ queryKey: ['faculty', 'att-summary'], queryFn: facultyApi.attendanceSummary })
  const [marks, setMarks] = useState<Marks>({})

  useEffect(() => {
    if (!today.data) return
    const seeded: Marks = {}
    today.data.lectures.forEach((lec) => { seeded[lec.slotId] = { ...lec.marks } })
    setMarks(seeded)
  }, [today.data])

  // Today's lectures can span several batches; group them so same-batch lectures
  // (which share a student roster) render as one matrix you can copy across.
  const groups = useMemo<BatchGroup[]>(() => {
    const map = new Map<string, BatchGroup>()
    today.data?.lectures.forEach((lec) => {
      let g = map.get(lec.batchId)
      if (!g) { g = { batchId: lec.batchId, batchCode: lec.batchCode, students: lec.students, lectures: [] }; map.set(lec.batchId, g) }
      g.lectures.push(lec)
    })
    return [...map.values()]
  }, [today.data])

  const toggle = (slotId: string, enrollmentId: string) =>
    setMarks((m) => ({ ...m, [slotId]: { ...(m[slotId] ?? {}), [enrollmentId]: !(m[slotId]?.[enrollmentId] ?? false) } }))
  const markAll = (lec: TodayLecture, value: boolean) =>
    setMarks((m) => ({ ...m, [lec.slotId]: Object.fromEntries(lec.students.map((s) => [s.enrollmentId, value])) }))
  // Copy this lecture's marks onto every OTHER lecture of the same batch.
  const copyToOthers = (group: BatchGroup, sourceSlotId: string) => {
    const source = marks[sourceSlotId] ?? {}
    if (Object.keys(source).length === 0) return toast.error('Mark this lecture first, then copy.')
    setMarks((m) => {
      const next = { ...m }
      group.lectures.forEach((lec) => { if (lec.slotId !== sourceSlotId) next[lec.slotId] = { ...source } })
      return next
    })
    toast.success(`Copied to ${group.lectures.length - 1} other lecture(s) in ${group.batchCode}`)
  }

  const save = useMutation({
    mutationFn: (group: BatchGroup) => facultyApi.attendanceDaySave({
      batchId: group.batchId, date: today.data!.date,
      lectures: group.lectures.map((lec) => ({ slotId: lec.slotId, subjectId: lec.subjectId, marks: marks[lec.slotId] ?? {} })),
    }),
    onSuccess: (res: { inserted?: number; updated?: number }) => {
      toast.success(`Saved (${res.inserted ?? 0} new, ${res.updated ?? 0} updated)`)
      today.refetch(); summary.refetch()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const [savingBatch, setSavingBatch] = useState<string | null>(null)

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
      ) : groups.length === 0 ? (
        <EmptyState icon={<AlertTriangle size={22} />} title="No lectures today"
          description="You have no timetabled lectures today. If a coordinator assigns you a proxy lecture, it will appear here." />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.batchId} className="overflow-hidden">
              <CardHeader
                title={<span className="flex items-center gap-2">Batch {group.batchCode}</span>}
                subtitle={<span className="text-xs text-text-muted">{group.lectures.length} lecture{group.lectures.length > 1 ? 's' : ''} · {group.students.length} students</span>}
                action={
                  <Button size="sm" loading={save.isPending && savingBatch === group.batchId} disabled={!today.data!.isEditable}
                    onClick={() => { setSavingBatch(group.batchId); save.mutate(group) }}>Save Batch {group.batchCode}</Button>
                }
              />
              <CardBody className="pt-0">
                <div className="scrollbar-thin overflow-x-auto rounded-sm border border-border">
                  <table className="min-w-full text-[13px]">
                    <thead>
                      <tr className="bg-surface-2">
                        <th className="sticky left-0 z-10 border-r border-border bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Roll</th>
                        <th className="sticky left-[52px] z-10 border-r border-border bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Student</th>
                        {group.lectures.map((lec) => {
                          const cells = marks[lec.slotId] ?? {}
                          const present = group.students.filter((s) => cells[s.enrollmentId]).length
                          return (
                            <th key={lec.slotId} className="min-w-[128px] border-r border-border-light px-2 py-2 text-center align-top">
                              <div className="text-[11px] font-semibold text-primary">{lec.slotStart}–{lec.slotEnd}</div>
                              <div className="text-xs font-semibold text-text-primary">{lec.subjectCode}</div>
                              <div className="flex items-center justify-center gap-1 text-[10px] text-text-muted">
                                {lec.room && <span className="flex items-center gap-0.5"><MapPin size={9} /> {lec.room}</span>}
                                {lec.isProxy && <Badge tone="warning">Proxy</Badge>}
                              </div>
                              <div className="mt-1 text-[10px] font-medium text-text-secondary">{present}/{group.students.length}</div>
                              <div className="mt-1 flex justify-center gap-0.5">
                                <button onClick={() => markAll(lec, true)} title="All present" className="rounded-xs border border-border bg-surface px-1.5 text-[10px] font-semibold text-success hover:bg-success-light">✓</button>
                                <button onClick={() => markAll(lec, false)} title="All absent" className="rounded-xs border border-border bg-surface px-1.5 text-[10px] font-semibold text-danger hover:bg-danger-light">✗</button>
                                {group.lectures.length > 1 && (
                                  <button onClick={() => copyToOthers(group, lec.slotId)} title="Copy this lecture's attendance to the batch's other lectures" className="flex items-center rounded-xs border border-border bg-surface px-1.5 text-[10px] font-semibold text-primary hover:bg-primary-light"><Copy size={10} /></button>
                                )}
                              </div>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {group.students.map((stu) => (
                        <tr key={stu.enrollmentId} className="border-t border-border-light hover:bg-surface-2">
                          <td className="sticky left-0 z-10 border-r border-border bg-surface px-3 py-1.5 font-mono text-xs text-text-secondary">{stu.rollNo}</td>
                          <td className="sticky left-[52px] z-10 border-r border-border bg-surface px-3 py-1.5 font-medium">{stu.name}</td>
                          {group.lectures.map((lec) => {
                            const state = marks[lec.slotId]?.[stu.enrollmentId]
                            return (
                              <td key={lec.slotId} className="border-r border-border-light px-2 py-1.5 text-center">
                                <button
                                  disabled={!today.data!.isEditable}
                                  onClick={() => toggle(lec.slotId, stu.enrollmentId)}
                                  className={cn(
                                    'mx-auto flex h-7 w-7 items-center justify-center rounded-sm border transition',
                                    state === true && 'border-success bg-success text-white',
                                    state === false && 'border-danger bg-danger text-white',
                                    state == null && 'border-border text-text-muted hover:bg-surface-2',
                                    !today.data!.isEditable && 'cursor-not-allowed opacity-60',
                                  )}
                                  title={state === true ? 'Present — click to toggle' : state === false ? 'Absent — click to toggle' : 'Not marked'}
                                >
                                  {state === true ? <Check size={14} /> : state === false ? <X size={14} /> : '—'}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  )
}
