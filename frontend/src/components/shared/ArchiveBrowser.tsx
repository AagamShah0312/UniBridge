import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ChevronDown, ChevronRight, GraduationCap, Users } from 'lucide-react'
import type { ArchiveSnapshot, ArchiveTree } from '@/types/archive'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { CardSkeleton } from '@/components/ui/Skeleton'

/**
 * Permanent academic archive browser: academic year → semester → batch → student snapshot.
 * Identical UI for HOD and University; the server decides the scope (HOD sees only batches they
 * have ever owned, the Dean sees everything), so this component stays scope-agnostic.
 */
export function ArchiveBrowser({
  queryKey,
  fetchTree,
  fetchSnapshot,
}: {
  queryKey: string
  fetchTree: () => Promise<ArchiveTree>
  fetchSnapshot: (semesterId: string, batchId: string) => Promise<ArchiveSnapshot>
}) {
  const tree = useQuery({ queryKey: [queryKey, 'archive'], queryFn: fetchTree })
  const [openYears, setOpenYears] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<{ semesterId: string; batchId: string } | null>(null)

  const snapshot = useQuery({
    queryKey: [queryKey, 'archive', selected?.semesterId, selected?.batchId],
    queryFn: () => fetchSnapshot(selected!.semesterId, selected!.batchId),
    enabled: !!selected,
  })

  if (tree.isLoading) return <CardSkeleton height={220} />

  const years = tree.data?.years ?? []
  if (years.length === 0) {
    return (
      <EmptyState
        icon={<Archive size={22} />}
        title="No archived records yet"
        description="Once batches have enrolled students, every year and semester will be preserved here permanently."
      />
    )
  }

  // Newest year expanded by default so the common case needs no clicks.
  const isOpen = (id: string) => openYears[id] ?? id === years[0].academicYearId

  return (
    <div className="space-y-3">
      {years.map((y) => (
        <Card key={y.academicYearId} className="overflow-hidden">
          <button
            onClick={() => setOpenYears((p) => ({ ...p, [y.academicYearId]: !isOpen(y.academicYearId) }))}
            className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-surface-2"
          >
            {isOpen(y.academicYearId) ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
            <GraduationCap size={18} className="text-primary" />
            <div className="flex-1">
              <div className="font-serif text-[17px] font-semibold text-text-primary">{y.academicYear}</div>
              <div className="text-xs text-text-muted">{y.semesters.length} semester{y.semesters.length === 1 ? '' : 's'} preserved</div>
            </div>
            <Badge tone="neutral">{y.totalStudents} students</Badge>
          </button>

          {isOpen(y.academicYearId) && (
            <div className="border-t border-border-light">
              {y.semesters.map((s) => (
                <div key={s.semesterId} className="border-b border-border-light px-5 py-3 last:border-0">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-text-primary">{s.label}</span>
                    {s.isActive && <Badge tone="success" dot>Active</Badge>}
                    <span className="text-xs text-text-muted">· {s.totalStudents} students</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.batches.map((b) => (
                      <button
                        key={b.batchId}
                        onClick={() => setSelected({ semesterId: s.semesterId, batchId: b.batchId })}
                        className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary transition hover:border-primary hover:bg-primary-light hover:text-primary"
                      >
                        <Users size={13} /> {b.batchCode}
                        <span className="font-normal text-text-muted">{b.students}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        size="xl"
        title={snapshot.data ? `${snapshot.data.batch.code} · ${snapshot.data.semester.label}` : 'Loading…'}
        subtitle={snapshot.data ? `${snapshot.data.semester.academicYear} · ${snapshot.data.studentCount} students · preserved record` : undefined}
      >
        {snapshot.isLoading ? (
          <CardSkeleton height={200} />
        ) : snapshot.data ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-text-muted">
                  <th className="py-2 pr-3 font-semibold">Enrollment</th>
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Roll</th>
                  <th className="py-2 pr-3 text-right font-semibold">Attendance</th>
                  <th className="py-2 pr-3 text-right font-semibold">Marks</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.data.students.map((st) => (
                  <tr key={st.enrollmentNo} className="border-b border-border-light last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-text-secondary">{st.enrollmentNo}</td>
                    <td className="py-2 pr-3 font-medium text-text-primary">{st.name}</td>
                    <td className="py-2 pr-3 text-text-secondary">{st.rollNo ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-text-secondary">
                      {st.attendancePct == null ? '—' : `${st.attendancePct}%`}
                      <span className="ml-1 text-[11px] text-text-muted">({st.lecturesAttended}/{st.lecturesHeld})</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-text-secondary">{st.results.length} entries</td>
                    <td className="py-2">
                      <Badge tone={st.graduationStatus === 'PASS_OUT' ? 'success' : st.graduationStatus === 'DETAINED' ? 'danger' : 'neutral'}>
                        {st.graduationStatus}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
