import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CalendarDays, Download, FileBarChart, ShieldAlert, Repeat } from 'lucide-react'
import { facultyApi } from '@/api/faculty'
import { errorMessage } from '@/api/client'
import { PageShell } from '@/components/shared/PageShell'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

const today = () => new Date().toISOString().slice(0, 10)

export default function AttendanceCoordinatorPage() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['faculty', 'attendance-coordinator', 'status'], queryFn: () => facultyApi.attendanceCoordinatorStatus() })
  const [dailyDate, setDailyDate] = useState(today())
  const [weeklyUpto, setWeeklyUpto] = useState(today())
  const [proxyDate, setProxyDate] = useState(today())

  const proxies = useQuery({
    queryKey: ['faculty', 'attendance-proxies', proxyDate],
    queryFn: () => facultyApi.attendanceProxies(proxyDate),
    enabled: Boolean(status.data?.isCoordinator),
  })
  const setProxy = useMutation({
    mutationFn: ({ slotId, proxyFacultyId }: { slotId: string; proxyFacultyId: string }) =>
      proxyFacultyId
        ? facultyApi.assignProxyLecture(slotId, proxyDate, proxyFacultyId)
        : facultyApi.removeProxyLecture(slotId, proxyDate),
    onSuccess: () => { toast.success('Proxy updated'); qc.invalidateQueries({ queryKey: ['faculty', 'attendance-proxies'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const daily = useMutation({
    mutationFn: () => facultyApi.downloadDailyAttendancePdf(dailyDate),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const weekly = useMutation({
    mutationFn: () => facultyApi.downloadWeeklyAttendancePdf(weeklyUpto),
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (status.isLoading) {
    return <PageShell title="Attendance Reports"><div className="py-20 text-center text-text-muted">Loading…</div></PageShell>
  }
  if (!status.data?.isCoordinator) {
    return (
      <PageShell title="Attendance Reports">
        <EmptyState icon={<ShieldAlert size={22} />} title="Not an attendance coordinator"
          description="Only faculty assigned as attendance coordinators by the HOD can generate these reports." />
      </PageShell>
    )
  }

  return (
    <PageShell title="Attendance Reports" subtitle={`Generate department-wide attendance PDFs · ${status.data.semesterLabel}`}>
      <div className="mb-4 rounded-md border border-border bg-surface-2 px-4 py-3 text-xs text-text-muted">
        <span className="font-semibold text-text-secondary">Legend:</span>{' '}
        <span className="font-semibold text-text-primary">BLACK</span> = absent in all lectures ·{' '}
        <span className="font-semibold text-danger">RED</span> = not attended all lectures / below 75%.
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><CalendarDays size={16} /> Daily Attendance</span>}
            subtitle="One PDF with every batch's absentees for a chosen day." />
          <CardBody>
            <label className="mb-1 block text-xs font-medium text-text-muted">Date</label>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={dailyDate} max={today()} onChange={(e) => setDailyDate(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
              <Button leftIcon={<Download size={15} />} loading={daily.isPending} disabled={!dailyDate}
                onClick={() => daily.mutate()}>Download Daily PDF</Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><FileBarChart size={16} /> Weekly Compiled Attendance</span>}
            subtitle="Per-student subject-wise + overall attendance up to a date." />
          <CardBody>
            <label className="mb-1 block text-xs font-medium text-text-muted">Up to date</label>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={weeklyUpto} max={today()} onChange={(e) => setWeeklyUpto(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
              <Button leftIcon={<Download size={15} />} loading={weekly.isPending} disabled={!weeklyUpto}
                onClick={() => weekly.mutate()}>Download Weekly PDF</Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={<span className="flex items-center gap-2"><Repeat size={16} /> Proxy Lectures</span>}
          subtitle="Reassign a lecture for a day. The original faculty stops seeing it in Attendance; the proxy starts seeing it." />
        <CardBody>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Date</label>
              <input type="date" value={proxyDate} onChange={(e) => setProxyDate(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            </div>
          </div>
          {proxies.isLoading ? (
            <p className="text-sm text-text-muted">Loading lectures…</p>
          ) : (proxies.data?.lectures.length ?? 0) === 0 ? (
            <p className="text-sm text-text-muted">No lectures scheduled on this day.</p>
          ) : (
            <div className="scrollbar-thin overflow-x-auto rounded-sm border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left text-[11px] uppercase text-text-muted">
                    <th className="px-3 py-2 font-semibold">Batch</th>
                    <th className="px-3 py-2 font-semibold">Subject</th>
                    <th className="px-3 py-2 font-semibold">Time</th>
                    <th className="px-3 py-2 font-semibold">Assigned Faculty</th>
                    <th className="px-3 py-2 font-semibold">Proxy (for this day)</th>
                  </tr>
                </thead>
                <tbody>
                  {proxies.data!.lectures.map((lec) => (
                    <tr key={lec.slotId} className="border-t border-border-light">
                      <td className="px-3 py-2 font-medium">{lec.batchCode}</td>
                      <td className="px-3 py-2">{lec.subjectCode}</td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">{lec.slotStart}–{lec.slotEnd}</td>
                      <td className="px-3 py-2">
                        {lec.originalFaculty}
                        {lec.proxyFacultyId && <Badge tone="warning" className="ml-2">Proxied</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        <Select className="min-w-[200px]" value={lec.proxyFacultyId ?? ''}
                          onChange={(e) => setProxy.mutate({ slotId: lec.slotId, proxyFacultyId: e.target.value })}
                          options={[{ value: '', label: '— No proxy (original) —' }, ...(proxies.data!.facultyOptions)
                            .filter((f) => f.id !== lec.originalFacultyId)
                            .map((f) => ({ value: f.id, label: `${f.name} (${f.employeeId})` }))]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </PageShell>
  )
}
