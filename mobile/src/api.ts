import { Platform } from 'react-native'

/**
 * Where the UniBridge backend lives, per platform:
 *  - iOS simulator shares the Mac's network, so localhost works.
 *  - Android emulator reaches the host through the 10.0.2.2 alias.
 *  - A physical device needs the Mac's LAN IP — set EXPO_PUBLIC_API_URL to override.
 */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  Platform.select({
    android: 'http://10.0.2.2:4000/api/v1',
    default: 'http://localhost:4000/api/v1',
  })!

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
  isHod: boolean
  universityId: string
  employeeId?: string | null
  year?: string | null
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: AuthUser
}

/** Backend errors come back as { error: { code, message } }. */
async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`)
  return body as T
}

/** HOD sign-in. The backend maps role -> account lookup, so 'HOD' is required here. */
export async function loginHod(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password, role: 'HOD' }),
  })
  const data = await parse<LoginResponse>(res)
  if (!data.user?.isHod) throw new Error('This account is not a HOD account.')
  return data
}

/** Authenticated GET against the HOD API. */
export function apiGet<T>(token: string, path: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(parse<T>)
}

// ── Response shapes (only the fields the mobile UI renders) ──

export interface Scope {
  hod: { name: string; year: string | null; employeeId: string | null; sectionTag: string | null }
  activeSemester: { id: string; label: string; number: number }
  batches: { id: string; code: string; yearLevel: string; studentCount: number }[]
  totalStudents: number
  totalFaculty: number
}

export type Metric = { value: number; deltaLabel: string; trend: string }
export interface DashboardSummary {
  totalStudents: Metric
  totalFaculty: Metric
  activeBatches: Metric
  avgAttendance: Metric
  resultsUploadedPct: Metric
}

export interface Paged<T> {
  data: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface StudentRow {
  enrollmentNo: string
  name: string
  branch: string
  batchCode: string
  rollNo: string
  attendancePct: number | null
  avgMarksPct: number | null
  status: string
}

export interface FacultyRow {
  id: string
  employeeId: string
  name: string
  email: string
  mentorCode: string | null
  isActive: boolean
  assignedBatches: number
  assignedSubjects: number
  menteeCount: number
}

export interface SubjectRow {
  id: string
  code: string
  name: string
  credits: number
  type: string
  assignedFaculty: { id: string; name: string } | null
}

export interface TimetableSlot {
  id: string
  dayOfWeek: number
  slotStart: string
  slotEnd: string
  room: string | null
  batchCode: string
  subjectCode: string
  subjectName: string
  facultyName?: string | null
}

export interface AttendanceSummary {
  overallAvgPct: number
  deltaLabel: string
  belowThresholdCount: number
  totalLectures: number
  lockedRecordsPct: number
}

export interface ResultsOverview {
  phases: { phase: string; avgMarksPct: number | null; status: string }[]
}

export interface AnnouncementRow {
  id: string
  title: string
  body?: string
  content?: string
  createdAt: string
  scope?: string
}

export interface ExamCoordinators {
  coordinators: { slot: number; facultyId: string | null; name: string | null; employeeId: string | null }[]
}

export interface AnalyticsKpi {
  [key: string]: unknown
}

export const hodApi = {
  scope: (t: string) => apiGet<Scope>(t, '/hod/my-scope'),
  summary: (t: string) => apiGet<DashboardSummary>(t, '/hod/dashboard/summary'),
  resultsOverview: (t: string) => apiGet<ResultsOverview>(t, '/hod/dashboard/results-overview'),
  students: (t: string, page = 1) => apiGet<Paged<StudentRow>>(t, `/hod/students?page=${page}&limit=30`),
  faculty: (t: string, page = 1) => apiGet<Paged<FacultyRow>>(t, `/hod/faculty?page=${page}&limit=30`),
  subjects: (t: string) => apiGet<{ data: SubjectRow[] }>(t, '/hod/subjects'),
  timetable: (t: string) => apiGet<{ slots: TimetableSlot[] }>(t, '/hod/timetable'),
  attendanceSummary: (t: string) => apiGet<AttendanceSummary>(t, '/hod/attendance/summary'),
  announcements: (t: string) => apiGet<Paged<AnnouncementRow>>(t, '/hod/announcements'),
  examCoordinators: (t: string) => apiGet<ExamCoordinators>(t, '/hod/exam/coordinators'),
  analyticsKpi: (t: string) => apiGet<AnalyticsKpi>(t, '/hod/analytics/kpi'),
  archive: (t: string) =>
    apiGet<{
      years: {
        academicYearId: string
        academicYear: string
        totalStudents: number
        semesters: { semesterId: string; label: string; isActive: boolean; totalStudents: number; batches: { batchId: string; batchCode: string; students: number }[] }[]
      }[]
    }>(t, '/hod/archive'),
  profile: (t: string) => apiGet<Record<string, unknown>>(t, '/hod/settings/profile'),
}
