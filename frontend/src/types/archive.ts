// Permanent academic archive. Shared by the HOD (own past batches) and University (all) portals —
// the payload shape is identical, only the server-side scope differs.

export interface ArchiveBatch {
  batchId: string
  batchCode: string
  yearLevel: string
  students: number
}

export interface ArchiveSemester {
  semesterId: string
  label: string
  number: number
  isActive: boolean
  batches: ArchiveBatch[]
  totalStudents: number
}

export interface ArchiveYear {
  academicYearId: string
  academicYear: string
  totalStudents: number
  semesters: ArchiveSemester[]
}

export interface ArchiveTree {
  scope: 'HOD' | 'UNIVERSITY'
  years: ArchiveYear[]
}

export interface ArchiveResult {
  phase: string
  subject: string
  marksObtained: number
  maxMarks: number
  grade: string | null
}

export interface ArchiveStudent {
  enrollmentNo: string
  name: string
  email: string
  branch: string
  admissionYear: number
  graduationStatus: string
  graduatedAt: string | null
  rollNo: string | null
  attendancePct: number | null
  lecturesHeld: number
  lecturesAttended: number
  results: ArchiveResult[]
}

export interface ArchiveSnapshot {
  batch: { id: string; code: string; yearLevel: string }
  semester: { id: string; label: string; number: number; academicYear: string }
  studentCount: number
  students: ArchiveStudent[]
}
