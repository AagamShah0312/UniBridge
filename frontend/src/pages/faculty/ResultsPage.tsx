import { useMemo, useState } from 'react'
import { useTableSort } from '@/hooks/shared/useTableSort'
import { ExportMenu } from '@/components/shared/ExportMenu'
import { useQuery } from '@tanstack/react-query'
import { facultyApi } from '@/api/faculty'
import { useFacultyScope } from '@/hooks/faculty/useFacultyScope'
import { PageShell } from '@/components/shared/PageShell'
import { FilterBar } from '@/components/shared/FilterBar'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { Table, Td, Th, Tr } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { TableSkeleton, StatCardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'

export default function FacultyResultsPage() {
  const scope = useFacultyScope()
  const [subjectId, setSubjectId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [phase, setPhase] = useState('')
  const [page, setPage] = useState(1)

  const list = useQuery({
    queryKey: ['faculty', 'results', { subjectId, batchId, phase, page }],
    queryFn: () => facultyApi.results({ subjectId: subjectId || undefined, batchId: batchId || undefined, phase: phase || undefined, page, limit: 10000 }),
  })

  const subjectOpts = useMemo(() => {
    const seen = new Set<string>()
    return scope.data?.assignments
      .filter((a) => !seen.has(a.subject.id) && seen.add(a.subject.id))
      .map((a) => ({ value: a.subject.id, label: `${a.subject.code}` })) ?? []
  }, [scope.data])
  const batchOpts = useMemo(() => {
    const seen = new Set<string>()
    return scope.data?.assignments
      .filter((a) => !seen.has(a.batch.id) && seen.add(a.batch.id))
      .map((a) => ({ value: a.batch.id, label: a.batch.code })) ?? []
  }, [scope.data])

  const sort = useTableSort(list.data?.data ?? [], { pageSize: 20 })
  const th = { activeKey: sort.sortKey, dir: sort.sortDir, onSort: sort.onSort }

  return (
    <PageShell title="Results" subtitle="View published results for your subjects"
      action={<ExportMenu onExport={(f) => facultyApi.resultsExport({ subjectId: subjectId || undefined, batchId: batchId || undefined, phase: phase || undefined }, f)} />}
    >
      <div className="mb-5 grid grid-cols-2 gap-3.5 md:grid-cols-3">
        {list.isLoading ? (
          <StatCardSkeleton count={3} />
        ) : list.data?.stats ? (
          <>
            <StatCard value={`${Math.round(list.data.stats.avgMarksPct)}%`} label="Avg Marks" />
            <StatCard value={list.data.stats.passCount} label="Pass" trend="up" delta="≥40%" />
            <StatCard value={list.data.stats.failCount} label="Fail" trend="down" delta="<40%" />
          </>
        ) : null}
      </div>

      <FilterBar>
        <Select className="w-40" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setPage(1) }} placeholder="All Subjects" options={subjectOpts} />
        <Select className="w-32" value={batchId} onChange={(e) => { setBatchId(e.target.value); setPage(1) }} placeholder="All Batches" options={batchOpts} />
        <Select className="w-32" value={phase} onChange={(e) => { setPhase(e.target.value); setPage(1) }} placeholder="All Phases">
          <option value="T1">T1</option><option value="T2">T2</option><option value="T3">T3</option><option value="T4">T4</option>
        </Select>
      </FilterBar>

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="p-4"><TableSkeleton rows={6} cols={6} /></div>
        ) : list.data && list.data.data.length === 0 ? (
          <EmptyState title="No results" className="border-0" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th sortKey="studentName" {...th}>Student</Th>
                  <Th sortKey="enrollmentNo" {...th}>Enrollment</Th>
                  <Th sortKey="subjectCode" {...th}>Subject</Th>
                  <Th sortKey="batchCode" {...th}>Batch</Th>
                  <Th sortKey="phase" {...th}>Phase</Th>
                  <Th sortKey="marksObtained" {...th}>Marks</Th>
                  <Th sortKey="grade" {...th}>Grade</Th>
                  <Th sortKey="isPublished" {...th}>Status</Th>
                </tr>
              </thead>
              <tbody>
                {sort.rows.map((r, i) => (
                  <Tr key={i}>
                    <Td className="font-medium">{r.studentName}</Td>
                    <Td className="font-mono text-xs text-text-secondary">{r.enrollmentNo}</Td>
                    <Td><Badge tone="neutral">{r.subjectCode}</Badge></Td>
                    <Td>{r.batchCode}</Td>
                    <Td><Badge tone="primary">{r.phase}</Badge></Td>
                    <Td className="tabular-nums">{r.marksObtained}<span className="text-text-muted">/{r.maxMarks}</span></Td>
                    <Td><Badge tone={r.grade === 'F' ? 'danger' : 'success'}>{r.grade ?? '—'}</Badge></Td>
                    <Td><Badge tone={r.isPublished ? 'success' : 'neutral'}>{r.isPublished ? 'Published' : 'Draft'}</Badge></Td>
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
    </PageShell>
  )
}
