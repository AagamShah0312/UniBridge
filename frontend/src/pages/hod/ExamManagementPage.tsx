import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle2, Lock, LockOpen, Plus, RefreshCw, Send, Trash2, Undo2, Wand2 } from 'lucide-react'
import { examApi, type ExamSchedule } from '@/api/exam'
import { errorMessage } from '@/api/client'
import { PageShell } from '@/components/shared/PageShell'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import { Table, Td, Th, Tr } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'

const fmtDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '')

const TABS = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'supervision', label: 'Supervision' },
  { key: 'paper', label: 'Paper Checking' },
  { key: 'standby', label: 'Standby' },
  { key: 'external', label: 'External Faculty' },
  { key: 'conflicts', label: 'Conflicts & Publish' },
]

export default function ExamManagementPage() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['exam'] })
  const [examId, setExamId] = useState('')
  const [tab, setTab] = useState('calendar')
  const [scheduleId, setScheduleId] = useState('')
  const [newExamOpen, setNewExamOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [excludeHods, setExcludeHods] = useState(false)

  const exams = useQuery({ queryKey: ['exam', 'list'], queryFn: examApi.list })
  useEffect(() => { if (!examId && exams.data?.exams[0]) setExamId(exams.data.exams[0].id) }, [exams.data, examId])
  const detail = useQuery({ queryKey: ['exam', 'detail', examId], queryFn: () => examApi.get(examId), enabled: !!examId })
  const dash = useQuery({ queryKey: ['exam', 'dash', examId], queryFn: () => examApi.dashboard(examId), enabled: !!examId })
  const schedules = detail.data?.schedules ?? []
  useEffect(() => { if (schedules.length && !schedules.find((s) => s.id === scheduleId)) setScheduleId(schedules[0].id) }, [schedules, scheduleId])

  const create = useMutation({ mutationFn: examApi.create, onSuccess: () => { toast.success('Exam created'); setNewExamOpen(false); setNewName(''); invalidate() }, onError: (e) => toast.error(errorMessage(e)) })
  const genBlocks = useMutation({ mutationFn: () => examApi.generateBlocks(examId), onSuccess: (r: { blocks?: number; students?: number }) => { toast.success(`Generated ${r.blocks ?? 0} blocks (${r.students ?? 0} students)`); invalidate() }, onError: (e) => toast.error(errorMessage(e)) })
  const publish = useMutation({ mutationFn: () => examApi.publish(examId), onSuccess: (r: { notified?: number }) => { toast.success(`Published · ${r.notified ?? 0} faculty notified`); invalidate() }, onError: (e) => toast.error(errorMessage(e)) })
  const unpublish = useMutation({ mutationFn: () => examApi.unpublish(examId), onSuccess: () => { toast.success('Unpublished'); invalidate() }, onError: (e) => toast.error(errorMessage(e)) })

  const published = detail.data?.exam.status === 'PUBLISHED'

  return (
    <PageShell title="Examination System" subtitle="Year-level exam blocks, supervision & paper-checking allocation"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-56" value={examId} onChange={(e) => setExamId(e.target.value)}
            options={(exams.data?.exams ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.status})` }))} placeholder="Select exam" />
          <Button variant="outline" leftIcon={<Plus size={15} />} onClick={() => setNewExamOpen(true)}>New Exam</Button>
        </div>
      }>
      {!examId ? (
        <EmptyState title="No examinations yet" description="Create an examination session (e.g. T-1 Internal) to begin." />
      ) : (
        <>
          {dash.data && (
            <div className="mb-5 grid grid-cols-2 gap-3.5 md:grid-cols-4 xl:grid-cols-6">
              <StatCard value={dash.data.totalSchedules} label="Exam Days" />
              <StatCard value={dash.data.generatedBlocks} label="Blocks" />
              <StatCard value={dash.data.allocatedBlocks} label="Allocated" />
              <StatCard value={dash.data.pendingBlocks} label="Pending" icon={<AlertTriangle size={16} className="text-warning" />} iconBg="var(--warning-light)" />
              <StatCard value={dash.data.standbyFaculties} label="Standby" />
              <StatCard value={dash.data.externalFaculties} label="External" />
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">{detail.data?.exam.name}</span>
              <Badge tone={published ? 'success' : 'warning'}>{published ? 'Published' : 'Draft'}</Badge>
              {detail.data && <Badge tone="primary">{detail.data.exam.yearLevel}</Badge>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} loading={genBlocks.isPending} disabled={published} onClick={() => genBlocks.mutate()}>Generate Blocks</Button>
              {published
                ? <Button variant="outline" size="sm" leftIcon={<Undo2 size={14} />} loading={unpublish.isPending} onClick={() => unpublish.mutate()}>Unpublish</Button>
                : <Button size="sm" leftIcon={<Send size={14} />} loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>}
            </div>
          </div>

          <Tabs className="mb-4" value={tab} onChange={setTab} tabs={TABS} />

          {tab === 'calendar' && <CalendarTab examId={examId} schedules={schedules} published={published} onChange={invalidate} />}
          {tab === 'blocks' && <BlocksTab examId={examId} />}
          {tab === 'external' && <ExternalTab examId={examId} />}
          {(tab === 'supervision' || tab === 'paper' || tab === 'standby') && (
            <div className="space-y-3">
              <Select className="w-full max-w-md" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}
                options={schedules.map((s) => ({ value: s.id, label: `${s.subjectCode} · ${fmtDate(s.date)} · ${s.startTime}` }))} placeholder="Select an exam day" />
              {!scheduleId ? <EmptyState title="Pick an exam day" description="Choose a subject/day above to allocate." />
                : tab === 'supervision' ? <SupervisionTab scheduleId={scheduleId} />
                : tab === 'paper' ? <PaperTab scheduleId={scheduleId} />
                : <StandbyTab scheduleId={scheduleId} />}
            </div>
          )}
          {tab === 'conflicts' && <ConflictsTab examId={examId} />}
        </>
      )}

      <Modal open={newExamOpen} onClose={() => setNewExamOpen(false)} title="New examination" size="sm"
        footer={<><Button variant="outline" onClick={() => setNewExamOpen(false)}>Cancel</Button>
          <Button loading={create.isPending} onClick={() => newName.trim() && create.mutate({ name: newName, excludeHods })}>Create</Button></>}>
        <Input label="Exam name" placeholder="T-1 Internal Examination" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={excludeHods} onChange={(e) => setExcludeHods(e.target.checked)} className="h-4 w-4 accent-primary" /> Exclude HODs from supervision duty</label>
      </Modal>
    </PageShell>
  )
}

// ── Calendar ──
function CalendarTab({ examId, schedules, published, onChange }: { examId: string; schedules: ExamSchedule[]; published: boolean; onChange: () => void }) {
  const subjects = useQuery({ queryKey: ['exam', 'subjects'], queryFn: examApi.yearSubjects })
  const [form, setForm] = useState({ subjectId: '', date: '', startTime: '14:00', endTime: '15:15' })
  const add = useMutation({ mutationFn: () => examApi.addSchedule(examId, form), onSuccess: () => { toast.success('Exam day added'); setForm({ ...form, subjectId: '' }); onChange() }, onError: (e) => toast.error(errorMessage(e)) })
  const del = useMutation({ mutationFn: (id: string) => examApi.deleteSchedule(id), onSuccess: () => { toast.success('Removed'); onChange() }, onError: (e) => toast.error(errorMessage(e)) })
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2 overflow-hidden">
        <CardHeader title="Exam Calendar" subtitle="One subject per slot; timing drives all allocation" />
        {schedules.length === 0 ? <EmptyState title="No exam days yet" description="Add a subject/date/time on the right." className="border-0" /> : (
          <Table>
            <thead><tr><Th>Subject</Th><Th>Date</Th><Th>Time</Th><Th>Students</Th><Th /></tr></thead>
            <tbody>
              {schedules.map((s) => (
                <Tr key={s.id}>
                  <Td><div className="font-medium">{s.subjectCode}</div><div className="text-[11px] text-text-muted">{s.subjectName}</div></Td>
                  <Td>{fmtDate(s.date)}</Td>
                  <Td className="tabular-nums">{s.startTime}–{s.endTime}</Td>
                  <Td className="tabular-nums">{s.studentCount}</Td>
                  <Td className="text-right">{!published && <button title="Remove" onClick={() => del.mutate(s.id)} className="text-text-muted hover:text-danger"><Trash2 size={15} /></button>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Add exam day" />
        <CardBody className="space-y-3">
          <div><label className="mb-1 block text-xs font-medium text-text-muted">Subject</label>
            <Select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} placeholder="Choose subject"
              options={(subjects.data ?? []).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))} /></div>
          <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Start" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            <Input label="End" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </div>
          <Button className="w-full" leftIcon={<Plus size={15} />} loading={add.isPending} disabled={published || !form.subjectId || !form.date}
            onClick={() => add.mutate()}>Add to calendar</Button>
        </CardBody>
      </Card>
    </div>
  )
}

// ── Blocks ──
function BlocksTab({ examId }: { examId: string }) {
  const qc = useQueryClient()
  const blocks = useQuery({ queryKey: ['exam', 'blocks', examId], queryFn: () => examApi.blocks(examId) })
  const room = useMutation({ mutationFn: ({ id, room }: { id: string; room: string }) => examApi.setBlockRoom(id, room), onSuccess: () => qc.invalidateQueries({ queryKey: ['exam'] }), onError: (e) => toast.error(errorMessage(e)) })
  const lock = useMutation({ mutationFn: ({ id, isLocked }: { id: string; isLocked: boolean }) => examApi.lockBlock(id, isLocked), onSuccess: () => qc.invalidateQueries({ queryKey: ['exam'] }), onError: (e) => toast.error(errorMessage(e)) })
  if (blocks.isLoading) return <p className="text-sm text-text-muted">Loading blocks…</p>
  if (!blocks.data?.length) return <EmptyState title="No blocks generated" description="Use “Generate Blocks” above to build 20-student blocks per HOD." />
  return (
    <Card className="overflow-hidden">
      <Table>
        <thead><tr><Th>Block</Th><Th>Owner HOD</Th><Th>Students</Th><Th>Enrollment range</Th><Th>Room</Th><Th /></tr></thead>
        <tbody>
          {blocks.data.map((b) => (
            <Tr key={b.id}>
              <Td className="font-semibold">Block {b.blockNumber}{b.isLocked && <Lock size={12} className="ml-1 inline text-teal" />}</Td>
              <Td>{b.ownerHodName}</Td>
              <Td className="tabular-nums">{b.studentCount}</Td>
              <Td className="font-mono text-[11px]">{b.firstEnrollment} – {b.lastEnrollment}</Td>
              <Td>
                <input defaultValue={b.room ?? ''} placeholder="Room" onBlur={(e) => e.target.value !== (b.room ?? '') && room.mutate({ id: b.id, room: e.target.value })}
                  className="w-24 rounded-sm border border-border bg-surface px-2 py-1 text-xs" />
              </Td>
              <Td className="text-right">
                <button title={b.isLocked ? 'Unlock' : 'Lock'} onClick={() => lock.mutate({ id: b.id, isLocked: !b.isLocked })} className="text-text-muted hover:text-teal">
                  {b.isLocked ? <Lock size={15} /> : <LockOpen size={15} />}
                </button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  )
}

// ── Supervision ──
function SupervisionTab({ scheduleId }: { scheduleId: string }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['exam', 'supervision', scheduleId], queryFn: () => examApi.supervision(scheduleId) })
  const avail = useQuery({ queryKey: ['exam', 'availability', scheduleId], queryFn: () => examApi.availability(scheduleId) })
  const gen = useMutation({ mutationFn: () => examApi.generateSupervision(scheduleId), onSuccess: (r: { unfilled?: number }) => { toast.success(r.unfilled ? `Allocated · ${r.unfilled} unfilled` : 'Supervision allocated'); qc.invalidateQueries({ queryKey: ['exam'] }) }, onError: (e) => toast.error(errorMessage(e)) })
  const edit = useMutation({ mutationFn: ({ id, facultyId }: { id: string; facultyId: string }) => examApi.editSupervision(id, { facultyId }), onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['exam'] }) }, onError: (e) => toast.error(errorMessage(e)) })
  const freeFac = (avail.data?.faculties ?? []).filter((f) => f.free)
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Supervision Allocation" subtitle={avail.data ? `Window ${avail.data.window} · ${freeFac.length} free faculty` : undefined}
        action={<Button size="sm" leftIcon={<Wand2 size={14} />} loading={gen.isPending} onClick={() => gen.mutate()}>Auto-allocate</Button>} />
      {!list.data?.length ? <EmptyState title="Not allocated" description="Run auto-allocate to assign supervisors (own year first, then other years, then external)." className="border-0" /> : (
        <Table>
          <thead><tr><Th>Block</Th><Th>Room</Th><Th>Supervisor</Th><Th>Source</Th><Th>Reassign (free only)</Th></tr></thead>
          <tbody>
            {list.data.map((a) => (
              <Tr key={a.id}>
                <Td className="font-semibold">Block {a.blockNumber}</Td>
                <Td>{a.room ?? '—'}</Td>
                <Td>{a.supervisor}</Td>
                <Td><Badge tone={a.source === 'OWN_YEAR' ? 'success' : a.source === 'EXTERNAL' ? 'warning' : 'primary'}>{a.source.replace('_', ' ')}</Badge></Td>
                <Td>
                  <Select className="min-w-[200px]" value={a.facultyId ?? ''} onChange={(e) => e.target.value && edit.mutate({ id: a.id, facultyId: e.target.value })}
                    options={[{ value: '', label: 'Change…' }, ...freeFac.map((f) => ({ value: f.facultyId, label: `${f.name} (${f.employeeId})${f.isOwnYear ? '' : ` · ${f.year}`}` }))]} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ── Paper checking ──
function PaperTab({ scheduleId }: { scheduleId: string }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['exam', 'paper', scheduleId], queryFn: () => examApi.paperChecking(scheduleId) })
  const gen = useMutation({ mutationFn: () => examApi.generatePaperChecking(scheduleId), onSuccess: () => { toast.success('Paper checking allocated'); qc.invalidateQueries({ queryKey: ['exam'] }) }, onError: (e) => toast.error(errorMessage(e)) })
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Paper Checking Allocation" subtitle="Continuous block ranges to subject faculty only"
        action={<Button size="sm" leftIcon={<Wand2 size={14} />} loading={gen.isPending} onClick={() => gen.mutate()}>Auto-allocate</Button>} />
      {!list.data?.length ? <EmptyState title="Not allocated" description="Run auto-allocate to distribute continuous block ranges equally among subject faculty." className="border-0" /> : (
        <Table>
          <thead><tr><Th>Faculty</Th><Th>Block range</Th><Th>Blocks</Th></tr></thead>
          <tbody>
            {list.data.map((p) => (
              <Tr key={p.id}><Td className="font-medium">{p.faculty}</Td><Td>{p.range}</Td><Td className="tabular-nums">{p.blockCount}</Td></Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ── Standby ──
function StandbyTab({ scheduleId }: { scheduleId: string }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['exam', 'standby', scheduleId], queryFn: () => examApi.standby(scheduleId) })
  const gen = useMutation({ mutationFn: () => examApi.generateStandby(scheduleId), onSuccess: () => { toast.success('Standby selected'); qc.invalidateQueries({ queryKey: ['exam'] }) }, onError: (e) => toast.error(errorMessage(e)) })
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Standby Faculty" subtitle="2 subject faculty on standby (not on active duty)"
        action={<Button size="sm" leftIcon={<Wand2 size={14} />} loading={gen.isPending} onClick={() => gen.mutate()}>Auto-select</Button>} />
      {!list.data?.length ? <EmptyState title="No standby" description="Run auto-select to pick 2 free subject faculty." className="border-0" /> : (
        <Table>
          <thead><tr><Th>Slot</Th><Th>Faculty</Th><Th>Status</Th></tr></thead>
          <tbody>
            {list.data.map((s) => (
              <Tr key={s.slot}><Td>Standby {s.slot}</Td><Td>{s.faculty}</Td><Td><Badge tone={s.isActive ? 'success' : 'muted'}>{s.isActive ? 'Active' : 'Standby'}</Badge></Td></Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ── External faculty ──
function ExternalTab({ examId }: { examId: string }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['exam', 'external', examId], queryFn: () => examApi.external(examId) })
  const [form, setForm] = useState({ name: '', mobile: '', college: '', experience: '', remarks: '' })
  const add = useMutation({ mutationFn: () => examApi.addExternal(examId, form), onSuccess: () => { toast.success('External faculty added'); setForm({ name: '', mobile: '', college: '', experience: '', remarks: '' }); qc.invalidateQueries({ queryKey: ['exam'] }) }, onError: (e) => toast.error(errorMessage(e)) })
  const del = useMutation({ mutationFn: (id: string) => examApi.removeExternal(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['exam'] }), onError: (e) => toast.error(errorMessage(e)) })
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2 overflow-hidden">
        <CardHeader title="External Invigilators" subtitle="Temporary — used only for this examination" />
        {!list.data?.length ? <EmptyState title="None added" description="Add external invigilators on the right; they can then be used in supervision." className="border-0" /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>College</Th><Th>Mobile</Th><Th>Experience</Th><Th /></tr></thead>
            <tbody>
              {list.data.map((e) => (
                <Tr key={e.id}><Td className="font-medium">{e.name}</Td><Td>{e.college ?? '—'}</Td><Td>{e.mobile ?? '—'}</Td><Td>{e.experience ?? '—'}</Td>
                  <Td className="text-right"><button onClick={() => del.mutate(e.id)} className="text-text-muted hover:text-danger"><Trash2 size={15} /></button></Td></Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Add external" />
        <CardBody className="space-y-2">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <Input label="College" value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} />
          <Input label="Experience" value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} />
          <Button className="w-full" leftIcon={<Plus size={15} />} loading={add.isPending} disabled={!form.name.trim()} onClick={() => add.mutate()}>Add</Button>
        </CardBody>
      </Card>
    </div>
  )
}

// ── Conflicts & publish ──
function ConflictsTab({ examId }: { examId: string }) {
  const conflicts = useQuery({ queryKey: ['exam', 'conflicts', examId], queryFn: () => examApi.conflicts(examId) })
  return (
    <Card>
      <CardHeader title="Conflict Detection" subtitle="Validation runs automatically before publishing" />
      <CardBody>
        {conflicts.isLoading ? <p className="text-sm text-text-muted">Checking…</p>
          : conflicts.data?.ok ? (
            <div className="flex items-center gap-2 rounded-md bg-success-light px-4 py-3 text-sm text-success"><CheckCircle2 size={18} /> No conflicts detected — ready to publish.</div>
          ) : (
            <ul className="space-y-2">
              {conflicts.data?.conflicts.map((c, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md bg-danger-light px-4 py-2 text-sm text-danger">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><b>{c.type.replace(/_/g, ' ')}:</b> {c.detail}</span>
                </li>
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  )
}
