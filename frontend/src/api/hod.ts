import { downloadExport, downloadFile, type ExportFormat } from '@/lib/download'
import { api } from './client'
import type { PaginatedResponse } from '@/types/common'
import type * as T from '@/types/hod'
import type { HodTimetableSlot } from '@/types/hod'
import type { ArchiveSnapshot, ArchiveTree } from '@/types/archive'

type Params = Record<string, string | number | boolean | undefined>

export interface FacultyOption { id: string; name: string; employeeId: string }
export interface AttendanceCoordinators {
  semesterId: string
  coordinators: { facultyId: string; name: string | null; employeeId: string | null }[]
  facultyOptions: FacultyOption[]
}

export interface SubjectComponentCfg { key: string; label: string; weightagePct: number; isEnabled: boolean; marks?: number }
export interface SubjectConfig {
  id: string; code: string; name: string; semesterNumber: number; credits: number; type: string; branch: string | null
  totalMarks: number; passingMarks: number; theoryRule: string; isActive: boolean
  components: SubjectComponentCfg[]; totalWeightage: number; catalog: { key: string; label: string }[]
}
export interface SubjectConfigInput {
  totalMarks?: number; passingMarks?: number; theoryRule?: string; isActive?: boolean
  components?: { key: string; label: string; weightagePct: number; isEnabled: boolean }[]
}



export const hodApi = {
  scope: (semesterId?: string) =>
    api.get<T.HodScope>('/hod/my-scope', { params: { semesterId } }).then((r) => r.data),

  onboarding: {
    branches: () =>
      api.get<{ data: { id: string; code: string; name: string }[] }>('/hod/onboarding/branches').then((r) => r.data),
    faculty: () =>
      api.get<{ data: { id: string; name: string; employeeId: string; mentorCode: string | null; year: string | null; inPool: boolean; takenByHod: boolean }[]; year: string | null }>('/hod/onboarding/faculty').then((r) => r.data),
    complete: (body: { initial: string; branches: string[]; batchCount: number }) =>
      api.post<{ batches: { id: string; code: string }[]; branches: string[]; initial: string; semester: string }>('/hod/onboarding/complete', body).then((r) => r.data),
  },

  batchHistory: () =>
    api.get<{ data: { batchId: string; batchCode: string; yearLevel: string; sectionTag: string | null; semesterLabel: string; semesterNumber: number; academicYear: string; isActive: boolean; studentCount: number }[] }>('/hod/batches/history').then((r) => r.data),

  resetSemester: () =>
    api.post<{ batchesRemoved: number; studentsRemoved: number }>('/hod/reset-semester').then((r) => r.data),

  graduateFinalYear: (detainEnrollmentNos?: string[]) =>
    api.post<{ graduated: number; detained: number; semester: string }>('/hod/graduate', { detainEnrollmentNos }).then((r) => r.data),

  // Permanent archive — only batches this HOD has ever owned.
  archive: () => api.get<ArchiveTree>('/hod/archive').then((r) => r.data),
  archiveSnapshot: (semesterId: string, batchId: string) =>
    api.get<ArchiveSnapshot>(`/hod/archive/${semesterId}/${batchId}`).then((r) => r.data),

  historySemesters: () =>
    api.get<{ currentSemesterId: string | null; data: { semesterId: string; number: number; label: string; yearLevel: string; academicYear: string; studentCount: number; isCurrent: boolean }[] }>('/hod/history/semesters').then((r) => r.data),

  facultyPool: {
    get: () => api.get<{ data: { id: string; name: string; employeeId: string; mentorCode: string | null; year: string | null; isActive: boolean }[] }>('/hod/faculty/pool').then((r) => r.data),
    save: (body: { facultyIds: string[]; reclaim?: boolean }) =>
      api.post<{ pooled: number; released: number }>('/hod/faculty/pool', body).then((r) => r.data),
  },

  // ── Dashboard ──
  dashboard: {
    summary: (params?: Params) =>
      api.get<T.DashboardSummary>('/hod/dashboard/summary', { params }).then((r) => r.data),
    attendanceTrend: (months = 6) =>
      api.get<T.AttendanceTrend>('/hod/dashboard/attendance-trend', { params: { months } }).then((r) => r.data),
    resultsOverview: (semesterId?: string) =>
      api.get<T.ResultsOverview>('/hod/dashboard/results-overview', { params: { semesterId } }).then((r) => r.data),
    atRisk: (limit = 5) =>
      api.get<{ data: T.AtRiskRow[]; total: number }>('/hod/dashboard/at-risk', { params: { limit } }).then((r) => r.data),
    activityFeed: (page = 1, limit = 10) =>
      api.get<PaginatedResponse<T.ActivityItem>>('/hod/dashboard/activity-feed', { params: { page, limit } }).then((r) => r.data),
  },

  // ── Students ──
  students: {
    list: (params: Params) =>
      api.get<PaginatedResponse<T.StudentRow>>('/hod/students', { params }).then((r) => r.data),
    get: (enrollmentNo: string) =>
      api.get<T.StudentDetail>(`/hod/students/${enrollmentNo}`).then((r) => r.data),
    history: (enrollmentNo: string) =>
      api.get<T.StudentJourney>(`/hod/students/${enrollmentNo}/history`).then((r) => r.data),
    create: (body: Record<string, unknown>) =>
      api.post('/hod/students', body).then((r) => r.data),
    update: (enrollmentNo: string, body: Record<string, unknown>) =>
      api.put(`/hod/students/${enrollmentNo}`, body).then((r) => r.data),
    setStatus: (enrollmentNo: string, isActive: boolean, reason?: string) =>
      api.patch(`/hod/students/${enrollmentNo}/status`, { isActive, reason }).then((r) => r.data),
    remove: (enrollmentNo: string) =>
      api.delete(`/hod/students/${enrollmentNo}`).then((r) => r.data),
    uploadCsv: (form: FormData) =>
      api.post<T.CsvResult>('/hod/students/csv', form).then((r) => r.data),
    downloadTemplate: () => downloadFile('/hod/students/csv/template', 'students-template.csv'),
    export: (params: Params, format: ExportFormat = 'csv') => downloadExport('/hod/students/export', 'students', format, params),
  },

  // ── Faculty ──
  faculty: {
    list: (params: Params) =>
      api.get<PaginatedResponse<T.FacultyRow>>('/hod/faculty', { params }).then((r) => r.data),
    get: (employeeId: string) =>
      api.get<T.FacultyDetail>(`/hod/faculty/${employeeId}`).then((r) => r.data),
    create: (body: Record<string, unknown>) => api.post('/hod/faculty', body).then((r) => r.data),
    update: (employeeId: string, body: Record<string, unknown>) =>
      api.put(`/hod/faculty/${employeeId}`, body).then((r) => r.data),
    setMentorCode: (employeeId: string, mentorCode: string) =>
      api.patch(`/hod/faculty/${employeeId}/mentor-code`, { mentorCode }).then((r) => r.data),
    setStatus: (employeeId: string, isActive: boolean) =>
      api.patch(`/hod/faculty/${employeeId}/status`, { isActive }).then((r) => r.data),
    remove: (employeeId: string) => api.delete(`/hod/faculty/${employeeId}`).then((r) => r.data),
    uploadCsv: (form: FormData) => api.post<T.CsvResult>('/hod/faculty/csv', form).then((r) => r.data),
    assign: (body: Record<string, unknown>) =>
      api.post('/hod/faculty/assignments', body).then((r) => r.data),
    unassign: (assignmentId: string) =>
      api.delete(`/hod/faculty/assignments/${assignmentId}`).then((r) => r.data),
    export: (params: Params, format: ExportFormat = 'csv') => downloadExport('/hod/faculty/export', 'faculty', format, params),
  },

  // ── Results ──
  results: {
    uploadContext: (semesterId?: string) =>
      api.get('/hod/results/upload-context', { params: { semesterId } }).then((r) => r.data),
    students: (semesterId: string, batchId: string, subjectId: string) =>
      api.get('/hod/results/students', { params: { semesterId, batchId, subjectId } }).then((r) => r.data),
    upload: (form: FormData) => api.post('/hod/results/upload', form).then((r) => r.data),
    manual: (body: Record<string, unknown>) => api.post('/hod/results/manual', body).then((r) => r.data),
    preview: (phaseId: string, subjectId: string, batchId: string) =>
      api.get('/hod/results/preview', { params: { phaseId, subjectId, batchId } }).then((r) => r.data),
    publish: (phaseId: string, subjectId: string, batchId: string) =>
      api.post('/hod/results/publish', { phaseId, subjectId, batchId }).then((r) => r.data),
    uploadHistory: (page = 1, limit = 10) =>
      api.get('/hod/results/upload-history', { params: { page, limit } }).then((r) => r.data),
    phaseStatus: (semesterId?: string) =>
      api.get('/hod/results/phase-status', { params: { semesterId } }).then((r) => r.data),
    updateOne: (resultId: string, marksObtained: number, grade: string) =>
      api.patch(`/hod/results/${resultId}`, { marksObtained, grade }).then((r) => r.data),
    deleteOne: (resultId: string) => api.delete(`/hod/results/${resultId}`).then((r) => r.data),
  },

  // ── Attendance ──
  attendance: {
    summary: (semesterId?: string) =>
      api.get<T.AttendanceStatSummary>('/hod/attendance/summary', { params: { semesterId } }).then((r) => r.data),
    heatmap: (batchId: string, semesterId: string) =>
      api.get('/hod/attendance/heatmap', { params: { batchId, semesterId } }).then((r) => r.data),
    table: (params: Params) =>
      api.get<PaginatedResponse<T.AttendanceTableRow>>('/hod/attendance/table', { params }).then((r) => r.data),
    bySubject: (batchId: string, semesterId: string) =>
      api.get('/hod/attendance/by-subject', { params: { batchId, semesterId } }).then((r) => r.data),
    lock: (subjectId: string, batchId: string, semesterId: string) =>
      api.patch('/hod/attendance/lock', { subjectId, batchId, semesterId }).then((r) => r.data),
    unlock: (enrollmentId: string, subjectId: string) =>
      api.patch('/hod/attendance/unlock', { enrollmentId, subjectId }).then((r) => r.data),
    lockAll: (batchId: string, semesterId: string) =>
      api.patch('/hod/attendance/lock-all', { batchId, semesterId }).then((r) => r.data),
    export: (batchId: string, semesterId: string, format: ExportFormat = 'csv') =>
      downloadExport('/hod/attendance/export', 'attendance', format, { batchId, semesterId }),
    coordinators: () => api.get<AttendanceCoordinators>('/hod/attendance/coordinators').then((r) => r.data),
    assignCoordinator: (facultyId: string) => api.post('/hod/attendance/coordinators', { facultyId }).then((r) => r.data),
    removeCoordinator: (facultyId: string) => api.delete(`/hod/attendance/coordinators/${facultyId}`).then((r) => r.data),
  },

  // ── Subjects ──
  subjects: {
    list: (params: Params) =>
      api.get<T.SubjectsResponse>('/hod/subjects', { params }).then((r) => r.data),
    get: (subjectId: string) => api.get(`/hod/subjects/${subjectId}`).then((r) => r.data),
    getConfig: (subjectId: string) =>
      api.get<SubjectConfig>(`/hod/subjects/${subjectId}/config`).then((r) => r.data),
    saveConfig: (subjectId: string, body: SubjectConfigInput) =>
      api.put<SubjectConfig>(`/hod/subjects/${subjectId}/config`, body).then((r) => r.data),
    create: (body: Record<string, unknown>) => api.post('/hod/subjects', body).then((r) => r.data),
    update: (subjectId: string, body: Record<string, unknown>) =>
      api.put(`/hod/subjects/${subjectId}`, body).then((r) => r.data),
    remove: (subjectId: string) => api.delete(`/hod/subjects/${subjectId}`).then((r) => r.data),
    copy: (fromSemesterId: string, toSemesterId: string) =>
      api.post('/hod/subjects/copy', { fromSemesterId, toSemesterId }).then((r) => r.data),
    uploadPyq: (subjectId: string, form: FormData) =>
      api.post(`/hod/subjects/${subjectId}/pyq`, form).then((r) => r.data),
  },

  // ── Mentorship ──
  mentorship: {
    summary: (semesterId?: string) =>
      api.get<T.MentorshipSummary>('/hod/mentorship/summary', { params: { semesterId } }).then((r) => r.data),
    mentors: (semesterId?: string) =>
      api.get<{ data: T.MentorCard[] }>('/hod/mentorship/mentors', { params: { semesterId } }).then((r) => r.data),
    assignments: (params: Params) =>
      api.get<PaginatedResponse<T.AssignmentRow>>('/hod/mentorship/assignments', { params }).then((r) => r.data),
    unassigned: (semesterId?: string) =>
      api.get<{ data: { enrollmentNo: string; name: string; batchCode: string; branch: string }[]; total: number }>(
        '/hod/mentorship/unassigned', { params: { semesterId } }).then((r) => r.data),
    assign: (studentEnrollmentNo: string, facultyId: string, semesterId: string) =>
      api.post('/hod/mentorship/assign', { studentEnrollmentNo, facultyId, semesterId }).then((r) => r.data),
    assignCsv: (form: FormData) =>
      api.post<T.CsvResult>('/hod/mentorship/assign/csv', form).then((r) => r.data),
    reassign: (studentEnrollmentNo: string, newFacultyId: string, semesterId: string) =>
      api.patch('/hod/mentorship/reassign', { studentEnrollmentNo, newFacultyId, semesterId }).then((r) => r.data),
    autoAssign: (semesterId: string) =>
      api.post('/hod/mentorship/auto-assign', { semesterId }).then((r) => r.data),
    remove: (assignmentId: string) =>
      api.delete(`/hod/mentorship/assignments/${assignmentId}`).then((r) => r.data),
  },

  // ── Analytics ──
  analytics: {
    kpi: (batchId?: string) =>
      api.get<T.AnalyticsKpi>('/hod/analytics/kpi', { params: { batchId } }).then((r) => r.data),
    attendanceTrend: (months = 6) =>
      api.get('/hod/analytics/attendance/trend', { params: { months } }).then((r) => r.data),
    attendanceBySubject: (batchId?: string) =>
      api.get('/hod/analytics/attendance/by-subject', { params: { batchId } }).then((r) => r.data),
    attendanceDistribution: (batchId?: string) =>
      api.get('/hod/analytics/attendance/distribution', { params: { batchId } }).then((r) => r.data),
    marksByPhase: () => api.get('/hod/analytics/marks/by-phase').then((r) => r.data),
    marksBySubject: (phaseId: string, batchId?: string) =>
      api.get('/hod/analytics/marks/by-subject', { params: { phaseId, batchId } }).then((r) => r.data),
    gradeDistribution: (phaseId: string, batchId?: string) =>
      api.get('/hod/analytics/marks/grade-distribution', { params: { phaseId, batchId } }).then((r) => r.data),
    leaderboard: (phaseId: string, batchId?: string, limit = 10) =>
      api.get('/hod/analytics/leaderboard', { params: { phaseId, batchId, limit } }).then((r) => r.data),
    performanceRadar: (phaseId: string) =>
      api.get('/hod/analytics/performance-radar', { params: { phaseId } }).then((r) => r.data),
    atRisk: (params: Params) =>
      api.get('/hod/analytics/at-risk', { params }).then((r) => r.data),
    notifyMentor: (enrollmentNo: string) =>
      api.post('/hod/analytics/at-risk/notify-mentor', { enrollmentNo }).then((r) => r.data),
    yearComparison: () => api.get('/hod/analytics/year-comparison').then((r) => r.data),
    export: (params: Params, format: ExportFormat = 'pdf') => downloadExport('/hod/analytics/export', 'analytics-at-risk', format, params),
  },

  // ── Promotion ──
  promotion: {
    // v2 — result-based
    context: () => api.get('/hod/promotion/context').then((r) => r.data),
    leaderboard: (branch?: string) => api.get('/hod/promotion/leaderboard', { params: { branch: branch || undefined } }).then((r) => r.data),
    yearPreview: (body: Record<string, unknown>) => api.post('/hod/promotion/year-preview', body).then((r) => r.data),
    executeSemester: (body: Record<string, unknown>) => api.post('/hod/promotion/execute-semester', body).then((r) => r.data),
    executeYear: (body: Record<string, unknown>) => api.post('/hod/promotion/execute-year', body).then((r) => r.data),

    years: () => api.get('/hod/promotion/years').then((r) => r.data),
    preview: (fromAcademicYearId: string, toAcademicYearId: string) =>
      api.get('/hod/promotion/preview', { params: { fromAcademicYearId, toAcademicYearId } }).then((r) => r.data),
    mappingCsv: (form: FormData) => api.post('/hod/promotion/mapping/csv', form).then((r) => r.data),
    saveMapping: (body: Record<string, unknown>) =>
      api.put('/hod/promotion/mapping', body).then((r) => r.data),
    suggestRolls: (draftId: string) =>
      api.get('/hod/promotion/roll-numbers/suggest', { params: { draftId } }).then((r) => r.data),
    rollCsv: (form: FormData) => api.post('/hod/promotion/roll-numbers/csv', form).then((r) => r.data),
    previewSummary: (draftId: string) =>
      api.get('/hod/promotion/preview-summary', { params: { draftId } }).then((r) => r.data),
    execute: (body: Record<string, unknown>) =>
      api.post('/hod/promotion/execute', body).then((r) => r.data),
    history: (page = 1, limit = 10) =>
      api.get('/hod/promotion/history', { params: { page, limit } }).then((r) => r.data),
  },

  // ── Calendar ──
  calendar: {
    events: (params: Params) =>
      api.get<{ data: T.HodCalendarEvent[] }>('/hod/calendar/events', { params }).then((r) => r.data),
    upcoming: (limit = 6) =>
      api.get<{ data: T.HodCalendarEvent[] }>('/hod/calendar/events/upcoming', { params: { limit } }).then((r) => r.data),
    get: (eventId: string) => api.get(`/hod/calendar/events/${eventId}`).then((r) => r.data),
    create: (body: Record<string, unknown>) => api.post('/hod/calendar/events', body).then((r) => r.data),
    update: (eventId: string, body: Record<string, unknown>) =>
      api.put(`/hod/calendar/events/${eventId}`, body).then((r) => r.data),
    remove: (eventId: string) => api.delete(`/hod/calendar/events/${eventId}`).then((r) => r.data),
    phaseTimeline: (semesterId?: string) =>
      api.get<{ phases: T.PhaseTimelineItem[] }>('/hod/calendar/phase-timeline', { params: { semesterId } }).then((r) => r.data),
    export: (academicYearId?: string, format: ExportFormat = 'pdf') =>
      downloadExport('/hod/calendar/export', 'calendar', format, { academicYearId }),
  },

  // ── Timetable ──
  timetable: {
    list: (params: Params) => api.get<{ semesterId: string; slots: HodTimetableSlot[] }>('/hod/timetable', { params }).then((r) => r.data),
    create: (body: Record<string, unknown>) => api.post('/hod/timetable', body).then((r) => r.data),
    update: (slotId: string, body: Record<string, unknown>) => api.put(`/hod/timetable/${slotId}`, body).then((r) => r.data),
    remove: (slotId: string) => api.delete(`/hod/timetable/${slotId}`).then((r) => r.data),
    uploadCsv: (form: FormData) => api.post<T.CsvResult>('/hod/timetable/csv', form).then((r) => r.data),
    downloadTemplate: () => downloadFile('/hod/timetable/csv/template', 'timetable-template.csv'),
  },

  // ── Settings ──
  settings: {
    profile: () => api.get<T.HodProfile>('/hod/settings/profile').then((r) => r.data),
    updateProfile: (body: Record<string, unknown>) =>
      api.put('/hod/settings/profile', body).then((r) => r.data),
    university: () => api.get('/hod/settings/university').then((r) => r.data),
    updateUniversity: (body: Record<string, unknown>) =>
      api.put('/hod/settings/university', body).then((r) => r.data),
    addBranch: (code: string, name: string) =>
      api.post('/hod/settings/university/branches', { code, name }).then((r) => r.data),
    academicYears: () =>
      api.get<{ data: T.AcademicYearWithSemesters[] }>('/hod/settings/academic-years').then((r) => r.data),
    createYear: (body: Record<string, unknown>) =>
      api.post('/hod/settings/academic-years', body).then((r) => r.data),
    activateYear: (yearId: string) =>
      api.patch(`/hod/settings/academic-years/${yearId}/activate`).then((r) => r.data),
    addSemester: (yearId: string, body: Record<string, unknown>) =>
      api.post(`/hod/settings/academic-years/${yearId}/semesters`, body).then((r) => r.data),
    notifications: () =>
      api.get<{ preferences: T.NotificationPref[] }>('/hod/settings/notifications').then((r) => r.data),
    updateNotifications: (preferences: { key: string; enabled: boolean }[]) =>
      api.put('/hod/settings/notifications', { preferences }).then((r) => r.data),
    changePassword: (currentPassword: string, newPassword: string) =>
      api.patch('/hod/settings/security/password', { currentPassword, newPassword }).then((r) => r.data),
    sessions: () => api.get('/hod/settings/security/sessions').then((r) => r.data),
    revokeSession: (sessionId: string) =>
      api.delete(`/hod/settings/security/sessions/${sessionId}`).then((r) => r.data),
    attendanceRules: () => api.get('/hod/settings/attendance-rules').then((r) => r.data),
    updateAttendanceRules: (body: Record<string, unknown>) =>
      api.put('/hod/settings/attendance-rules', body).then((r) => r.data),
    resetMentorAssignments: (semesterId: string) =>
      api.post('/hod/settings/danger/reset-mentor-assignments', { semesterId, confirm: true }).then((r) => r.data),
  },
}
