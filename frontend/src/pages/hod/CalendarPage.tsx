import { useMemo, useState } from 'react'
import { ExportMenu } from '@/components/shared/ExportMenu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CalendarPlus, ChevronLeft, ChevronRight, Download, Eraser, Trash2, Upload } from 'lucide-react'
import { hodApi } from '@/api/hod'
import { errorMessage } from '@/api/client'
import { useHodScope } from '@/hooks/hod/useHodScope'
import type { HodCalendarEvent } from '@/types/hod'
import { PageShell } from '@/components/shared/PageShell'
import { CalendarGrid, EVENT_TONE } from '@/components/shared/CalendarGrid'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { format } from 'date-fns'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const TYPES = ['HOLIDAY', 'PUBLIC_HOLIDAY', 'READING_HOLIDAY', 'SEMESTER_BREAK', 'EXAM', 'CULTURAL', 'ACTIVITY', 'PHASE', 'OTHER']
const TYPE_LABEL: Record<string, string> = { HOLIDAY: 'Holiday', PUBLIC_HOLIDAY: 'Public Holiday', READING_HOLIDAY: 'Reading Holiday', SEMESTER_BREAK: 'Semester Break', EXAM: 'Exam', CULTURAL: 'Cultural', ACTIVITY: 'Activity', PHASE: 'Phase', OTHER: 'Other' }
// Types that make a day non-working (attendance disabled, timetable hidden).
const NON_WORKING_TYPES = new Set(['HOLIDAY', 'PUBLIC_HOLIDAY', 'READING_HOLIDAY', 'SEMESTER_BREAK'])
const LEGEND = [
  { key: 'HOLIDAY', label: 'Holiday', cls: 'bg-success' },
  { key: 'PUBLIC_HOLIDAY', label: 'Public Holiday', cls: 'bg-danger' },
  { key: 'READING_HOLIDAY', label: 'Reading Holiday', cls: 'bg-teal' },
  { key: 'SEMESTER_BREAK', label: 'Semester Break', cls: 'bg-purple' },
  { key: 'EXAM', label: 'Exam', cls: 'bg-warning' },
  { key: 'ACTIVITY', label: 'Activity', cls: 'bg-primary' },
]

export default function CalendarPage() {
  const qc = useQueryClient()
  const scope = useHodScope()
  const semesterId = scope.data?.activeSemester.id
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [editing, setEditing] = useState<Partial<HodCalendarEvent> | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [replaceExisting, setReplaceExisting] = useState(true)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; warnings: string[] } | null>(null)

  const events = useQuery({
    queryKey: ['hod', 'calendar', year, month],
    queryFn: () => hodApi.calendar.events({ year, month: month + 1 }),
  })
  const upcoming = useQuery({ queryKey: ['hod', 'calendar', 'upcoming'], queryFn: () => hodApi.calendar.upcoming(6) })
  const timeline = useQuery({ queryKey: ['hod', 'calendar', 'timeline', semesterId], queryFn: () => hodApi.calendar.phaseTimeline(semesterId), enabled: !!semesterId })
  // regular lectures are the same for all batches — a weekday has lectures if any slot exists
  const timetable = useQuery({ queryKey: ['hod', 'timetable', 'all'], queryFn: () => hodApi.timetable.list({}) })
  const subjects = useQuery({ queryKey: ['hod', 'subjects', semesterId], queryFn: () => hodApi.subjects.list({ semesterId }), enabled: !!semesterId })

  // weekdays (JS getDay, 1=Mon..6=Sat) that have any regular lecture
  const lectureDows = useMemo(() => [...new Set((timetable.data?.slots ?? []).map((s) => s.dayOfWeek))], [timetable.data])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['hod', 'calendar'] })
  }

  const save = useMutation({
    mutationFn: (e: Partial<HodCalendarEvent>) => {
      const start = (e.startDate ?? e.date ?? '').slice(0, 10)
      const end = (e.endDate ?? e.date ?? start).slice(0, 10)
      const body = { title: e.title, type: e.type, startDate: start, endDate: end, description: e.description, visibleTo: 'ALL', semesterId }
      return e.id ? hodApi.calendar.update(e.id, body) : hodApi.calendar.create(body)
    },
    onSuccess: () => { toast.success('Event saved'); invalidate(); setEditing(null) },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const del = useMutation({
    mutationFn: (id: string) => hodApi.calendar.remove(id),
    onSuccess: () => { toast.success('Event deleted'); invalidate(); setEditing(null) },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const importCal = useMutation({
    mutationFn: () => hodApi.calendar.import(importFile!, replaceExisting),
    onSuccess: (r) => { toast.success(`Imported ${r.imported} events${r.replaced ? ' (calendar replaced)' : ''}`); setImportResult(r); setImportFile(null); invalidate() },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const clearCal = useMutation({
    mutationFn: () => hodApi.calendar.clear(),
    onSuccess: (r) => { toast.success(`Cleared ${r.cleared} events`); invalidate() },
    onError: (err) => toast.error(errorMessage(err)),
  })

  function prevMonth() { if (month === 0) { setMonth(11); setYear((y) => y - 1) } else setMonth((m) => m - 1) }
  function nextMonth() { if (month === 11) { setMonth(0); setYear((y) => y + 1) } else setMonth((m) => m + 1) }

  return (
    <PageShell
      title="Academic Calendar"
      subtitle="Holidays, exams and phase schedule"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={() => hodApi.calendar.template()}>Template</Button>
          <Button variant="outline" leftIcon={<Upload size={15} />} onClick={() => { setImportResult(null); setImportOpen(true) }}>Import CSV/Excel</Button>
          <Button variant="outline" leftIcon={<Eraser size={15} />} loading={clearCal.isPending}
            onClick={() => window.confirm('Clear the ENTIRE academic calendar? This removes every event for all faculty and students.') && clearCal.mutate()}>Clear</Button>
          <ExportMenu onExport={(f) => hodApi.calendar.export(undefined, f)} />
          <Button leftIcon={<CalendarPlus size={15} />} onClick={() => setEditing({ date: format(new Date(), 'yyyy-MM-dd'), type: 'OTHER' })}>Add Event</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title={`${MONTHS[month]} ${year}`}
              action={
                <div className="flex gap-1">
                  <button onClick={prevMonth} className="flex h-8 w-8 items-center justify-center rounded-sm border border-border hover:bg-surface-2"><ChevronLeft size={16} /></button>
                  <button onClick={() => { setMonth(now.getMonth()); setYear(now.getFullYear()) }} className="rounded-sm border border-border px-3 text-xs font-medium hover:bg-surface-2">Today</button>
                  <button onClick={nextMonth} className="flex h-8 w-8 items-center justify-center rounded-sm border border-border hover:bg-surface-2"><ChevronRight size={16} /></button>
                </div>
              }
            />
            <CardBody className="pt-0">
              <CalendarGrid
                events={events.data?.data ?? []}
                year={year}
                month={month}
                lectureDows={lectureDows}
                onDayClick={(date) => setEditing({ date, startDate: date, endDate: date, type: 'OTHER' })}
                onEventClick={(e) => setEditing(e)}
              />
              {/* legend */}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border-light pt-3">
                {LEGEND.map((l) => (
                  <div key={l.key} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                    <span className={`h-2.5 w-2.5 rounded-full ${l.cls}`} /> {l.label}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Upcoming Events" />
            <CardBody className="space-y-2 pt-0">
              {upcoming.data?.data.map((e) => (
                <div key={e.id} className="flex items-center gap-2.5 border-b border-border-light py-2 last:border-0">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${EVENT_TONE[e.type]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{e.title}</div>
                    <div className="text-xs text-text-muted">{format(new Date(e.date), 'EEE, MMM d')}</div>
                  </div>
                  <Badge tone="neutral">{e.type}</Badge>
                </div>
              ))}
              {upcoming.data && upcoming.data.data.length === 0 && <p className="py-3 text-center text-xs text-text-muted">No upcoming events.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Phase Timeline" />
            <CardBody className="space-y-3 pt-0">
              {timeline.data?.phases.map((p) => (
                <div key={p.label} className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${p.isComplete ? 'bg-success' : 'bg-primary'}`}>{p.label}</div>
                  <div className="flex-1 text-xs">
                    <div className="font-medium text-text-primary">{format(new Date(p.startDate), 'MMM d')} – {format(new Date(p.endDate), 'MMM d')}</div>
                    {p.examDate && <div className="text-text-muted">Exam: {format(new Date(p.examDate), 'MMM d')}</div>}
                  </div>
                  <Badge tone={p.isComplete ? 'success' : 'primary'}>{p.isComplete ? 'Done' : 'Upcoming'}</Badge>
                </div>
              ))}
              {timeline.data && timeline.data.phases.length === 0 && <p className="py-3 text-center text-xs text-text-muted">No phases scheduled for this semester yet.</p>}
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import academic calendar" size="md"
        footer={<>
          <Button variant="outline" onClick={() => setImportOpen(false)}>Close</Button>
          <Button leftIcon={<Upload size={15} />} loading={importCal.isPending} disabled={!importFile} onClick={() => importCal.mutate()}>Upload</Button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-text-muted">Upload a <b>.csv</b> or <b>.xlsx</b> file with columns <b>Title, Start Date, End Date, Type, Description, Visibility</b>. Events appear in the grid and for every faculty and student. <button type="button" className="font-semibold text-primary underline" onClick={() => hodApi.calendar.template()}>Download template</button>.</p>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null) }}
            className="block w-full text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} className="h-4 w-4 accent-primary" /> Replace the existing calendar (recommended)</label>
          {importResult && (
            <div className="rounded-md bg-surface-2 p-3 text-xs">
              <div className="font-semibold text-success">Imported {importResult.imported} events{importResult.skipped ? ` · ${importResult.skipped} skipped` : ''}.</div>
              {importResult.warnings.length > 0 && <ul className="mt-1 list-disc pl-4 text-text-muted">{importResult.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </div>
          )}
        </div>
      </Modal>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit Event' : 'Add Event'}
          footer={
            <>
              {editing.id && (
                <Button variant="danger" leftIcon={<Trash2 size={15} />} onClick={() => del.mutate(editing.id!)} loading={del.isPending} className="mr-auto">Delete</Button>
              )}
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => save.mutate(editing)} loading={save.isPending} disabled={!editing.title || !(editing.startDate ?? editing.date)}>Save</Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Labeled label="Start Date *">
                <Input type="date" value={(editing.startDate ?? editing.date ?? '').slice(0, 10)}
                  onChange={(e) => setEditing((s) => {
                    const v = e.target.value
                    const end = s?.endDate && s.endDate >= v ? s.endDate : v
                    return { ...s, startDate: v, endDate: end, date: v }
                  })} />
              </Labeled>
              <Labeled label="End Date *">
                <Input type="date" value={(editing.endDate ?? editing.startDate ?? editing.date ?? '').slice(0, 10)}
                  min={(editing.startDate ?? editing.date ?? '').slice(0, 10)}
                  onChange={(e) => setEditing((s) => ({ ...s, endDate: e.target.value }))} />
              </Labeled>
              <Labeled label="Type">
                <Select value={editing.type ?? 'OTHER'} onChange={(e) => setEditing((s) => ({ ...s, type: e.target.value as HodCalendarEvent['type'] }))} options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
                {NON_WORKING_TYPES.has(editing.type ?? '') && <p className="mt-1 text-[10px] font-medium text-warning">Disables attendance &amp; hides the timetable on this day</p>}
              </Labeled>
            </div>
            {editing.type === 'EXAM' && (
              <Labeled label="Subject">
                <Select
                  value=""
                  onChange={(e) => { const code = subjects.data?.data.find((s) => s.id === e.target.value)?.code; if (code) setEditing((s) => ({ ...s, title: `${code} Exam` })) }}
                  placeholder="Pick subject → sets title"
                  options={(subjects.data?.data ?? []).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
                />
              </Labeled>
            )}
            <Labeled label="Title *"><Input value={editing.title ?? ''} onChange={(e) => setEditing((s) => ({ ...s, title: e.target.value }))} placeholder={editing.type === 'READING_HOLIDAY' ? 'Reading Holiday' : 'Event title'} /></Labeled>
            <Labeled label="Description"><Textarea value={editing.description ?? ''} onChange={(e) => setEditing((s) => ({ ...s, description: e.target.value }))} /></Labeled>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</label>{children}</div>
}
