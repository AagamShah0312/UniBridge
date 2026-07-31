import { useMemo, useState } from 'react'
import { useTableSort } from '@/hooks/shared/useTableSort'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Sparkles, Upload, UserCheck, UserPlus, Users, UserX } from 'lucide-react'
import { hodApi } from '@/api/hod'
import { errorMessage } from '@/api/client'
import { useHodScope } from '@/hooks/hod/useHodScope'
import { useHistoryStore } from '@/stores/historyStore'
import { HistoryBanner } from '@/components/hod/HistoryBanner'
import { useDebounce } from '@/hooks/shared/useDebounce'
import { PageShell } from '@/components/shared/PageShell'
import { FilterBar } from '@/components/shared/FilterBar'
import { SearchInput } from '@/components/shared/SearchInput'
import { CsvUploadModal } from '@/components/shared/CsvUploadModal'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { Table, Td, Th, Tr } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { StatCardSkeleton, TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'

export default function MentorshipPage() {
  const qc = useQueryClient()
  const scope = useHodScope()
  const history = useHistoryStore()
  const semesterId = history.semesterId ?? scope.data?.activeSemester.id

  const [tab, setTab] = useState('mentors')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showUpload, setShowUpload] = useState(false)
  const [assignFor, setAssignFor] = useState<string | null>(null)
  const [pickFaculty, setPickFaculty] = useState('')

  const debouncedSearch = useDebounce(search)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['hod', 'mentorship'] })

  const summary = useQuery({ queryKey: ['hod', 'mentorship', 'summary', semesterId], queryFn: () => hodApi.mentorship.summary(semesterId), enabled: !!semesterId })
  const mentors = useQuery({ queryKey: ['hod', 'mentorship', 'mentors', semesterId], queryFn: () => hodApi.mentorship.mentors(semesterId), enabled: !!semesterId && tab === 'mentors' })
  const assignments = useQuery({
    queryKey: ['hod', 'mentorship', 'assignments', semesterId, debouncedSearch, page],
    queryFn: () => hodApi.mentorship.assignments({ semesterId, search: debouncedSearch || undefined, page, limit: 10000 }),
    enabled: !!semesterId && tab === 'assignments',
  })
  const unassigned = useQuery({ queryKey: ['hod', 'mentorship', 'unassigned', semesterId], queryFn: () => hodApi.mentorship.unassigned(semesterId), enabled: !!semesterId && tab === 'unassigned' })
  const facultyList = useQuery({ queryKey: ['hod', 'faculty', 'picker'], queryFn: () => hodApi.faculty.list({ limit: 100 }) })

  const autoAssign = useMutation({
    mutationFn: () => hodApi.mentorship.autoAssign(semesterId!),
    onSuccess: (r: { assignedCount?: number }) => { toast.success(`Auto-assigned ${r.assignedCount ?? 0} students`); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const assign = useMutation({
    mutationFn: (enrollmentNo: string) => hodApi.mentorship.assign(enrollmentNo, pickFaculty, semesterId!),
    onSuccess: () => { toast.success('Mentor assigned'); setAssignFor(null); setPickFaculty(''); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const s = summary.data
  const mentorCodeOptions = useMemo(
    () => facultyList.data?.data.filter((f) => f.mentorCode).map((f) => ({ value: f.id, label: `${f.name} (${f.mentorCode})` })) ?? [],
    [facultyList.data],
  )

  const aSort = useTableSort(assignments.data?.data ?? [], { pageSize: 20 })
  const aSortTh = { activeKey: aSort.sortKey, dir: aSort.sortDir, onSort: aSort.onSort }
  const uSort = useTableSort(unassigned.data?.data ?? [])
  const uSortTh = { activeKey: uSort.sortKey, dir: uSort.sortDir, onSort: uSort.onSort }

  return (
    <PageShell
      title="Mentorship"
      subtitle="Assign and manage student mentors"
      action={
        history.semesterId ? undefined : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" leftIcon={<Upload size={15} />} onClick={() => setShowUpload(true)}>Upload CSV</Button>
          <Button leftIcon={<Sparkles size={15} />} loading={autoAssign.isPending} onClick={() => autoAssign.mutate()}>Auto-Assign</Button>
        </div>
        )
      }
    >
      <HistoryBanner />
      <div className="mb-5 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {summary.isLoading ? <StatCardSkeleton count={4} /> : s ? (
          <>
            <StatCard value={s.activeMentors} label="Active Mentors" icon={<UserCheck size={18} className="text-primary" />} iconBg="var(--primary-light)" />
            <StatCard value={s.studentsAssigned} label="Students Assigned" icon={<Users size={18} className="text-success" />} iconBg="var(--success-light)" />
            <StatCard value={s.unassignedStudents} label="Unassigned" icon={<UserX size={18} className="text-warning" />} iconBg="var(--warning-light)" />
            <StatCard value={s.avgMenteesPerMentor?.toFixed(1)} label="Avg / Mentor" icon={<UserPlus size={18} className="text-purple" />} iconBg="var(--purple-light)" />
          </>
        ) : null}
      </div>

      <Tabs className="mb-4" value={tab} onChange={(k) => { setTab(k); setPage(1) }} tabs={[
        { key: 'mentors', label: 'Mentor Cards' },
        { key: 'assignments', label: 'Assignments' },
        { key: 'unassigned', label: 'Unassigned' },
      ]} />

      {tab === 'mentors' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {mentors.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-52 animate-pulse rounded-card bg-slate-200/60" />)
          ) : mentors.data?.data.map((m) => (
            <Card key={m.facultyId}>
              <CardHeader
                title={<span className="flex items-center gap-2">{m.name} {m.mentorCode && <Badge tone="teal">{m.mentorCode}</Badge>}</span>}
                subtitle={`${m.year} · ${m.menteeCount} mentees`}
              />
              <CardBody className="pt-0">
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {m.mentees.map((me) => (
                    <div key={me.enrollmentNo} className="flex items-center gap-2 text-sm">
                      <Avatar name={me.name} size={24} />
                      <span className="truncate">{me.name}</span>
                      <span className="ml-auto font-mono text-[11px] text-text-muted">{me.enrollmentNo}</span>
                    </div>
                  ))}
                  {m.mentees.length === 0 && <p className="text-xs text-text-muted">No mentees yet.</p>}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {tab === 'assignments' && (
        <>
          <FilterBar>
            <div className="w-64 max-w-full"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search students" /></div>
          </FilterBar>
          <Card className="overflow-hidden">
            {assignments.isLoading ? <div className="p-4"><TableSkeleton rows={8} cols={4} /></div> : (
              <>
                <Table>
                  <thead><tr><Th sortKey="studentName" {...aSortTh}>Student</Th><Th sortKey="enrollmentNo" {...aSortTh}>Enrollment No.</Th><Th sortKey="batchCode" {...aSortTh}>Batch</Th><Th sortKey="mentorName" {...aSortTh}>Mentor</Th></tr></thead>
                  <tbody>
                    {aSort.rows.map((a) => (
                      <Tr key={a.enrollmentNo}>
                        <Td className="font-medium">{a.studentName}</Td>
                        <Td className="font-mono text-xs text-text-secondary">{a.enrollmentNo}</Td>
                        <Td>{a.batchCode}</Td>
                        <Td><span className="flex items-center gap-2">{a.mentorName} {a.mentorCode && <Badge tone="teal">{a.mentorCode}</Badge>}</span></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                {assignments.data && aSort.totalPages > 1 && (
                  <div className="border-t border-border px-3">
                    <Pagination {...aSort.pagination} />
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}

      {tab === 'unassigned' && (
        <Card className="overflow-hidden">
          {unassigned.isLoading ? <div className="p-4"><TableSkeleton rows={5} cols={4} /></div> : unassigned.data && unassigned.data.data.length === 0 ? (
            <EmptyState title="All students have mentors 🎉" className="border-0" />
          ) : (
            <Table>
              <thead><tr><Th sortKey="name" {...uSortTh}>Student</Th><Th sortKey="enrollmentNo" {...uSortTh}>Enrollment No.</Th><Th sortKey="batchCode" {...uSortTh}>Batch</Th><Th sortKey="branch" {...uSortTh}>Branch</Th><Th className="text-right">Assign</Th></tr></thead>
              <tbody>
                {uSort.rows.map((u) => (
                  <Tr key={u.enrollmentNo}>
                    <Td className="font-medium">{u.name}</Td>
                    <Td className="font-mono text-xs text-text-secondary">{u.enrollmentNo}</Td>
                    <Td>{u.batchCode}</Td>
                    <Td>{u.branch}</Td>
                    <Td className="text-right">
                      {!history.semesterId && <Button size="sm" variant="outline" onClick={() => setAssignFor(u.enrollmentNo)}>Assign</Button>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {/* Assign single modal (inline) */}
      {assignFor && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setAssignFor(null)}>
          <Card className="w-full max-w-md p-5" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-[15px] font-semibold">Assign Mentor</h3>
            <Select value={pickFaculty} onChange={(e) => setPickFaculty(e.target.value)} placeholder="Select a mentor" options={mentorCodeOptions} />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAssignFor(null)}>Cancel</Button>
              <Button disabled={!pickFaculty} loading={assign.isPending} onClick={() => assign.mutate(assignFor)}>Assign</Button>
            </div>
          </Card>
        </div>
      )}

      <CsvUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Bulk Mentor Assignment"
        onUpload={hodApi.mentorship.assignCsv}
        buildForm={(form) => semesterId && form.append('semesterId', semesterId)}
        requiredColumns={['enrollment_no', 'mentor_code']}
      />
    </PageShell>
  )
}
