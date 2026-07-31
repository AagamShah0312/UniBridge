import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { hodApi } from '@/api/hod'
import { useHistoryStore } from '@/stores/historyStore'
import { Select } from '@/components/ui/Select'

// ponytail: HOD-only. Lists the semesters THIS HOD has managed (from their owned batches).
// "Current" = live semester; picking a past one re-scopes the panel to read-only history.
export function SemesterHistorySelector() {
  const q = useQuery({ queryKey: ['hod', 'history-semesters'], queryFn: hodApi.historySemesters })
  const { semesterId, setSemester } = useHistoryStore()

  const sems = q.data?.data ?? []
  // hide the selector entirely if the HOD only has one (their current) semester of data
  if (sems.length <= 1) return null

  const currentId = q.data?.currentSemesterId ?? null
  const value = semesterId ?? '__current__'

  return (
    <div className="border-b border-border px-3 py-2">
      <label className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        <History size={11} /> Semester View
      </label>
      <Select
        value={value}
        onChange={(e) => {
          if (e.target.value === '__current__') return setSemester(null, null)
          const s = sems.find((x) => x.semesterId === e.target.value)
          setSemester(e.target.value, s ? `${s.label} · ${s.academicYear}` : null)
        }}
      >
        <option value="__current__">Current Semester</option>
        {sems.map((s) => (
          <option key={s.semesterId} value={s.semesterId} disabled={s.semesterId === currentId}>
            {s.label} ({s.yearLevel}) · {s.academicYear}{s.semesterId === currentId ? ' — current' : ` · ${s.studentCount} students`}
          </option>
        ))}
      </Select>
      {semesterId && (
        <div className="mt-1.5 rounded-sm bg-warning-light/40 px-2 py-1 text-[11px] font-medium text-warning">
          Viewing history — read-only
        </div>
      )}
    </div>
  )
}
