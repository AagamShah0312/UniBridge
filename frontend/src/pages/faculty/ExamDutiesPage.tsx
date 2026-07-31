import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ClipboardCheck, LifeBuoy } from 'lucide-react'
import { examApi } from '@/api/exam'
import { PageShell } from '@/components/shared/PageShell'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Table, Td, Th, Tr } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'

const fmtDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '')

export default function ExamDutiesPage() {
  const duties = useQuery({ queryKey: ['faculty', 'exam-duties'], queryFn: examApi.myDuties })
  const d = duties.data
  const empty = d && !d.supervision.length && !d.paperChecking.length && !d.standby.length

  return (
    <PageShell title="Exam Duties" subtitle="Your published supervision, paper-checking and standby duties">
      {duties.isLoading ? <p className="py-10 text-center text-text-muted">Loading…</p>
        : empty ? <EmptyState title="No exam duties" description="You have no published exam duties yet. They appear here once the year HOD publishes an allocation." />
        : (
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <CardHeader title={<span className="flex items-center gap-2"><CalendarClock size={16} /> Supervision</span>} />
              {!d!.supervision.length ? <p className="px-4 pb-4 text-sm text-text-muted">None.</p> : (
                <Table>
                  <thead><tr><Th>Exam</Th><Th>Subject</Th><Th>Date</Th><Th>Time</Th><Th>Block</Th><Th>Room</Th></tr></thead>
                  <tbody>
                    {d!.supervision.map((s, i) => (
                      <Tr key={i}>
                        <Td>{s.exam}</Td><Td>{s.subject}</Td>
                        <Td>{fmtDate(s.date)} {s.isToday && <Badge tone="primary">Today</Badge>}</Td>
                        <Td className="tabular-nums">{s.time}</Td><Td className="font-semibold">Block {s.block}</Td><Td>{s.room ?? '—'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <Card className="overflow-hidden">
              <CardHeader title={<span className="flex items-center gap-2"><ClipboardCheck size={16} /> Paper Checking</span>} />
              {!d!.paperChecking.length ? <p className="px-4 pb-4 text-sm text-text-muted">None.</p> : (
                <Table>
                  <thead><tr><Th>Exam</Th><Th>Subject</Th><Th>Block range</Th><Th>Blocks</Th></tr></thead>
                  <tbody>
                    {d!.paperChecking.map((p, i) => (
                      <Tr key={i}><Td>{p.exam}</Td><Td>{p.subject}</Td><Td>{p.range}</Td><Td className="tabular-nums">{p.blocks}</Td></Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <Card className="overflow-hidden">
              <CardHeader title={<span className="flex items-center gap-2"><LifeBuoy size={16} /> Standby</span>} />
              {!d!.standby.length ? <p className="px-4 pb-4 text-sm text-text-muted">None.</p> : (
                <Table>
                  <thead><tr><Th>Exam</Th><Th>Subject</Th><Th>Date</Th><Th>Time</Th><Th>Slot</Th></tr></thead>
                  <tbody>
                    {d!.standby.map((s, i) => (
                      <Tr key={i}><Td>{s.exam}</Td><Td>{s.subject}</Td><Td>{fmtDate(s.date)} {s.isToday && <Badge tone="primary">Today</Badge>}</Td><Td className="tabular-nums">{s.time}</Td><Td>Standby {s.slot}</Td></Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        )}
    </PageShell>
  )
}
