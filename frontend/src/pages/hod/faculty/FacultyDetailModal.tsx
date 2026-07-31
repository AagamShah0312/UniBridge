import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { hodApi } from '@/api/hod'
import { errorMessage } from '@/api/client'
import { useHodScope } from '@/hooks/hod/useHodScope'
import type { FacultyRow } from '@/types/hod'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'

export function FacultyDetailModal({ faculty, onClose }: { faculty: FacultyRow; onClose: () => void }) {
  const qc = useQueryClient()
  const scope = useHodScope()
  const [mentorCode, setMentorCode] = useState(faculty.mentorCode ?? '')
  const [assignSubject, setAssignSubject] = useState('')
  const [assignBatch, setAssignBatch] = useState('')

  const detail = useQuery({
    queryKey: ['hod', 'faculty', faculty.employeeId, 'detail'],
    queryFn: () => hodApi.faculty.get(faculty.employeeId),
  })
  const subjects = useQuery({
    queryKey: ['hod', 'subjects', scope.data?.activeSemester.id],
    queryFn: () => hodApi.subjects.list({ semesterId: scope.data?.activeSemester.id }),
    enabled: !!scope.data?.activeSemester.id,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['hod', 'faculty'] })
    detail.refetch()
  }

  const saveMentor = useMutation({
    mutationFn: () => hodApi.faculty.setMentorCode(faculty.employeeId, mentorCode),
    onSuccess: () => { toast.success('Mentor code updated'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const toggleStatus = useMutation({
    mutationFn: () => hodApi.faculty.setStatus(faculty.employeeId, faculty.status !== 'ACTIVE'),
    onSuccess: () => { toast.success('Status updated'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const assign = useMutation({
    mutationFn: () => hodApi.faculty.assign({
      facultyId: faculty.id,
      subjectId: assignSubject,
      batchId: assignBatch,
      semesterId: scope.data?.activeSemester.id,
    }),
    onSuccess: () => { toast.success('Subject assigned'); setAssignSubject(''); setAssignBatch(''); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const d = detail.data

  return (
    <Modal open onClose={onClose} title="Faculty Profile" size="lg">
      {detail.isLoading || !d ? (
        <div className="flex justify-center py-10"><Spinner size={26} /></div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar name={d.name} size={56} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-text-primary">{d.name}</h3>
                {d.isHod && <Badge tone="purple">HOD</Badge>}
                <Badge tone={d.status === 'ACTIVE' ? 'success' : 'neutral'}>{d.status}</Badge>
              </div>
              <p className="font-mono text-xs text-text-secondary">{d.employeeId} · {d.email}</p>
            </div>
            {!d.isHod && (
              <Button variant="outline" size="sm" onClick={() => toggleStatus.mutate()} loading={toggleStatus.isPending}>
                {d.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">Mentor Code</label>
            <div className="flex gap-2">
              <Input value={mentorCode} onChange={(e) => setMentorCode(e.target.value.toUpperCase())} placeholder="e.g. SYD" className="max-w-40" />
              <Button variant="outline" onClick={() => saveMentor.mutate()} loading={saveMentor.isPending} disabled={mentorCode === (d.mentorCode ?? '')}>
                Save
              </Button>
            </div>
            {d.isHod && <p className="mt-1 text-xs text-text-muted">HODs take lectures, so they get a code too — they are never assigned mentees.</p>}
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-text-primary">Assigned Subjects</div>
            {d.subjects.length === 0 ? (
              <p className="text-xs text-text-muted">No subjects assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {d.subjects.map((s) => (
                  <div key={s.code} className="flex items-center justify-between rounded-sm border border-border px-3 py-2">
                    <div>
                      <span className="text-sm font-semibold text-text-primary">{s.code}</span>
                      <span className="ml-2 text-xs text-text-muted">{s.name}</span>
                    </div>
                    <div className="flex gap-1">
                      {s.batches.map((b) => <Badge key={b} tone="neutral">{b}</Badge>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!d.isHod && (
            <div className="rounded-sm border border-dashed border-border p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Assign a subject</div>
              <div className="flex flex-wrap items-end gap-2">
                <Select
                  className="w-52"
                  value={assignSubject}
                  onChange={(e) => setAssignSubject(e.target.value)}
                  placeholder="Subject"
                  options={subjects.data?.data.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })) ?? []}
                />
                <Select
                  className="w-32"
                  value={assignBatch}
                  onChange={(e) => setAssignBatch(e.target.value)}
                  placeholder="Batch"
                  options={scope.data?.batches.map((b) => ({ value: b.id, label: b.code })) ?? []}
                />
                <Button leftIcon={<Plus size={15} />} onClick={() => assign.mutate()} loading={assign.isPending} disabled={!assignSubject || !assignBatch}>
                  Assign
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
