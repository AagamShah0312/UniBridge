import { useMemo, useState } from 'react'
import { ExportMenu } from '@/components/shared/ExportMenu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Eye, GraduationCap, Trash2, Upload, UserPlus } from 'lucide-react'
import { hodApi } from '@/api/hod'
import { errorMessage } from '@/api/client'
import { useHodScope } from '@/hooks/hod/useHodScope'
import { useDebounce } from '@/hooks/shared/useDebounce'
import { useHistoryStore } from '@/stores/historyStore'
import { useTableSort } from '@/hooks/shared/useTableSort'
import type { StudentRow } from '@/types/hod'
import { PageShell } from '@/components/shared/PageShell'
import { FilterBar } from '@/components/shared/FilterBar'
import { SearchInput } from '@/components/shared/SearchInput'
import { CsvUploadModal } from '@/components/shared/CsvUploadModal'
import { AttendancePctCell } from '@/components/shared/AttendancePctCell'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { Avatar } from '@/components/ui/Avatar'
import { Table, Td, Th, Tr } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StudentProfileModal } from '@/components/shared/StudentProfileModal'
import { AddStudentModal } from './students/AddStudentModal'

const STATUSES = ['ACTIVE', 'AT_RISK', 'INACTIVE']

const statusTone = { ACTIVE: 'success', AT_RISK: 'danger', INACTIVE: 'neutral' } as const

export default function StudentsPage() {
  const qc = useQueryClient()
  const scope = useHodScope()
  const history = useHistoryStore()

  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('')
  const [batchId, setBatchId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const [profileOf, setProfileOf] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [deleteOf, setDeleteOf] = useState<StudentRow | null>(null)

  // ponytail: when a past semester is selected, pass its id → backend shows the students this HOD
  // managed then (read-only). null → live current view.
  const historySemesterId = history.semesterId
  const debouncedSearch = useDebounce(search)
  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      branch: branch || undefined,
      batchId: batchId || undefined,
      status: status || undefined,
      semesterId: historySemesterId || undefined,
      page: 1,
      limit: 10000, // fetch all → sort spans every student, then paginate client-side
    }),
    [debouncedSearch, branch, batchId, status, historySemesterId, page],
  )

  const list = useQuery({
    queryKey: ['hod', 'students', filters],
    queryFn: () => hodApi.students.list(filters),
  })
  // Full branch list (student.branch stores the code) — not just codes on the visible page.
  const branchesQ = useQuery({ queryKey: ['hod', 'branches'], queryFn: hodApi.onboarding.branches })
  const sort = useTableSort<StudentRow>(list.data?.data ?? [], { pageSize: 20 })
  const th = { activeKey: sort.sortKey, dir: sort.sortDir, onSort: sort.onSort }

  const del = useMutation({
    mutationFn: (enrollmentNo: string) => hodApi.students.remove(enrollmentNo),
    onSuccess: () => {
      toast.success('Student removed')
      qc.invalidateQueries({ queryKey: ['hod', 'students'] })
      setDeleteOf(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  // Graduation is only at Semester 8 (final), and only in the live (non-history) view.
  const isFinalSem = scope.data?.activeSemester?.number === 8 && !historySemesterId
  const graduate = useMutation({
    mutationFn: () => hodApi.graduateFinalYear(),
    onSuccess: (r) => { toast.success(`${r.graduated} students marked Pass Out`); qc.invalidateQueries({ queryKey: ['hod', 'students'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const batchOptions = scope.data?.batches.map((b) => ({ value: b.id, label: b.code })) ?? []

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setPage(1)
    }
  }

  const readOnly = !!historySemesterId

  return (
    <PageShell
      title="Students"
      subtitle={
        readOnly
          ? `${history.semesterLabel ?? 'Past semester'} — history (read-only)`
          : list.data ? `${list.data.total.toLocaleString('en-IN')} students` : 'Manage student records'
      }
      action={
        <div className="flex flex-wrap gap-2">
          <ExportMenu onExport={(f) => hodApi.students.export(filters, f)} />
          {!readOnly && (
            <>
              {isFinalSem && (
                <Button variant="outline" leftIcon={<GraduationCap size={15} />} loading={graduate.isPending}
                  onClick={() => { if (confirm('Mark all current final-year students as Pass Out? History is preserved; this cannot mark them back automatically.')) graduate.mutate() }}>
                  Graduate Final Year
                </Button>
              )}
              <Button variant="outline" leftIcon={<Upload size={15} />} onClick={() => setShowUpload(true)}>
                Upload CSV
              </Button>
              <Button leftIcon={<UserPlus size={15} />} onClick={() => setShowAdd(true)}>
                Add Student
              </Button>
            </>
          )}
        </div>
      }
    >
      {readOnly && (
        <div className="mb-4 flex items-center gap-2 rounded-sm border border-warning/30 bg-warning-light/30 px-3 py-2 text-xs text-warning">
          Viewing <b>{history.semesterLabel}</b> — students you managed then. Switch to <b>Current Semester</b> in the sidebar to make changes.
        </div>
      )}
      <FilterBar>
        <div className="w-64 max-w-full">
          <SearchInput value={search} onChange={resetPage(setSearch)} placeholder="Search name or enrollment no." />
        </div>
        <Select className="w-36" value={branch} onChange={(e) => resetPage(setBranch)(e.target.value)} placeholder="All Branches">
          {(branchesQ.data?.data ?? []).map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}
        </Select>
        <Select className="w-36" value={batchId} onChange={(e) => resetPage(setBatchId)(e.target.value)} placeholder="All Batches" options={batchOptions} />
        <Select className="w-40" value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} placeholder="All Status">
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </FilterBar>

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="p-4"><TableSkeleton rows={8} cols={6} /></div>
        ) : list.data && list.data.data.length === 0 ? (
          <EmptyState title="No students found" description="Try adjusting your filters or upload a student CSV." className="border-0" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th sortKey="name" {...th}>Student</Th>
                  <Th sortKey="enrollmentNo" {...th}>Enrollment No.</Th>
                  <Th sortKey="branch" {...th}>Branch</Th>
                  <Th sortKey="batchCode" {...th}>Batch</Th>
                  <Th sortKey="rollNo" {...th}>Roll No.</Th>
                  <Th sortKey="attendancePct" {...th}>Attendance</Th>
                  <Th sortKey="status" {...th}>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {sort.rows.map((s) => (
                  <Tr key={s.enrollmentNo}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={s.name} size={32} />
                        <span className="font-medium">{s.name}</span>
                        {s.graduationStatus === 'PASS_OUT' && <Badge tone="success">Passed Out</Badge>}
                        {s.graduationStatus === 'DETAINED' && <Badge tone="danger">Detained</Badge>}
                      </div>
                    </Td>
                    <Td className="font-mono text-xs text-text-secondary">{s.enrollmentNo}</Td>
                    <Td>{s.branch}</Td>
                    <Td>{s.batchCode ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-text-secondary">{s.rollNo ?? '—'}</Td>
                    <Td><AttendancePctCell pct={s.attendancePct} /></Td>
                    <Td><Badge tone={statusTone[s.status]}>{s.status.replace('_', ' ')}</Badge></Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setProfileOf(s.enrollmentNo)} className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-primary-light hover:text-primary" title="View profile">
                          <Eye size={16} />
                        </button>
                        {!readOnly && (
                          <button onClick={() => setDeleteOf(s)} className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-danger-light hover:text-danger" title="Remove">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {list.data && sort.totalPages > 1 && (
              <div className="border-t border-border px-3">
                <Pagination {...sort.pagination} />
              </div>
            )}
          </>
        )}
      </Card>

      {profileOf && (
        <StudentProfileModal
          enrollmentNo={profileOf}
          onClose={() => setProfileOf(null)}
          getFn={(e) => hodApi.students.get(e) as any}
          historyFn={(e) => hodApi.students.history(e) as any}
          queryKey="hod"
        />
      )}

      <AddStudentModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['hod', 'students'] })}
      />

      <CsvUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Upload Students"
        onUpload={hodApi.students.uploadCsv}
        onDownloadTemplate={hodApi.students.downloadTemplate}
        requiredColumns={['enrollment_no', 'name', 'branch', 'batch', 'roll_no']}
        extraFields={
          <p className="text-xs text-text-muted">
            Each row&rsquo;s <b>batch</b> column decides its batch. Enrolls into {scope.data?.activeSemester.label ?? 'the active semester'}.
          </p>
        }
        buildForm={(form) => {
          if (scope.data?.activeSemester.id) form.append('semesterId', scope.data.activeSemester.id)
        }}
      />

      <ConfirmDialog
        open={!!deleteOf}
        title="Remove student?"
        message={<>This soft-deletes <b>{deleteOf?.name}</b> ({deleteOf?.enrollmentNo}). Historical records are preserved.</>}
        destructive
        confirmLabel="Remove"
        loading={del.isPending}
        onConfirm={() => deleteOf && del.mutate(deleteOf.enrollmentNo)}
        onCancel={() => setDeleteOf(null)}
      />
    </PageShell>
  )
}
