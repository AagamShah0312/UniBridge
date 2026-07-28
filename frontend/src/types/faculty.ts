import type { PaginatedResponse } from './common'

export interface FacultyScope {
  activeSemester: { id: string; label: string; number: number; yearLevel: string }
  assignments: {
    id: string
    subject: { id: string; code: string; name: string; type: string }
    batch: { id: string; code: string; yearLevel: string }
    studentCount?: number
  }[]
  uniqueBatches?: { id: string; code: string }[]
  uniqueSubjects?: { id: string; code: string; name: string }[]
  mentorCode?: string | null
}

export interface FacultyDashboardStats {
  faculty: { id: string; name: string; mentorCode?: string | null; year: string }
  activeSemester: { id: string; label: string; number: number }
  stats: {
    totalStudents: number
    assignedBatches: number
    assignedSubjects: number
    totalMentees: number
    avgAttendance: { value: number; trend: string; deltaLabel: string }
    pendingAttendance?: number
  }
}

export interface TimetableSlot {
  id: string
  dayOfWeek?: number
  dayLabel?: string
  slotStart: string
  slotEnd: string
  subject?: { code: string; name?: string }
  batch?: { code: string }
  room?: string
  facultyName?: string
  attendanceMarked?: boolean
}

export interface DayStatus {
  date?: string
  dayLabel?: string
  isWorkingDay: boolean
  status: string
  reason: string | null
}
export interface TodayTimetable {
  date: string
  dayLabel: string
  dayStatus?: DayStatus
  slots: TimetableSlot[]
}

export interface FacultyStudentRow {
  enrollmentNo: string
  name: string
  branch: string
  currentBatch?: { code: string } | null
  rollNo?: string
  attendancePct?: number
  status: 'ACTIVE' | 'AT_RISK' | 'INACTIVE'
}

export interface AttendanceSessionRow {
  enrollmentId: string
  enrollmentNo: string
  name: string
  rollNo?: string
  isPresent?: boolean | null
  wasMarked?: boolean
}

export interface FacultyNote {
  id: string
  title: string
  description?: string
  subject: { code: string; name: string }
  fileUrl?: string
  fileSize?: number
  fileType?: string
  aiSummaryStatus?: 'pending' | 'complete' | 'failed' | null
  batchCodes?: string[]
  status?: 'PUBLISHED' | 'SCHEDULED'
  releaseAt?: string
  createdAt: string
  folderId?: string | null
}

export interface NoteDriveFolder { id: string; name: string; parentId?: string | null; isSystem: boolean; createdAt: string }
export interface FacultyNoteDriveFile { id: string; title: string; description?: string | null; originalFileName?: string | null; mimeType: string; fileSizeKb?: number | null; folderId?: string | null; status: string; releaseAt?: string; hasFlashcards: boolean; hasAiSummary: boolean; createdAt: string }
export interface FacultyNoteDrive { subject: { id: string; code: string; name: string } | null; breadcrumbs: { id: string | null; name: string }[]; folders: NoteDriveFolder[]; files: FacultyNoteDriveFile[] }

export interface FacultyQuiz {
  id: string
  title: string
  description?: string
  subject: { code: string; name: string }
  isPublished: boolean
  dueDate?: string | null
  timeLimitMins?: number | null
  questionCount?: number
  attemptCount?: number
  batchCodes?: string[]
  createdAt: string
}

export interface FacultyAnnouncement {
  id: string
  title: string
  body: string
  scope: 'ALL' | 'BATCH' | 'YEAR_LEVEL'
  scopeLabel?: string
  createdAt: string
}

export interface MenteeRow {
  mentorAssignmentId: string
  enrollmentNo: string
  name: string
  branch: string
  batchCode: string
  rollNo?: string
  attendancePct?: number
  latestMarksPct?: number
  status: string
  unreadMessages?: number
  lastMessageAt?: string | null
}

export interface MenteeListResponse extends PaginatedResponse<MenteeRow> {
  mentorCode: string
  semesterLabel: string
}

export interface FacultyResultRow {
  enrollmentNo: string
  studentName: string
  batchCode: string
  subjectCode: string
  phase: string
  marksObtained: number
  maxMarks: number
  grade?: string | null
  isPublished: boolean
}

export interface FacultyResultsResponse extends PaginatedResponse<FacultyResultRow> {
  stats?: { avgMarksPct: number; passCount: number; failCount: number }
}

export interface ChatMsg {
  id: string
  senderRole: 'FACULTY' | 'STUDENT'
  senderName: string
  content: string
  isRead: boolean
  sentAt: string
}

// ── Timetable-driven today's lectures ──
export interface TodayLectureStudent { enrollmentId: string; rollNo: string; name: string; enrollmentNo: string }
export interface TodayLecture {
  slotId: string; batchId: string; batchCode: string
  subjectId: string; subjectCode: string; subjectName: string
  slotStart: string; slotEnd: string; room: string | null; isProxy: boolean
  students: TodayLectureStudent[]
  marks: Record<string, boolean>
}
export interface TodayLectures {
  date: string; dayOfWeek: number; isEditable: boolean
  dayStatus: { isWorkingDay: boolean; status: string; reason?: string | null }
  lectures: TodayLecture[]
}

// ── Coordinator proxy management ──
export interface ProxyFacultyOption { id: string; name: string; employeeId: string }
export interface ProxyLectureRow {
  slotId: string; batchCode: string; subjectCode: string; slotStart: string; slotEnd: string
  originalFacultyId: string | null; originalFaculty: string
  proxyFacultyId: string | null; proxyFaculty: string | null
}
export interface ProxyLectures {
  semesterId: string; date: string
  lectures: ProxyLectureRow[]
  facultyOptions: ProxyFacultyOption[]
}
