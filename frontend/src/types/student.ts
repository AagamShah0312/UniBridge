import type { PaginatedResponse } from './common'

export interface StudentEnrollment {
  batchCode?: string
  semesterLabel?: string
  semesterId?: string
  yearLevel?: string
  rollNo?: string
  academicYear?: string
}

export interface StudentDashboard {
  student?: { id: string; name: string; enrollmentNo: string; branch: string }
  enrollment?: StudentEnrollment
  stats?: {
    avgAttendance?: number
    latestPhaseMarks?: number
    quizzesTaken?: number
    upcomingCount?: number
  }
  [k: string]: unknown
}

export interface AttendancePerSubject {
  subjectId?: string
  subjectCode: string
  subjectName?: string
  totalLectures: number
  attended: number
  percentage: number
  isBelowThreshold?: boolean
}

export interface StudentResult {
  phase: string
  subjectCode: string
  subjectName?: string
  marksObtained: number
  maxMarks: number
  grade?: string | null
  pct?: number
  isPublished: boolean
}

export interface StudentNote {
  id: string
  title: string
  description?: string
  subject: { code: string; name: string }
  facultyName?: string
  fileType?: string
  fileSize?: number
  fileUrl?: string
  hasAiSummary?: boolean
  hasFlashcards?: boolean
  releaseAt?: string
  createdAt: string
  folderId?: string | null
}

export interface StudentNoteDriveFile { id: string; title: string; description?: string | null; originalFileName?: string | null; mimeType: string; fileSizeKb?: number | null; folderId?: string | null; hasFlashcards: boolean; hasAiSummary: boolean; uploadedBy: string; releaseAt?: string; createdAt: string }
export interface StudentNoteDrive { subject: { id: string; code: string; name: string } | null; breadcrumbs: { id: string | null; name: string }[]; folders: { id: string; name: string; parentId?: string | null; isSystem: boolean; createdAt: string }[]; files: StudentNoteDriveFile[] }

export interface SelfNote {
  id: string
  title: string
  content: string
  subjectCode?: string
  color?: string
  updatedAt: string
  createdAt: string
}

export interface StudentQuiz {
  id: string
  title: string
  description?: string
  subject: { code: string; name: string }
  timeLimitMins?: number | null
  dueDate?: string | null
  questionCount?: number
  isAttempted?: boolean
  score?: number | null
  isAiGenerated?: boolean
  isStudentGenerated?: boolean
  chapters?: string[]
  maxAttempts?: number
  attemptsTaken?: number
  status?: 'PENDING' | 'RETRY' | 'ATTEMPTED' | 'EXPIRED'
}

export interface StudentAnnouncement {
  id: string
  title: string
  body: string
  senderName: string
  senderRole: 'HOD' | 'FACULTY'
  scope: string
  scopeLabel?: string
  isRead: boolean
  createdAt: string
}

export interface StudentChatMsg {
  id: string
  senderRole: 'FACULTY' | 'STUDENT'
  senderName: string
  content: string
  isRead: boolean
  sentAt: string
}

export interface AIConversation {
  id: string
  title: string
  subjectName?: string | null
  subjectCode?: string | null
  lastMessage?: string | null
  createdAt: string
  updatedAt?: string
  messageCount?: number
}

export interface AIMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt: string
}

export interface LeaderboardEntry {
  rank: number
  enrollmentNo: string
  name: string
  batchCode: string
  avgPct: number
  isMe?: boolean
}

export type PaginatedNotes = PaginatedResponse<StudentNote>
export type PaginatedQuizzes = PaginatedResponse<StudentQuiz>
export type PaginatedAnnouncements = PaginatedResponse<StudentAnnouncement>
