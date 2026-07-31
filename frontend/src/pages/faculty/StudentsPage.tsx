import { useMemo, useState } from 'react'
import { useTableSort } from '@/hooks/shared/useTableSort'
import { ExportMenu } from '@/components/shared/ExportMenu'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { facultyApi } from '@/api/faculty'
import { useDebounce } from '@/hooks/shared/useDebounce'
import { useFacultyScope } from '@/hooks/faculty/useFacultyScope'
import { PageShell } from '@/components/shared/PageShell'
import { FilterBar } from '@/components/shared/FilterBar'
import { SearchInput } from '@/components/shared/SearchInput'
import { AttendancePctCell } from '@/components/shared/AttendancePctCell'
import { StudentProfileModal } from '@/components/shared/StudentProfileModal'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { Avatar } from '@/components/ui/Avatar'
import { Table, Td, Th, Tr } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'

const statusTone = { ACTIVE: 'success', AT_RISK: 'danger', INACTIVE: 'neutral' } as const

export default function FacultyStudentsPage() {
  const scope = useFacultyScope()
  const [search, setSearch] = useState('')
  const [batchId, setBatchId] = useState('')
  const [page, setPage] = useState(1)
  const [profileOf, setProfileOf] = useState<string | null>(null)
  const debounced = useDebounce(search)

  const batchOpts = useMemo(() => {
    const seen = new Set<string>()
    const opts: { value: string; label: string }[] = []
    scope.data?.assignments.forEach((a) => {
      if (!seen.has(a.batch.id)) { seen.add(a.batch.id); opts.push({ value: a.batch.id, label: a.batch.code }) }
    })
    return opts
  }, [scope.data])

  const list = useQuery({
    queryKey: ['faculty', 'students', { search: debounced, batchId, page }],
    queryFn: () => facultyApi.students({ search: debounced || undefined, batchId: batchId || undefined, page, limit: 10000 }),
  })

  // Fetch all → sort spans every student, then paginate client-side.
  const sort = useTableSort(list.data?.data ?? [], { pageSize: 20 })
  const th = { activeKey: sort.sortKey, dir: sort.sortDir, onSort: sort.onSort }

  return (
    <PageShell
      title="Students"
      subtitle={list.data ? `${list.data.total} students in your batches` : 'View-only student list'}
      action={<ExportMenu onExport={(f) => facultyApi.studentsExport({ search: debounced || undefined, batchId: batchId || undefined }, f)} />}
    >
      <FilterBar>
        <div className="w-64 max-w-full">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search name or enrollment no." />
        </div>
        <Select className="w-40" value={batchId} onChange={(e) => { setBatchId(e.target.value); setPage(1) }} placeholder="All Batches" options={batchOpts} />
      </FilterBar>

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="p-4"><TableSkeleton rows={6} cols={6} /></div>
        ) : list.data && list.data.data.length === 0 ? (
          <EmptyState title="No students" className="border-0" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th sortKey="name" {...th}>Student</Th>
                  <Th sortKey="enrollmentNo" {...th}>Enrollment No.</Th>
                  <Th sortKey="currentBatch.code" {...th}>Batch</Th>
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
                      </div>
                    </Td>
                    <Td className="font-mono text-xs text-text-secondary">{s.enrollmentNo}</Td>
                    <Td>{s.currentBatch?.code ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-text-secondary">{s.rollNo ?? '—'}</Td>
                    <Td><AttendancePctCell pct={s.attendancePct} /></Td>
                    <Td><Badge tone={statusTone[s.status]}>{s.status.replace('_', ' ')}</Badge></Td>
                    <Td>
                      <div className="flex justify-end">
                        <button onClick={() => setProfileOf(s.enrollmentNo)} className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-primary-light hover:text-primary" title="View profile & journey">
                          <Eye size={16} />
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

      {profileOf && (
        <StudentProfileModal
          enrollmentNo={profileOf}
          onClose={() => setProfileOf(null)}
          getFn={async (e) => {
            const p = await facultyApi.studentDetail(e) as any
            return {
              enrollmentNo: p.enrollmentNo, name: p.name, email: p.email ?? '', phone: p.phone ?? null,
              branch: p.branch, status: p.status,
              currentEnrollment: p.currentBatch ? { batchCode: p.currentBatch.code, semesterLabel: p.currentSemester?.label ?? '', rollNo: p.rollNo ?? '', attendancePct: p.attendancePct ?? 0 } : null,
            }
          }}
          historyFn={(e) => facultyApi.studentHistory(e)}
          queryKey="faculty"
        />
      )}
    </PageShell>
  )
}
