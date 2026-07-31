import { useState } from 'react'
import { useTableSort } from '@/hooks/shared/useTableSort'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Eye, GraduationCap, Search } from 'lucide-react'
import { universityApi } from '@/api/university'
import { errorMessage } from '@/api/client'
import { PageShell } from '@/components/shared/PageShell'
import { StudentProfileModal } from '@/components/shared/StudentProfileModal'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table, Th, Td, Tr } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/EmptyState'
import { CardSkeleton } from '@/components/ui/Skeleton'

export default function UniversityStudentsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('')
  const [page, setPage] = useState(1)
  const [profileOf, setProfileOf] = useState<string | null>(null)

  // branch filter options come from the university's universal branch list
  const branchesQ = useQuery({ queryKey: ['uni', 'branches'], queryFn: universityApi.branches })
  const q = useQuery({
    queryKey: ['uni', 'students', search, branch, page],
    queryFn: () => universityApi.students({ search: search || undefined, branch: branch || undefined, page, limit: 10000 }),
  })
  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => universityApi.setStudentActive(v.id, v.isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uni', 'students'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const sort = useTableSort(q.data?.data ?? [], { pageSize: 20 })
  const th = { activeKey: sort.sortKey, dir: sort.sortDir, onSort: sort.onSort }

  return (
    <PageShell title="Students" subtitle={q.data ? `${q.data.total} students across the university` : 'University-wide student registry'}>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input leftIcon={<Search size={15} />} placeholder="Search name, enrollment no, email…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="max-w-xs" />
        <Select value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1) }} className="w-36">
          <option value="">All branches</option>
          {(branchesQ.data?.data ?? []).map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}
        </Select>
      </div>

      {q.isLoading ? (
        <CardSkeleton height={280} />
      ) : (q.data?.data ?? []).length === 0 ? (
        <EmptyState icon={<GraduationCap size={22} />} title="No students found" />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <thead><tr><Th sortKey="enrollmentNo" {...th}>Enrollment No</Th><Th sortKey="name" {...th}>Name</Th><Th sortKey="branch" {...th}>Branch</Th><Th sortKey="academicYearLabel" {...th}>Academic Year</Th><Th sortKey="semesterLabel" {...th}>Semester</Th><Th sortKey="batchCode" {...th}>Batch</Th><Th sortKey="rollNo" {...th}>Roll No</Th><Th sortKey="isActive" {...th}>Status</Th><Th /></tr></thead>
            <tbody>
              {sort.rows.map((s) => (
                <Tr key={s.id}>
                  <Td className="whitespace-nowrap font-mono text-xs">{s.enrollmentNo}</Td>
                  <Td className="font-medium">{s.name}</Td>
                  <Td><Badge tone="primary">{s.branch}</Badge></Td>
                  <Td className="whitespace-nowrap">{s.academicYearLabel ?? '—'}</Td>
                  <Td>{s.semesterLabel ?? '—'}</Td>
                  <Td>{s.batchCode ?? '—'}</Td>
                  <Td className="font-mono text-xs">{s.rollNo ?? '—'}</Td>
                  <Td><Badge tone={s.isActive ? 'success' : 'danger'}>{s.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setProfileOf(s.enrollmentNo)} className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-primary-light hover:text-primary" title="View profile & journey">
                        <Eye size={16} />
                      </button>
                      <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: s.id, isActive: !s.isActive })}>
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
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

      {profileOf && (
        <StudentProfileModal
          enrollmentNo={profileOf}
          onClose={() => setProfileOf(null)}
          getFn={(e) => universityApi.studentDetail(e) as any}
          historyFn={(e) => universityApi.studentHistory(e)}
          queryKey="uni"
        />
      )}
    </PageShell>
  )
}
