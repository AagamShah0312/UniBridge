import { useMemo, useState } from 'react'
import { useTableSort } from '@/hooks/shared/useTableSort'
import { ExportMenu } from '@/components/shared/ExportMenu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Eye, Trash2, Upload, UserPlus } from 'lucide-react'
import { hodApi } from '@/api/hod'
import { errorMessage } from '@/api/client'
import { useDebounce } from '@/hooks/shared/useDebounce'
import type { FacultyRow } from '@/types/hod'
import { PageShell } from '@/components/shared/PageShell'
import { FilterBar } from '@/components/shared/FilterBar'
import { SearchInput } from '@/components/shared/SearchInput'
import { CsvUploadModal } from '@/components/shared/CsvUploadModal'
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
import { HistoryBanner } from '@/components/hod/HistoryBanner'
import { useHistoryStore } from '@/stores/historyStore'
import { FacultyDetailModal } from './faculty/FacultyDetailModal'
import { AddFacultyModal } from './faculty/AddFacultyModal'

const YEAR_LABEL: Record<string, string> = { FY: '1st Year', SY: '2nd Year', TY: '3rd Year', FINAL: 'Final Year' }

export default function FacultyPage() {
  const qc = useQueryClient()
  const history = useHistoryStore()
  const readOnly = !!history.semesterId
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [detailOf, setDetailOf] = useState<FacultyRow | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [deleteOf, setDeleteOf] = useState<FacultyRow | null>(null)

  const debouncedSearch = useDebounce(search)
  const filters = useMemo(
    () => ({ search: debouncedSearch || undefined, role: role || undefined, status: status || undefined, semesterId: history.semesterId || undefined, page, limit: 10000 }),
    [debouncedSearch, role, status, history.semesterId, page],
  )

  const list = useQuery({ queryKey: ['hod', 'faculty', filters], queryFn: () => hodApi.faculty.list(filters) })

  const del = useMutation({
    mutationFn: (employeeId: string) => hodApi.faculty.remove(employeeId),
    onSuccess: () => {
      toast.success('Faculty removed')
      qc.invalidateQueries({ queryKey: ['hod', 'faculty'] })
      setDeleteOf(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const sort = useTableSort(list.data?.data ?? [], { pageSize: 10 })
  const th = { activeKey: sort.sortKey, dir: sort.sortDir, onSort: sort.onSort }

  return (
    <PageShell
      title="Faculty"
      subtitle={list.data ? `${list.data.total} faculty members` : 'Manage faculty & assignments'}
      action={
        <div className="flex flex-wrap gap-2">
          <ExportMenu onExport={(f) => hodApi.faculty.export(filters, f)} />
          {!readOnly && <>
            <Button variant="outline" leftIcon={<Upload size={15} />} onClick={() => setShowUpload(true)}>Upload CSV</Button>
            <Button leftIcon={<UserPlus size={15} />} onClick={() => setShowAdd(true)}>Add Faculty</Button>
          </>}
        </div>
      }
    >
      <HistoryBanner />
      <FilterBar>
        <div className="w-64 max-w-full">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search name or employee ID" />
        </div>
        <Select className="w-40" value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }} placeholder="All Roles">
          <option value="FACULTY">Faculty</option>
          <option value="HOD">HOD</option>
        </Select>
        <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} placeholder="All Status">
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </FilterBar>

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="p-4"><TableSkeleton rows={6} cols={6} /></div>
        ) : list.data && list.data.data.length === 0 ? (
          <EmptyState title="No faculty found" className="border-0" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th sortKey="name" {...th}>Faculty</Th>
                  <Th sortKey="employeeId" {...th}>Employee ID</Th>
                  <Th sortKey="year" {...th}>Year</Th>
                  <Th sortKey="mentorCode" {...th}>Mentor Code</Th>
                  <Th sortKey="subjectCount" {...th}>Subjects</Th>
                  <Th sortKey="menteeCount" {...th}>Mentees</Th>
                  <Th sortKey="isActive" {...th}>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {sort.rows.map((f) => (
                  <Tr key={f.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={f.name} size={32} />
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{f.name}</span>
                          {f.isHod && <Badge tone="purple">HOD</Badge>}
                        </div>
                      </div>
                    </Td>
                    <Td className="font-mono text-xs text-text-secondary">{f.employeeId}</Td>
                    <Td>{(f.year || f.yearLevel) ? <Badge tone="primary">{YEAR_LABEL[f.year || f.yearLevel!] ?? f.year}</Badge> : <span className="text-text-muted">—</span>}</Td>
                    <Td>{f.mentorCode ? <Badge tone="teal">{f.mentorCode}</Badge> : <span className="text-text-muted">—</span>}</Td>
                    <Td className="tabular-nums">{f.assignedSubjects ?? f.subjectCount ?? 0}</Td>
                    <Td className="tabular-nums">{f.menteeCount ?? 0}</Td>
                    <Td><Badge tone={(f.isActive ?? f.status === 'ACTIVE') ? 'success' : 'neutral'}>{f.isActive === false || f.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'}</Badge></Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setDetailOf(f)} className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-primary-light hover:text-primary" title="View">
                          <Eye size={16} />
                        </button>
                        <button onClick={() => setDeleteOf(f)} disabled={f.isHod} className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-danger-light hover:text-danger disabled:opacity-30" title="Remove">
                          <Trash2 size={16} />
                        </button>
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

      {detailOf && <FacultyDetailModal faculty={detailOf} onClose={() => setDetailOf(null)} />}
      <AddFacultyModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['hod', 'faculty'] })} />
      <CsvUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Upload Faculty"
        onUpload={hodApi.faculty.uploadCsv}
        requiredColumns={['employee_id', 'name', 'email', 'year']}
      />

      <ConfirmDialog
        open={!!deleteOf}
        title="Remove faculty?"
        message={<>This soft-deletes <b>{deleteOf?.name}</b>. Blocked if they have active assignments or mentees.</>}
        destructive
        confirmLabel="Remove"
        loading={del.isPending}
        onConfirm={() => deleteOf && del.mutate(deleteOf.employeeId)}
        onCancel={() => setDeleteOf(null)}
      />
    </PageShell>
  )
}
