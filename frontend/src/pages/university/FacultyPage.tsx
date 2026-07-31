import { useState } from 'react'
import { useTableSort } from '@/hooks/shared/useTableSort'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Crown, Pencil, Plus, Search, Trash2, Upload, Users } from 'lucide-react'
import { universityApi, type UniFacultyRow } from '@/api/university'
import { errorMessage } from '@/api/client'
import { PageShell } from '@/components/shared/PageShell'
import { CsvUploadModal } from '@/components/shared/CsvUploadModal'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Table, Th, Td, Tr } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/EmptyState'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

const YEAR_LABEL: Record<string, string> = { FY: '1st Year', SY: '2nd Year', TY: '3rd Year', FINAL: 'Final Year' }

export default function UniversityFacultyPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [editing, setEditing] = useState<UniFacultyRow | null>(null)
  const [deleteOf, setDeleteOf] = useState<UniFacultyRow | null>(null)
  const [promoteOf, setPromoteOf] = useState<UniFacultyRow | null>(null)

  const q = useQuery({ queryKey: ['uni', 'faculty', search, page], queryFn: () => universityApi.faculty({ search: search || undefined, page, limit: 10000 }) })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['uni', 'faculty'] })

  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => universityApi.setFacultyActive(v.id, v.isActive),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: (id: string) => universityApi.deleteFaculty(id),
    onSuccess: () => { toast.success('Faculty removed'); setDeleteOf(null); invalidate() },
    onError: (e) => { toast.error(errorMessage(e)); setDeleteOf(null) },
  })
  const promote = useMutation({
    mutationFn: (id: string) => universityApi.promoteToHod(id),
    onSuccess: () => { toast.success('Promoted to HOD'); setPromoteOf(null); invalidate() },
    onError: (e) => { toast.error(errorMessage(e)); setPromoteOf(null) },
  })

  const sort = useTableSort(q.data?.data ?? [], { pageSize: 20 })
  const th = { activeKey: sort.sortKey, dir: sort.sortDir, onSort: sort.onSort }

  return (
    <PageShell
      title="Faculty"
      subtitle={q.data ? `${q.data.total} faculty members` : 'All faculty in the university'}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" leftIcon={<Upload size={15} />} onClick={() => setShowUpload(true)}>Upload CSV</Button>
          <Button leftIcon={<Plus size={15} />} onClick={() => setShowCreate(true)}>Add Faculty</Button>
        </div>
      }
    >
      <div className="mb-4 max-w-xs">
        <Input leftIcon={<Search size={15} />} placeholder="Search name, email, employee ID…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>

      {q.isLoading ? (
        <CardSkeleton height={240} />
      ) : (q.data?.data ?? []).length === 0 ? (
        <EmptyState icon={<Users size={22} />} title="No faculty found" />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <thead><tr><Th sortKey="employeeId" {...th}>Employee ID</Th><Th sortKey="name" {...th}>Name</Th><Th sortKey="email" {...th}>Email</Th><Th sortKey="year" {...th}>Year</Th><Th sortKey="mentorCode" {...th}>Mentor</Th><Th sortKey="isHod" {...th}>Role</Th><Th sortKey="isActive" {...th}>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {sort.rows.map((f) => (
                <Tr key={f.id}>
                  <Td className="whitespace-nowrap font-mono text-xs">{f.employeeId}</Td>
                  <Td className="font-medium">{f.name}</Td>
                  <Td className="text-xs">{f.email}</Td>
                  <Td>
                    {f.year
                      ? <Badge tone="primary">{YEAR_LABEL[f.year] ?? f.year}</Badge>
                      : <span className="text-text-muted">—</span>}
                  </Td>
                  <Td>{f.mentorCode ? <Badge tone="teal">{f.mentorCode}</Badge> : <span className="text-text-muted">—</span>}</Td>
                  <Td><Badge tone={f.isHod ? 'purple' : 'neutral'}>{f.isHod ? 'HOD' : 'Faculty'}</Badge></Td>
                  <Td><Badge tone={f.isActive ? 'success' : 'danger'}>{f.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {!f.isHod && (
                        <button onClick={() => setPromoteOf(f)} className="flex h-8 w-8 items-center justify-center rounded-sm text-purple hover:bg-purple-light" title="Promote to HOD"><Crown size={15} /></button>
                      )}
                      <button onClick={() => setEditing(f)} className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-primary-light hover:text-primary" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => toggle.mutate({ id: f.id, isActive: !f.isActive })} className="rounded-sm border border-border px-2 text-xs hover:bg-surface-2">
                        {f.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => setDeleteOf(f)} className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-danger-light hover:text-danger" title="Delete"><Trash2 size={15} /></button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {sort.totalPages > 1 && (
            <div className="border-t border-border p-3">
              <Pagination {...sort.pagination} />
            </div>
          )}
        </Card>
      )}

      <CreateFacultyModal open={showCreate} onClose={() => setShowCreate(false)} onDone={invalidate} />
      {editing && <EditFacultyModal faculty={editing} onClose={() => setEditing(null)} onDone={invalidate} />}

      <CsvUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Upload Faculty"
        onUpload={universityApi.uploadFacultyCsv}
        onDownloadTemplate={universityApi.downloadFacultyTemplate}
        requiredColumns={['employee_id', 'name', 'year', 'mentor_code']}
        optionalColumns={['email']}
        extraFields={<p className="text-xs text-text-muted">Email is auto-generated as <b>&lt;name&gt;@mail.ljku.edu.in</b> when blank. <b>year</b> = FY/SY/TY/FINAL.</p>}
      />

      <ConfirmDialog
        open={!!deleteOf}
        title="Delete faculty?"
        message={<>Remove <b>{deleteOf?.name}</b>? Blocked if they own batches as a HOD.</>}
        destructive confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => deleteOf && del.mutate(deleteOf.id)}
        onCancel={() => setDeleteOf(null)}
      />

      <ConfirmDialog
        open={!!promoteOf}
        title="Promote to HOD?"
        message={<>Promote <b>{promoteOf?.name}</b> to HOD. Their teaching history and mentor code will be cleared for the HOD role; future batches/branches can be assigned.</>}
        confirmLabel="Promote"
        loading={promote.isPending}
        onConfirm={() => promoteOf && promote.mutate(promoteOf.id)}
        onCancel={() => setPromoteOf(null)}
      />
    </PageShell>
  )
}

function CreateFacultyModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', employeeId: '', year: 'FY', mentorCode: '', password: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const m = useMutation({
    // year is stored in "year" until a proper roster table lands
    mutationFn: () => universityApi.createFaculty({
      name: f.name, email: f.email || `${f.name.toLowerCase().replace(/\s+/g, '.')}@mail.ljku.edu.in`,
      employeeId: f.employeeId, year: f.year, password: f.password, mentorCode: f.mentorCode || null, role: 'FACULTY',
    }),
    onSuccess: () => { toast.success('Faculty created'); onDone(); onClose(); setF({ name: '', email: '', employeeId: '', year: 'FY', mentorCode: '', password: '' }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const ready = f.name && f.employeeId && f.year && f.password.length >= 8
  return (
    <Modal open={open} onClose={onClose} title="Add Faculty"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending} disabled={!ready}>Create</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name *"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="Employee ID *"><Input value={f.employeeId} onChange={set('employeeId')} placeholder="EMP207" /></Field>
        </div>
        <Field label="Email (leave blank to auto-generate)"><Input type="email" value={f.email} onChange={set('email')} placeholder={f.name ? `${f.name.toLowerCase().replace(/\s+/g, '.')}@mail.ljku.edu.in` : ''} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Year *">
            <Select value={f.year} onChange={(e) => setF((s) => ({ ...s, year: e.target.value }))}
              options={[{ value: 'FY', label: '1st Year' }, { value: 'SY', label: '2nd Year' }, { value: 'TY', label: '3rd Year' }, { value: 'FINAL', label: 'Final Year' }]} />
          </Field>
          <Field label="Mentor Code"><Input value={f.mentorCode} onChange={set('mentorCode')} placeholder="RPT" maxLength={3} /></Field>
          <Field label="Password *"><Input type="password" value={f.password} onChange={set('password')} /></Field>
        </div>
      </div>
    </Modal>
  )
}

function EditFacultyModal({ faculty, onClose, onDone }: { faculty: UniFacultyRow; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: faculty.name, email: faculty.email, employeeId: faculty.employeeId, mentorCode: faculty.mentorCode ?? '', year: faculty.year ?? 'FY' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const m = useMutation({
    mutationFn: () => universityApi.updateFaculty(faculty.id, { name: f.name, email: f.email, employeeId: f.employeeId, mentorCode: f.mentorCode || null, year: f.year }),
    onSuccess: () => { toast.success('Faculty updated'); onDone(); onClose() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Modal open onClose={onClose} title="Edit Faculty"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="Employee ID"><Input value={f.employeeId} onChange={set('employeeId')} /></Field>
        </div>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year">
            <Select value={f.year} onChange={(e) => setF((s) => ({ ...s, year: e.target.value }))}
              options={Object.entries(YEAR_LABEL).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Mentor Code"><Input value={f.mentorCode} onChange={set('mentorCode')} maxLength={3} /></Field>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-xs font-semibold uppercase text-text-secondary">{label}</label>{children}</div>
}
