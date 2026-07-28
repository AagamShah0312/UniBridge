import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CalendarDays, Download, FileBarChart, ShieldAlert } from 'lucide-react'
import { facultyApi } from '@/api/faculty'
import { errorMessage } from '@/api/client'
import { PageShell } from '@/components/shared/PageShell'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'

const today = () => new Date().toISOString().slice(0, 10)

export default function AttendanceCoordinatorPage() {
  const status = useQuery({ queryKey: ['faculty', 'attendance-coordinator', 'status'], queryFn: () => facultyApi.attendanceCoordinatorStatus() })
  const [dailyDate, setDailyDate] = useState(today())
  const [weeklyUpto, setWeeklyUpto] = useState(today())

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
    </PageShell>
  )
}
