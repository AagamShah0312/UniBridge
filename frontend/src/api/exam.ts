import { api } from './client'

// ── Types ──
export interface ExamRow {
  id: string; name: string; status: string; yearLevel: string; blockSize: number; bufferMinutes: number; excludeHods: boolean
  scheduleCount: number; blockCount: number; publishedAt: string | null
}
export interface ExamSchedule {
  id: string; subjectId: string; subjectCode: string; subjectName: string; date: string
  startTime: string; endTime: string; durationMinutes: number; studentCount: number; branch: string | null
}
export interface ExamDetail {
  exam: { id: string; name: string; status: string; yearLevel: string; blockSize: number; bufferMinutes: number; excludeHods: boolean }
  blockCount: number; externalCount: number; schedules: ExamSchedule[]
}
export interface ExamBlock {
  id: string; ownerHodId: string; ownerHodName: string; blockNumber: number; room: string | null; isLocked: boolean
  studentCount: number; firstEnrollment: string | null; lastEnrollment: string | null
  students: { studentId: string; enrollmentNo: string; seatOrder: number }[]
}
export interface FacultyOpt { id: string; name: string; employeeId: string }
export interface AvailabilityRow { facultyId: string; name: string; employeeId: string; year: string | null; isHod: boolean; isOwnYear: boolean; free: boolean; reason: string | null }
export interface SupervisionRow { id: string; blockNumber: number; room: string | null; source: string; supervisor: string; facultyId: string | null; externalFacultyId: string | null }
export interface PaperCheckRow { id: string; facultyId: string; faculty: string; range: string; blockCount: number }
export interface StandbyRow { slot: number; facultyId: string; isActive: boolean; faculty: string }
export interface ExternalFacultyRow { id: string; name: string; mobile: string | null; college: string | null; experience: string | null; remarks: string | null; availability: string | null }
export interface ConflictReport { examId: string; ok: boolean; conflicts: { type: string; detail: string }[] }
export interface ExamDashboard {
  exam: { id: string; name: string; status: string; yearLevel: string }
  totalSchedules: number; generatedBlocks: number; allocatedBlocks: number; pendingBlocks: number
  externalFaculties: number; standbyFaculties: number; paperCheckingPending: number; coordinators: number; totalFaculty: number; published: boolean
}
export interface FacultyDuties {
  supervision: { exam: string; subject: string; date: string; time: string; block: number; room: string | null; isToday: boolean }[]
  paperChecking: { exam: string; subject: string; range: string; blocks: number }[]
  standby: { exam: string; subject: string; date: string; time: string; slot: number; isToday: boolean }[]
}

// ── Client ──
export const examApi = {
  list: () => api.get<{ yearLevel: string; exams: ExamRow[] }>('/exams').then((r) => r.data),
  create: (body: { name: string; blockSize?: number; bufferMinutes?: number; excludeHods?: boolean }) => api.post('/exams', body).then((r) => r.data),
  get: (examId: string) => api.get<ExamDetail>(`/exams/${examId}`).then((r) => r.data),
  remove: (examId: string) => api.delete(`/exams/${examId}`).then((r) => r.data),
  dashboard: (examId: string) => api.get<ExamDashboard>(`/exams/${examId}/dashboard`).then((r) => r.data),
  conflicts: (examId: string) => api.get<ConflictReport>(`/exams/${examId}/conflicts`).then((r) => r.data),
  publish: (examId: string) => api.post(`/exams/${examId}/publish`).then((r) => r.data),
  unpublish: (examId: string) => api.post(`/exams/${examId}/unpublish`).then((r) => r.data),

  yearSubjects: () => api.get<FacultyOpt[] | { id: string; code: string; name: string }[]>('/exams/meta/subjects').then((r) => r.data as { id: string; code: string; name: string }[]),
  addSchedule: (examId: string, body: { subjectId: string; date: string; startTime: string; endTime: string; branch?: string }) => api.post(`/exams/${examId}/schedules`, body).then((r) => r.data),
  updateSchedule: (scheduleId: string, body: Record<string, unknown>) => api.patch(`/exams/schedules/${scheduleId}`, body).then((r) => r.data),
  deleteSchedule: (scheduleId: string) => api.delete(`/exams/schedules/${scheduleId}`).then((r) => r.data),

  generateBlocks: (examId: string) => api.post(`/exams/${examId}/blocks/generate`).then((r) => r.data),
  blocks: (examId: string) => api.get<ExamBlock[]>(`/exams/${examId}/blocks`).then((r) => r.data),
  setBlockRoom: (blockId: string, room: string) => api.patch(`/exams/blocks/${blockId}/room`, { room }).then((r) => r.data),
  lockBlock: (blockId: string, isLocked: boolean) => api.patch(`/exams/blocks/${blockId}/lock`, { isLocked }).then((r) => r.data),
  moveStudent: (body: { studentId: string; fromBlockId: string; toBlockId: string }) => api.post('/exams/blocks/move', body).then((r) => r.data),
  swapBlocks: (body: { blockAId: string; blockBId: string }) => api.post('/exams/blocks/swap', body).then((r) => r.data),

  addExternal: (examId: string, body: Record<string, unknown>) => api.post(`/exams/${examId}/external`, body).then((r) => r.data),
  external: (examId: string) => api.get<ExternalFacultyRow[]>(`/exams/${examId}/external`).then((r) => r.data),
  removeExternal: (externalId: string) => api.delete(`/exams/external/${externalId}`).then((r) => r.data),

  availability: (scheduleId: string) => api.get<{ scheduleId: string; examYear: string; window: string; faculties: AvailabilityRow[] }>(`/exams/schedules/${scheduleId}/availability`).then((r) => r.data),
  generateSupervision: (scheduleId: string) => api.post(`/exams/schedules/${scheduleId}/supervision/generate`).then((r) => r.data),
  supervision: (scheduleId: string) => api.get<SupervisionRow[]>(`/exams/schedules/${scheduleId}/supervision`).then((r) => r.data),
  editSupervision: (allocationId: string, body: { facultyId?: string; externalFacultyId?: string }) => api.patch(`/exams/supervision/${allocationId}`, body).then((r) => r.data),
  generatePaperChecking: (scheduleId: string) => api.post(`/exams/schedules/${scheduleId}/paper-checking/generate`).then((r) => r.data),
  paperChecking: (scheduleId: string) => api.get<PaperCheckRow[]>(`/exams/schedules/${scheduleId}/paper-checking`).then((r) => r.data),
  generateStandby: (scheduleId: string) => api.post(`/exams/schedules/${scheduleId}/standby/generate`).then((r) => r.data),
  standby: (scheduleId: string) => api.get<StandbyRow[]>(`/exams/schedules/${scheduleId}/standby`).then((r) => r.data),
  setStandby: (scheduleId: string, slot: number, facultyId: string) => api.patch(`/exams/schedules/${scheduleId}/standby`, { slot, facultyId }).then((r) => r.data),

  myDuties: () => api.get<FacultyDuties>('/exams/me/duties').then((r) => r.data),
}
