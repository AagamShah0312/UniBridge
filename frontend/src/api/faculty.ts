import { downloadExport, downloadFile, type ExportFormat } from '@/lib/download'
import { api } from './client'
import type { PaginatedResponse } from '@/types/common'
import type * as T from '@/types/faculty'

type Params = Record<string, string | number | boolean | undefined>

export const facultyApi = {
  scope: () => api.get<T.FacultyScope>('/faculty/my-scope').then((r) => r.data),

  profile: () => api.get('/faculty/profile').then((r) => r.data),
  updateProfile: (body: Record<string, unknown>) => api.put('/faculty/profile', body).then((r) => r.data),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch('/faculty/profile/password', { currentPassword, newPassword }).then((r) => r.data),
  sessions: () => api.get('/faculty/sessions').then((r) => r.data),
  revokeSession: (id: string) => api.delete(`/faculty/sessions/${id}`).then((r) => r.data),
  activityFeed: (page = 1, limit = 10) =>
    api.get('/faculty/activity-feed', { params: { page, limit } }).then((r) => r.data),

  dashboardSummary: () => api.get<T.FacultyDashboardStats>('/faculty/dashboard/summary').then((r) => r.data),

  timetableToday: () => api.get<T.TodayTimetable>('/faculty/timetable/today').then((r) => r.data),
  timetable: () =>
    api.get<{ slots: T.TimetableSlot[] }>('/faculty/timetable').then((r) => r.data),

  students: (params: Params) =>
    api.get<PaginatedResponse<T.FacultyStudentRow>>('/faculty/students', { params }).then((r) => r.data),
  studentDetail: (enrollmentNo: string) =>
    api.get(`/faculty/students/${enrollmentNo}`).then((r) => r.data),
  studentHistory: (enrollmentNo: string) =>
    api.get<{ enrollmentNo: string; journey: { semesterNumber: number; semesterLabel: string; yearLevel: string; batchCode: string; rollNo: string; academicYear: string; isCurrent: boolean }[] }>(`/faculty/students/${enrollmentNo}/history`).then((r) => r.data),
  studentAttendance: (enrollmentNo: string) =>
    api.get(`/faculty/students/${enrollmentNo}/attendance`).then((r) => r.data),
  studentResults: (enrollmentNo: string) =>
    api.get(`/faculty/students/${enrollmentNo}/results`).then((r) => r.data),

  hodBatches: () => api.get<{ activeSemester: { id: string; label: string }; data: { id: string; code: string; yearLevel: string }[] }>('/faculty/hod-batches').then((r) => r.data),
  attendanceDay: (batchId: string, date: string) =>
    api.get<{
      date: string; dayOfWeek: number; isEditable: boolean; daysDelta: number;
      dayStatus?: { isWorkingDay: boolean; status: string; reason: string | null };
      lectures: { slotId: string; subjectId: string; subjectCode: string; subjectName: string; slotStart: string; slotEnd: string; room?: string | null }[];
      students: { enrollmentId: string; rollNo: string; name: string; enrollmentNo: string }[];
      marks: Record<string, boolean>;
      subjects: { id: string; code: string; name: string }[];
    }>('/faculty/attendance/day', { params: { batchId, date } }).then((r) => r.data),
  attendanceDaySave: (body: { batchId: string; date: string; lectures: { slotId?: string; subjectId: string; marks: Record<string, boolean> }[] }) =>
    api.post('/faculty/attendance/day', body).then((r) => r.data),

  attendancePending: () => api.get('/faculty/attendance/pending').then((r) => r.data),

  // Attendance-coordinator role: gate the page, then stream the report PDFs.
  attendanceCoordinatorStatus: () =>
    api.get<{ isCoordinator: boolean; semesterId: string; semesterLabel: string }>('/faculty/attendance/coordinator/status').then((r) => r.data),
  downloadDailyAttendancePdf: (date: string) =>
    downloadFile('/faculty/attendance/coordinator/daily-pdf', `daily-attendance-${date}.pdf`, { date }),
  downloadWeeklyAttendancePdf: (upto: string) =>
    downloadFile('/faculty/attendance/coordinator/weekly-pdf', `weekly-attendance-${upto}.pdf`, { upto }),
  attendanceSummary: () => api.get<{
    semesterLabel: string
    bySubjectAndBatch: { subjectCode: string; batchCode: string; totalStudents: number; avgAttendancePct: number; belowThresholdCount: number; totalLecturesMarked: number }[]
    daily: { date: string; pct: number; lectures: number }[]
    weekly: { weekStart: string; pct: number; lectures: number }[]
    overall: { totalLectures: number; avgAttendancePct: number }
  }>('/faculty/attendance/summary').then((r) => r.data),
  attendanceSession: (params: Params) =>
    api.get<{ students: T.AttendanceSessionRow[]; alreadyMarked?: boolean }>('/faculty/attendance/session', { params }).then((r) => r.data),
  postAttendance: (body: Record<string, unknown>) =>
    api.post('/faculty/attendance', body).then((r) => r.data),
  patchAttendance: (body: Record<string, unknown>) =>
    api.patch('/faculty/attendance', body).then((r) => r.data),
  lectureLog: (params: Params) => api.get('/faculty/attendance/lecture-log', { params }).then((r) => r.data),
  belowThreshold: (params: Params) => api.get('/faculty/attendance/students-below-threshold', { params }).then((r) => r.data),

  studentsExport: (params: Params, format: ExportFormat = 'csv') =>
    downloadExport('/faculty/students/export', 'my-students', format, params),
  resultsExport: (params: Params, format: ExportFormat = 'csv') =>
    downloadExport('/faculty/results/export', 'results', format, params),

  notes: (params: Params) =>
    api.get<PaginatedResponse<T.FacultyNote>>('/faculty/notes', { params }).then((r) => r.data),
  noteDrive: (params: Params) => api.get<T.FacultyNoteDrive>('/faculty/notes/folders', { params }).then((r) => r.data),
  createNoteFolder: (body: { subjectId: string; parentId?: string | null; name: string }) => api.post('/faculty/notes/folders', body).then((r) => r.data),
  renameNoteFolder: (id: string, name: string) => api.patch(`/faculty/notes/folders/${id}`, { name }).then((r) => r.data),
  deleteNoteFolder: (id: string) => api.delete(`/faculty/notes/folders/${id}`).then((r) => r.data),
  // Multipart: file + fields (title, subjectId, batchIds, releaseAt). Backend uploads to Supabase S3.
  createNote: (form: FormData) => api.post('/faculty/notes', form).then((r) => r.data),
  updateNote: (id: string, form: FormData) => api.put(`/faculty/notes/${id}`, form).then((r) => r.data),
  deleteNote: (id: string) => api.delete(`/faculty/notes/${id}`).then((r) => r.data),
  // Multipart: file + fields (subjectId, year). Backend stores it and triggers AI PYQ analysis.
  uploadPyq: (form: FormData) => api.post('/faculty/pyq', form).then((r) => r.data),

  quizzes: (params: Params) =>
    api.get<PaginatedResponse<T.FacultyQuiz>>('/faculty/quizzes', { params }).then((r) => r.data),
  createQuiz: (body: Record<string, unknown>) => api.post('/faculty/quizzes', body).then((r) => r.data),
  updateQuiz: (id: string, body: Record<string, unknown>) => api.put(`/faculty/quizzes/${id}`, body).then((r) => r.data),
  deleteQuiz: (id: string) => api.delete(`/faculty/quizzes/${id}`).then((r) => r.data),
  publishQuiz: (id: string) => api.patch(`/faculty/quizzes/${id}/publish`).then((r) => r.data),
  unpublishQuiz: (id: string) => api.patch(`/faculty/quizzes/${id}/unpublish`).then((r) => r.data),
  // Quiz questions — a quiz with 0 questions can never be published, so this is required to ship a quiz.
  getQuiz: (id: string) => api.get(`/faculty/quizzes/${id}`).then((r) => r.data),
  replaceQuizQuestions: (id: string, questions: { text: string; options: string[]; correctOption: string; explanation?: string; order: number }[]) =>
    api.put(`/faculty/quizzes/${id}/questions`, { questions }).then((r) => r.data),

  announcements: (params: Params) =>
    api.get<PaginatedResponse<T.FacultyAnnouncement>>('/faculty/announcements', { params }).then((r) => r.data),
  createAnnouncement: (body: Record<string, unknown>) =>
    api.post('/faculty/announcements', body).then((r) => r.data),
  updateAnnouncement: (id: string, body: Record<string, unknown>) =>
    api.put(`/faculty/announcements/${id}`, body).then((r) => r.data),
  deleteAnnouncement: (id: string) =>
    api.delete(`/faculty/announcements/${id}`).then((r) => r.data),

  mentees: (params: Params) =>
    api.get<T.MenteeListResponse>('/faculty/mentees', { params }).then((r) => r.data),
  menteeProfile: (enrollmentNo: string) =>
    api.get(`/faculty/mentees/${enrollmentNo}/profile`).then((r) => r.data),
  atRiskMentees: () => api.get('/faculty/mentees/at-risk').then((r) => r.data),

  chatMessages: (mentorAssignmentId: string, params?: Params) =>
    api.get<{ data: T.ChatMsg[]; hasMore?: boolean }>(`/faculty/chat/${mentorAssignmentId}/messages`, { params }).then((r) => r.data),
  sendChat: (mentorAssignmentId: string, content: string) =>
    api.post(`/faculty/chat/${mentorAssignmentId}/messages`, { content }).then((r) => r.data),
  markChatRead: (mentorAssignmentId: string) =>
    api.patch(`/faculty/chat/${mentorAssignmentId}/mark-read`).then((r) => r.data),

  results: (params: Params) =>
    api.get<T.FacultyResultsResponse>('/faculty/results', { params }).then((r) => r.data),
  resultsSummary: () => api.get('/faculty/results/summary').then((r) => r.data),
  leaderboard: (params: Params) => api.get('/faculty/results/leaderboard', { params }).then((r) => r.data),

  calendarEvents: (params: Params) =>
    api.get<{ data: { id: string; date: string; title: string; type: string }[] }>('/faculty/calendar/events', { params }).then((r) => r.data),
  upcomingEvents: (limit = 6) =>
    api.get('/faculty/calendar/events/upcoming', { params: { limit } }).then((r) => r.data),
  phaseTimeline: () => api.get('/faculty/calendar/phase-timeline').then((r) => r.data),

  analyticsAttendance: (params: Params) =>
    api.get('/faculty/analytics/attendance', { params }).then((r) => r.data),
  analyticsMarks: (params: Params) =>
    api.get('/faculty/analytics/marks', { params }).then((r) => r.data),
  analyticsMentees: () => api.get('/faculty/analytics/mentees').then((r) => r.data),
  quizPerformance: (params: Params) => api.get('/faculty/analytics/quiz-performance', { params }).then((r) => r.data),
}
