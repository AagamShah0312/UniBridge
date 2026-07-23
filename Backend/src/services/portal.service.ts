import prisma from "../config/prisma.js";
import { env } from "../config/env.js";
import { uploadObject, presignGetUrl, storageEnabled } from "../config/storage.js";
import { studentAiBridge } from "./studentAiBridge.service.js";
import { generateStudyPlanForStudent, getLatestStudyPlan, refreshStudyPlanAfterProgress } from "./studyPlanner.service.js";
import type { Role, YearLevel } from "../types/domain.js";
import type { ExportTable } from "../utils/export.js";
import { ApiError, buildPagination } from "../utils/http.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Scope = {
  universityId: string;
  hodBatchIds: string[];
  hodSemesterIds: string[];
  userId: string;
};

function planTaskTone(priority: string) {
  if (priority === "high") return "HIGH";
  if (priority === "low") return "LOW";
  return "MEDIUM";
}

function formatStudyPlan(plan: Awaited<ReturnType<typeof getLatestStudyPlan>>) {
  if (!plan) return { plan: null, updatedAt: null };
  const totalTasks = plan.tasks.length;
  const completedTasks = plan.tasks.filter((task) => task.isCompleted).length;
  return {
    plan: {
      id: plan.id,
      semester: plan.semester,
      startDate: plan.startDate,
      endDate: plan.endDate,
      status: plan.status,
      weakSubjectIds: plan.weakSubjectIds,
      weakTopics: plan.weakTopics,
      progress: {
        completedTasks,
        totalTasks,
        percent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      },
      tasks: plan.tasks.map((task) => ({
        id: task.id,
        date: task.taskDate,
        description: task.description,
        estimatedDurationMinutes: task.estimatedDurationMinutes,
        priority: task.priority,
        priorityLabel: planTaskTone(task.priority),
        isCompleted: task.isCompleted,
        isCustom: task.isCustom,
        subject: task.subject ? { id: task.subject.id, code: task.subject.code, name: task.subject.name } : null,
      })),
    },
    updatedAt: plan.updatedAt,
  };
}

async function bestEffortStudentAi(action: () => Promise<unknown>) {
  try {
    await action();
  } catch {
    // Best-effort background trigger: note/PYQ uploads should still succeed even if Django is offline.
  }
}

// ─────────────────────────────────────────────────────────────
// Pure utility helpers (no DB calls)
// ─────────────────────────────────────────────────────────────

function paginate<T>(rows: T[], page = 1, limit = 20) {
  const total = rows.length;
  const start = (page - 1) * limit;
  return {
    data: rows.slice(start, start + limit),
    ...buildPagination(page, limit, total),
  };
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1));
}

function standardDeviation(values: number[]) {
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function performanceLabel(percentage: number) {
  if (percentage >= 85) return "Excellent";
  if (percentage >= 70) return "Good";
  if (percentage >= 50) return "Average";
  return "Needs Improvement";
}

function to30Scale(percentage: number) {
  return Number(((percentage / 100) * 30).toFixed(2));
}

function normalizePhaseKey(label: string, number: number) {
  const normalized = label.toUpperCase().replace(/\s+/g, "");
  if (normalized.startsWith("T")) return normalized;
  return `T${number}`;
}

function matchesPassword(hash: string | null | undefined, candidate: string) {
  return (hash ?? "") === candidate;
}

function setPasswordHash<T extends { passwordHash?: string | null }>(entity: T, next: string) {
  entity.passwordHash = next;
}

function monthLabels(months: number) {
  const now = new Date();
  return Array.from({ length: months }, (_v, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - i - 1), 1));
    return d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  });
}

// ── Academic calendar: the master controller ────────────────────
// A single resolver every module consults before doing timetable/attendance work.
// These event types override the timetable and disable attendance for the day.
const NON_WORKING_TYPES = new Set(["HOLIDAY", "PUBLIC_HOLIDAY", "READING_HOLIDAY", "SEMESTER_BREAK"]);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface DayStatus {
  date: string;         // yyyy-mm-dd
  dayOfWeek: number;    // 0=Sun … 6=Sat
  dayLabel: string;
  isWorkingDay: boolean;
  status: string;       // WORKING | SUNDAY | HOLIDAY | PUBLIC_HOLIDAY | READING_HOLIDAY | SEMESTER_BREAK
  reason: string | null;
  isExamDay: boolean;   // exam days stay "working" but attendance can be gated per-rule
  events: { title: string; eventType: string }[];
}

// Classify any date from the active calendar. Sunday is always non-working; a covering
// HOLIDAY/PUBLIC_HOLIDAY/READING_HOLIDAY/SEMESTER_BREAK event overrides everything else.
async function resolveDayStatus(universityId: string, dateStr?: string): Promise<DayStatus> {
  const base = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(base.getTime())) throw new ApiError(400, "VALIDATION_ERROR", "Invalid date.");
  const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const dayOfWeek = day.getUTCDay();
  const events = await prisma.calendarEvent.findMany({
    where: { universityId, deletedAt: null, startDate: { lte: day }, endDate: { gte: day } },
    select: { title: true, eventType: true },
    orderBy: { startDate: "asc" },
  });
  const override = events.find((e) => NON_WORKING_TYPES.has(e.eventType));
  const isExamDay = events.some((e) => e.eventType === "EXAM");
  let status = "WORKING", isWorkingDay = true, reason: string | null = null;
  if (override) { status = override.eventType; isWorkingDay = false; reason = override.title; }
  else if (dayOfWeek === 0) { status = "SUNDAY"; isWorkingDay = false; reason = "Sunday — weekly holiday"; }
  return { date: day.toISOString().slice(0, 10), dayOfWeek, dayLabel: DAY_NAMES[dayOfWeek], isWorkingDay, status, reason, isExamDay, events };
}

function parseCsvRecords(fileBuffer: Buffer, requiredHeaders: string[]) {
  const raw = fileBuffer.toString("utf8").trim();
  if (!raw) throw new ApiError(422, "UNPROCESSABLE_CSV", "CSV file is empty.");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new ApiError(422, "UNPROCESSABLE_CSV", "CSV must include a header and at least one data row.");
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const missing = requiredHeaders.filter((h) => !headers.includes(h));
  if (missing.length > 0) throw new ApiError(422, "UNPROCESSABLE_CSV", `CSV is missing required columns: ${missing.join(", ")}.`);
  return lines.slice(1).map((line, i) => {
    const values = line.split(",").map((v) => v.trim());
    return { row: i + 2, record: Object.fromEntries(headers.map((h, hi) => [h, values[hi] ?? ""])) };
  });
}

function gradeFromPct(pct: number): string {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ponytail: identity tag from batch initial + year level, e.g. batch "C2" in SY → "SY-3"
// (A→1, B→2, C→3…). Lets the Dean read a person's year+section at a glance.
function sectionTag(yearLevel: string | null | undefined, batchCode: string | null | undefined): string | null {
  if (!yearLevel) return null;
  const initial = batchCode?.trim()?.[0]?.toUpperCase();
  if (!initial || initial < "A" || initial > "Z") return yearLevel;
  return `${yearLevel}-${initial.charCodeAt(0) - 64}`;
}

function parseBatchIds(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.map(String).map((id) => id.trim()).filter(Boolean))];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return [...new Set(parsed.map(String).map((id) => id.trim()).filter(Boolean))];
  } catch {
    // Accept a simple comma-separated fallback for non-browser clients.
  }
  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

function uniq<T>(values: T[]) {
  return [...new Set(values)];
}

function objectUrl(fileKey: string) {
  return env.STORAGE_BUCKET_URL && env.S3_BUCKET
    ? `${env.STORAGE_BUCKET_URL.replace(/\/$/, "")}/${encodeURIComponent(env.S3_BUCKET)}/${fileKey.split("/").map(encodeURIComponent).join("/")}`
    : `/mock/${fileKey}`;
}

// A note publishes immediately unless given a future release timestamp. Server clock is authoritative.
function resolveRelease(raw?: string): { status: "PUBLISHED" | "SCHEDULED"; releaseAt: Date } {
  const now = new Date();
  if (!raw) return { status: "PUBLISHED", releaseAt: now };
  const at = new Date(raw);
  if (isNaN(at.getTime())) throw new ApiError(400, "VALIDATION_ERROR", "Invalid release date.");
  return at.getTime() > now.getTime() ? { status: "SCHEDULED", releaseAt: at } : { status: "PUBLISHED", releaseAt: now };
}

// ─────────────────────────────────────────────────────────────
// DB Helper functions (async, Prisma-backed)
// ─────────────────────────────────────────────────────────────

async function getUniversity(universityId: string) {
  const u = await prisma.university.findUnique({ where: { id: universityId } });
  if (!u) throw new ApiError(404, "UNIVERSITY_NOT_FOUND", "University not found.");
  return u;
}

// ponytail: preferSemesterId lets HOD-scoped calls target THEIR active sem
// when multiple year levels are ACTIVE at the same time.
async function getActiveSemester(universityId: string, preferSemesterId?: string) {
  if (preferSemesterId) {
    const preferred = await prisma.semester.findUnique({ where: { id: preferSemesterId } });
    if (preferred && preferred.universityId === universityId) return preferred;
  }
  const s = await prisma.semester.findFirst({ where: { universityId, status: "ACTIVE" } });
  if (s) return s;
  return { id: "", universityId, label: "No active semester", number: 0, status: "ACTIVE" as const, yearLevel: "FY" as const, academicYearId: "", startDate: new Date(), endDate: new Date(), createdAt: new Date(), updatedAt: new Date() };
}

// ponytail: the active semester THIS HOD works in. Prefer their scoped semester;
// before onboarding (no scopes) fall back to the ACTIVE semester of their year level
// (each batch/year runs one active sem; year levels FY/SY/TY/FINAL run in parallel batches).
async function hodActiveSemester(universityId: string, hodYear: string | null | undefined, hodSemesterIds: string[]) {
  if (hodSemesterIds[0]) {
    const s = await prisma.semester.findUnique({ where: { id: hodSemesterIds[0] } });
    if (s && s.universityId === universityId) return s;
  }
  if (hodYear) {
    const s = await prisma.semester.findFirst({ where: { universityId, status: "ACTIVE", yearLevel: hodYear as any } });
    if (s) return s;
  }
  return getActiveSemester(universityId);
}

async function getSemester(semesterId?: string, universityId?: string) {
  if (semesterId) {
    const s = await prisma.semester.findUnique({ where: { id: semesterId } });
    if (!s) throw new ApiError(404, "SEMESTER_NOT_FOUND", "Semester not found.");
    return s;
  }
  if (universityId) return getActiveSemester(universityId);
  throw new ApiError(400, "SEMESTER_REQUIRED", "Semester or university ID required.");
}

// ponytail: the active semester THIS faculty teaches in. With several year levels active at once,
// getActiveSemester(uni) is ambiguous — prefer the ACTIVE semester where they have assignments,
// then their year level, then any active. Mirrors hodActiveSemester so HOD & faculty agree.
async function facultyActiveSemester(facultyId: string, universityId: string, explicitSemesterId?: string) {
  if (explicitSemesterId) return getSemester(explicitSemesterId);
  const asg = await prisma.facultyBatchAssignment.findFirst({
    where: { facultyId, semester: { status: "ACTIVE", universityId } },
    include: { semester: true },
    orderBy: { semester: { number: "desc" } },
  });
  if (asg?.semester) return asg.semester;
  const fac = await prisma.faculty.findUnique({ where: { id: facultyId }, select: { year: true } });
  if (fac?.year) {
    const s = await prisma.semester.findFirst({ where: { universityId, status: "ACTIVE", yearLevel: fac.year as any } });
    if (s) return s;
  }
  return getActiveSemester(universityId);
}

// Content can only target batches that the uploading faculty teaches for the
// same subject and active semester. This keeps an arbitrary batch id from
// becoming a cross-division visibility bypass.
async function validateFacultyContentTargets(
  facultyId: string,
  universityId: string,
  subjectId: string,
  semesterId: string,
  requestedBatchIds: string[],
) {
  if (requestedBatchIds.length === 0) {
    throw new ApiError(400, "BATCH_REQUIRED", "Select at least one assigned batch.");
  }
  const assignments = await prisma.facultyBatchAssignment.findMany({
    where: { facultyId, subjectId, semesterId, faculty: { universityId } },
    select: { batchId: true },
  });
  const allowed = new Set(assignments.map((assignment) => assignment.batchId));
  const invalid = requestedBatchIds.filter((batchId) => !allowed.has(batchId));
  if (invalid.length > 0) {
    throw new ApiError(403, "BATCH_NOT_ASSIGNED", "Content can only be shared with your assigned batches for this subject.");
  }
  return requestedBatchIds;
}

// ponytail: the semester an HOD-scoped call operates on. With multiple batches active at once,
// getActiveSemester(uni) is ambiguous — resolve to the HOD's OWN scoped semester instead.
async function scopeSemester(scope: Scope, explicitSemesterId?: string) {
  if (explicitSemesterId) return getSemester(explicitSemesterId);
  if (scope.hodSemesterIds?.[0]) {
    const s = await prisma.semester.findUnique({ where: { id: scope.hodSemesterIds[0] } });
    if (s && s.universityId === scope.universityId) return s;
  }
  // Before onboarding an HOD has no scoped semester — fall back to the tenant's active
  // semester. (Was `return scopeSemester(scope)`, which recursed forever and hung the request.)
  return getActiveSemester(scope.universityId);
}

async function getAcademicYear(academicYearId: string) {
  const y = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
  if (!y) throw new ApiError(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found.");
  return y;
}

async function batchById(batchId: string) {
  const b = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!b) throw new ApiError(404, "BATCH_NOT_FOUND", "Batch not found.");
  return b;
}

async function subjectById(subjectId: string) {
  const s = await prisma.subject.findUnique({ where: { id: subjectId } });
  if (!s) throw new ApiError(404, "SUBJECT_NOT_FOUND", "Subject not found.");
  return s;
}

// ponytail: subjects are global-by-semester-number. Resolve "subjects for this semester (row)"
// to the catalog entries for that semester's NUMBER within the university.
async function subjectsBySemester(semesterId: string) {
  const sem = await prisma.semester.findUnique({ where: { id: semesterId }, select: { universityId: true, number: true } });
  if (!sem) return [];
  return prisma.subject.findMany({ where: { universityId: sem.universityId, semesterNumber: sem.number, deletedAt: null }, orderBy: { code: "asc" } });
}

async function phaseById(phaseId: string) {
  const p = await prisma.phase.findUnique({ where: { id: phaseId } });
  if (!p) throw new ApiError(404, "PHASE_NOT_FOUND", "Phase not found.");
  return p;
}

// Subject → its teaching faculty for a semester, from FacultyBatchAssignment.
// One query, grouped. Excludes HOD/Dean/inactive so it feeds assignable-faculty dropdowns.
async function subjectFacultyMap(semesterId: string) {
  const assignments = await prisma.facultyBatchAssignment.findMany({
    where: { semesterId, faculty: { isHod: false, isDean: false, isActive: true, deletedAt: null } },
    select: { subjectId: true, faculty: { select: { id: true, name: true, employeeId: true } } },
  });
  const map = new Map<string, { id: string; name: string; employeeId: string }[]>();
  for (const a of assignments) {
    const arr = map.get(a.subjectId) ?? [];
    if (!arr.some((x) => x.id === a.faculty.id)) arr.push(a.faculty);
    map.set(a.subjectId, arr);
  }
  return map;
}

// Universal branch rule: a student's branch must be one the university offers.
// Single guard for every student create/update path.
async function assertBranchAllowed(universityId: string, branch: string) {
  const b = await prisma.universityBranch.findFirst({ where: { universityId, code: branch } });
  if (!b) throw new ApiError(400, "BRANCH_NOT_ALLOWED", `Branch "${branch}" is not offered by this university. Add it in University → Branches first.`);
  return b;
}

async function requireExamCoordinator(facultyId: string, universityId: string) {
  // ponytail: with multi-active-sem, resolve to the semester this faculty actually teaches in.
  const semester = await facultyActiveSemester(facultyId, universityId);
  const coordinator = semester.id
    ? await prisma.examCoordinator.findFirst({ where: { semesterId: semester.id, facultyId } })
    : null;
  if (!coordinator) throw new ApiError(403, "NOT_EXAM_COORDINATOR", "Only an exam coordinator can do this.");
  return { coordinator, semester };
}

// ponytail: enrollment-no range is a string compare — works because a college's
// enrollment numbers share one fixed-width format. Revisit if formats ever mix.
// Sum of obtained/max published marks per enrollment → merit aggregate.
async function promotionAggregates(enrollmentIds: string[]) {
  const agg = new Map<string, { got: number; max: number }>();
  if (enrollmentIds.length === 0) return agg;
  const results = await prisma.result.findMany({ where: { enrollmentId: { in: enrollmentIds } }, select: { enrollmentId: true, marksObtained: true, maxMarks: true } });
  for (const r of results) {
    const a = agg.get(r.enrollmentId) ?? { got: 0, max: 0 };
    a.got += r.marksObtained; a.max += r.maxMarks;
    agg.set(r.enrollmentId, a);
  }
  return agg;
}

// Students for a paper-check range: everyone taking the subject (across all its
// batches) whose enrollment_no falls in [from, to]. Batch is no longer part of the key.
async function examRangeEnrollments(semesterId: string, subjectId: string, from: string, to: string) {
  const batchIds = [...new Set(
    (await prisma.facultyBatchAssignment.findMany({ where: { semesterId, subjectId }, select: { batchId: true } })).map((a) => a.batchId),
  )];
  if (batchIds.length === 0) return [];
  const enrs = await prisma.studentEnrollment.findMany({
    where: { batchId: { in: batchIds }, semesterId, isCurrent: true },
    include: { student: { select: { enrollmentNo: true, name: true } } },
  });
  return enrs
    .filter((e) => e.student.enrollmentNo >= from && e.student.enrollmentNo <= to)
    .sort((a, b) => a.student.enrollmentNo.localeCompare(b.student.enrollmentNo));
}

async function enrollmentById(enrollmentId: string) {
  const e = await prisma.studentEnrollment.findUnique({ where: { id: enrollmentId } });
  if (!e) throw new ApiError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found.");
  return e;
}

async function facultyById(facultyId: string) {
  const f = await prisma.faculty.findFirst({ where: { id: facultyId, deletedAt: null } });
  if (!f) throw new ApiError(404, "FACULTY_NOT_FOUND", "Faculty not found.");
  return f;
}

async function facultyByEmployeeId(employeeId: string) {
  const f = await prisma.faculty.findFirst({ where: { employeeId, deletedAt: null } });
  if (!f) throw new ApiError(404, "FACULTY_NOT_FOUND", "Faculty not found.");
  return f;
}

async function studentByEnrollmentNo(enrollmentNo: string) {
  const s = await prisma.student.findFirst({ where: { enrollmentNo, deletedAt: null } });
  if (!s) throw new ApiError(404, "STUDENT_NOT_FOUND", "Student not found.");
  return s;
}

async function getStudentUser(studentId: string) {
  const s = await prisma.student.findFirst({ where: { id: studentId, deletedAt: null } });
  if (!s) throw new ApiError(404, "NOT_FOUND", "Student not found.");
  return s;
}

async function getFacultyUser(facultyId: string) {
  const f = await prisma.faculty.findFirst({
    where: { id: facultyId, deletedAt: null, NOT: { employeeId: "ADMIN001" } },
  });
  if (!f) throw new ApiError(404, "FACULTY_NOT_FOUND", "Faculty not found.");
  return f;
}

async function currentEnrollmentForStudent(studentId: string, semesterId?: string) {
  return prisma.studentEnrollment.findFirst({
    where: { studentId, isCurrent: true, ...(semesterId ? { semesterId } : {}) },
  });
}

// ponytail: enrollments for a HOD view. No semesterId → live (isCurrent in current batches).
// With semesterId → the students the HOD MANAGED that semester: enrollments at that semester in
// ANY batch the HOD has ever owned (works for both the active semester and past ones — history).
async function scopedCurrentEnrollments(scope: Scope, semesterId?: string) {
  if (semesterId) {
    const allBatchIds = await hodAllBatchIds(scope.userId);
    return prisma.studentEnrollment.findMany({
      where: { semesterId, batchId: { in: allBatchIds.length ? allBatchIds : scope.hodBatchIds } },
    });
  }
  return prisma.studentEnrollment.findMany({
    where: { isCurrent: true, batchId: { in: scope.hodBatchIds } },
  });
}

async function getMentorAssignment(studentId: string, semesterId: string) {
  return prisma.mentorAssignment.findFirst({ where: { studentId, semesterId } });
}

async function getFacultyAssignments(facultyId: string, semesterId?: string) {
  return prisma.facultyBatchAssignment.findMany({
    where: { facultyId, ...(semesterId ? { semesterId } : {}) },
  });
}

async function getFacultyScopeData(facultyId: string, universityId: string, semesterId?: string) {
  const semester = await facultyActiveSemester(facultyId, universityId, semesterId);
  const assignments = await getFacultyAssignments(facultyId, semester.id);
  const assignedBatchIds = [...new Set(assignments.map((a) => a.batchId))];
  const assignedSubjectIds = [...new Set(assignments.map((a) => a.subjectId).filter((id): id is string => Boolean(id)))];
  const mentorAssignments = await prisma.mentorAssignment.findMany({
    where: { facultyId, semesterId: semester.id },
  });
  return {
    semester,
    assignments,
    assignedBatchIds,
    assignedSubjectIds,
    mentorAssignments,
    mentorStudentIds: mentorAssignments.map((m) => m.studentId),
  };
}

async function ensureFacultyAssignedBatch(facultyId: string, universityId: string, batchId: string, semesterId?: string) {
  const { assignedBatchIds } = await getFacultyScopeData(facultyId, universityId, semesterId);
  if (!assignedBatchIds.includes(batchId)) {
    throw new ApiError(403, "NOT_ASSIGNED_TO_BATCH", "You are not assigned to this batch.");
  }
}

async function ensureFacultyAssignedSubject(facultyId: string, universityId: string, subjectId: string, semesterId?: string) {
  const { assignedSubjectIds } = await getFacultyScopeData(facultyId, universityId, semesterId);
  if (!assignedSubjectIds.includes(subjectId)) {
    throw new ApiError(403, "NOT_ASSIGNED_TO_SUBJECT", "You are not assigned to this subject.");
  }
}

async function getFacultyVisibleEnrollments(facultyId: string, universityId: string, semesterId?: string) {
  const { assignedBatchIds, semester } = await getFacultyScopeData(facultyId, universityId, semesterId);
  return prisma.studentEnrollment.findMany({
    where: { isCurrent: true, semesterId: semester.id, batchId: { in: assignedBatchIds } },
  });
}

async function getStudentEnrollment(studentId: string, universityId: string, semesterId?: string) {
  const student = await getStudentUser(studentId);
  // With several year levels ACTIVE at once, getActiveSemester(uni) is ambiguous. Resolve the
  // semester from the STUDENT's own enrollment instead: explicit → their enrollment at that
  // semester (current or historical); otherwise → their single live (isCurrent) enrollment.
  const enrollment = semesterId
    ? await prisma.studentEnrollment.findFirst({ where: { studentId: student.id, semesterId } })
    : await currentEnrollmentForStudent(student.id);
  if (!enrollment) throw new ApiError(404, "NOT_FOUND", "Current enrollment not found.");
  const semester = await getSemester(enrollment.semesterId);
  return { student, semester, enrollment };
}

async function getStudentSubjectIds(studentId: string, universityId: string, semesterId?: string) {
  const { enrollment, semester } = await getStudentEnrollment(studentId, universityId, semesterId);
  const assignments = await prisma.facultyBatchAssignment.findMany({
    where: { batchId: enrollment.batchId, semesterId: semester.id },
    select: { subjectId: true },
  });
  return [...new Set(assignments.map((a) => a.subjectId))];
}

async function ensureStudentSubject(studentId: string, universityId: string, subjectId: string, semesterId?: string) {
  const ids = await getStudentSubjectIds(studentId, universityId, semesterId);
  if (!ids.includes(subjectId)) {
    throw new ApiError(403, "SUBJECT_NOT_IN_ENROLLMENT", "Subject is not in student's current enrollment.");
  }
}

async function getStudentMentorAssignment(studentId: string, universityId: string, semesterId?: string) {
  const { semester } = await getStudentEnrollment(studentId, universityId, semesterId);
  return getMentorAssignment(studentId, semester.id);
}

async function currentPhaseForSemester(semesterId: string) {
  const active = await prisma.phase.findFirst({ where: { semesterId, isComplete: false }, orderBy: { number: "asc" } });
  if (active) return active;
  return prisma.phase.findFirst({ where: { semesterId }, orderBy: { number: "asc" } });
}

async function getAttendanceRules(universityId: string) {
  const rules = await prisma.attendanceRules.findUnique({ where: { universityId } });
  return rules ?? { minThresholdPct: 75, warningThresholdPct: 80, autoNotifyMentor: true, autoLockAfterDays: 7 };
}

/** Compute attendance % for an enrollment+subject from per-lecture rows */
async function computeAttendancePct(enrollmentId: string, subjectId: string) {
  const records = await prisma.attendanceRecord.findMany({
    where: { enrollmentId, subjectId },
    select: { isPresent: true },
  });
  if (records.length === 0) return 0;
  return Number(((records.filter((r) => r.isPresent).length / records.length) * 100).toFixed(2));
}

/** Compute overall attendance pct across all subjects for an enrollment */
async function computeOverallAttendancePct(enrollmentId: string) {
  const records = await prisma.attendanceRecord.findMany({
    where: { enrollmentId },
    select: { isPresent: true },
  });
  if (records.length === 0) return 0;
  return Number(((records.filter((r) => r.isPresent).length / records.length) * 100).toFixed(2));
}

// Bulk attendance %: TWO grouped queries for a whole page of students instead of one
// findMany per enrollment (the N+1 that dominated dashboard/at-risk/attendance response time).
async function overallAttendancePctBulk(enrollmentIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (enrollmentIds.length === 0) return map;
  const [totals, presents] = await Promise.all([
    prisma.attendanceRecord.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: enrollmentIds } }, _count: { _all: true } }),
    prisma.attendanceRecord.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: enrollmentIds }, isPresent: true }, _count: { _all: true } }),
  ]);
  const presentBy = new Map(presents.map((p) => [p.enrollmentId, p._count._all]));
  for (const t of totals) {
    const total = t._count._all;
    map.set(t.enrollmentId, total === 0 ? 0 : Number(((presentBy.get(t.enrollmentId) ?? 0) / total * 100).toFixed(2)));
  }
  return map;
}

// Ordered array of pcts for a list of enrollments — drop-in for the old
// `Promise.all(enrollments.map((e) => computeOverallAttendancePct(e.id)))` pattern.
async function overallAttendancePctBulkArr(enrollments: { id: string }[]): Promise<number[]> {
  const m = await overallAttendancePctBulk(enrollments.map((e) => e.id));
  return enrollments.map((e) => m.get(e.id) ?? 0);
}

async function getScopedFaculty(scope: Scope) {
  // ponytail: pool-first — an HOD sees their claimed pool. Fallback to year-strict for
  // pre-onboarded HODs so the roster isn't empty before they save a pool.
  const hod = await prisma.faculty.findFirst({ where: { id: scope.userId }, select: { year: true } });
  const hodYear = hod?.year || null;
  const pool = await prisma.faculty.findMany({
    where: {
      universityId: scope.universityId, deletedAt: null, isDean: false, hodId: scope.userId, NOT: { employeeId: "ADMIN001" },
    },
  });
  if (pool.length > 0) return pool;
  return prisma.faculty.findMany({
    where: {
      universityId: scope.universityId, deletedAt: null, isDean: false, NOT: { employeeId: "ADMIN001" },
      ...(hodYear ? { year: hodYear } : {}),
    },
  });
}

async function ensureBatchInScope(batchId: string, scope: Scope) {
  if (!scope.hodBatchIds.includes(batchId)) {
    throw new ApiError(403, "BATCH_NOT_IN_SCOPE", "Requested batch is not in this HOD's scope.");
  }
}

// Every batch this HOD has EVER owned (across all years/semesters) — used for historical views.
async function hodAllBatchIds(hodId: string) {
  const scopes = await prisma.hodBatchScope.findMany({ where: { facultyId: hodId }, select: { batchId: true } });
  return scopes.map((s) => s.batchId);
}

// A Prisma StudentEnrollment `where` for a HOD view. No explicit semester → live (isCurrent in the
// HOD's current batches). Explicit semester → the students managed then (that semester, in ANY batch
// the HOD ever owned). One source of truth for every HOD list so history works everywhere.
async function hodEnrollmentWhere(scope: Scope, explicitSemesterId?: string, batchId?: string) {
  if (explicitSemesterId) {
    const allBatchIds = await hodAllBatchIds(scope.userId);
    return { semesterId: explicitSemesterId, batchId: batchId ?? { in: allBatchIds.length ? allBatchIds : scope.hodBatchIds } };
  }
  return { isCurrent: true, batchId: batchId ?? { in: scope.hodBatchIds } };
}

async function studentAnnouncementVisible(
  announcement: { deletedAt: Date | null; universityId: string; scope: string; scopeValue: string | null },
  studentId: string,
  universityId: string,
  semesterId?: string,
) {
  const { enrollment } = await getStudentEnrollment(studentId, universityId, semesterId);
  const batch = await batchById(enrollment.batchId);
  return (
    !announcement.deletedAt &&
    announcement.universityId === universityId &&
    (announcement.scope === "ALL" ||
      (announcement.scope === "BATCH" && announcement.scopeValue === enrollment.batchId) ||
      (announcement.scope === "YEAR_LEVEL" && announcement.scopeValue === batch.yearLevel))
  );
}

async function isAnnouncementRead(studentId: string, announcementId: string) {
  const r = await prisma.announcementRead.findUnique({ where: { announcementId_studentId: { announcementId, studentId } } });
  return Boolean(r);
}

async function statusFromAttendancePctAndMarks(attendancePct: number, avgMarksPct: number, universityId: string, isActive = true) {
  if (!isActive) return "INACTIVE";
  const rules = await getAttendanceRules(universityId);
  if (attendancePct < rules.minThresholdPct || avgMarksPct < 40) return "AT_RISK";
  return "ACTIVE";
}

// ─────────────────────────────────────────────────────────────
// Service export
// ─────────────────────────────────────────────────────────────

export const portalService = {
  // ── Auth ──────────────────────────────────────────────────
  // The account decides the role — the client no longer picks it. Resolve by identifier:
  // a matching student → STUDENT; otherwise a faculty whose flags map to Dean/HOD/Faculty.
  // `role` is accepted for backwards compatibility but is ignored for resolution.
  async login(email: string, password: string, _role?: Role | "HOD") {
    // Students authenticate by email OR enrollment number (faculty emails never match a
    // numeric enrollment no., so there is no ambiguity between the two account types).
    const student = await prisma.student.findFirst({
      where: { OR: [{ email }, { enrollmentNo: email }], deletedAt: null },
      select: { id: true, email: true, enrollmentNo: true, name: true, passwordHash: true, isActive: true, branch: true, admissionYear: true, profilePhotoUrl: true, phone: true, universityId: true },
    });
    if (student) {
      if (!matchesPassword(student.passwordHash, password)) throw new ApiError(401, "INVALID_CREDENTIALS", "Wrong email or password.");
      if (!student.isActive) throw new ApiError(403, "ACCOUNT_INACTIVE", "Account is inactive.");
      const refreshToken = `refresh:STUDENT:${student.id}:${Date.now()}`;
      await prisma.refreshToken.create({ data: { token: refreshToken, studentId: student.id, expiresAt: new Date("2026-12-31T23:59:59.000Z") } });
      return {
        accessToken: `STUDENT:${student.id}`,
        refreshToken,
        expiresIn: 900,
        user: { id: student.id, enrollmentNo: student.enrollmentNo, name: student.name, email: student.email, role: "STUDENT", isHod: false, universityId: student.universityId, branch: student.branch, isFirstLogin: student.passwordHash === `${student.enrollmentNo}@123` },
      };
    }
    const faculty = await prisma.faculty.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true, isActive: true, isHod: true, isDean: true, year: true, mentorCode: true, profilePhotoUrl: true, employeeId: true, universityId: true },
    });
    if (!faculty || !matchesPassword(faculty.passwordHash, password)) throw new ApiError(401, "INVALID_CREDENTIALS", "Wrong email or password.");
    if (!faculty.isActive) throw new ApiError(403, "ACCOUNT_INACTIVE", "Account is inactive.");
    const resolvedRole: "HOD" | "FACULTY" | "SUPER_ADMIN" = faculty.isDean ? "SUPER_ADMIN" : faculty.isHod ? "HOD" : "FACULTY";
    const refreshToken = `refresh:${resolvedRole}:${faculty.id}:${Date.now()}`;
    await prisma.refreshToken.create({ data: { token: refreshToken, facultyId: faculty.id, expiresAt: new Date("2026-12-31T23:59:59.000Z") } });
    return {
      accessToken: `${resolvedRole}:${faculty.id}`,
      refreshToken,
      expiresIn: 900,
      user: { id: faculty.id, name: faculty.name, email: faculty.email, role: resolvedRole === "SUPER_ADMIN" ? "SUPER_ADMIN" : "FACULTY", isHod: faculty.isHod, universityId: faculty.universityId, year: faculty.year, mentorCode: faculty.mentorCode },
    };
  },

  async register(
    body: { role: "HOD" | "FACULTY" | "STUDENT"; name: string; email: string; password: string; universityId?: string; employeeId?: string; enrollmentNo?: string; year?: string; phone?: string; branch?: string; admissionYear?: number; isHod?: boolean },
    universityId: string,
  ) {
    if (body.password.length < 8) throw new ApiError(400, "PASSWORD_TOO_WEAK", "Password must be at least 8 characters.");
    if (body.role === "STUDENT") {
      if (!body.enrollmentNo || !body.branch || !body.admissionYear) throw new ApiError(400, "VALIDATION_ERROR", "Student registration requires enrollmentNo, branch, and admissionYear.");
      const existing = await prisma.student.findFirst({ where: { OR: [{ email: body.email }, { enrollmentNo: body.enrollmentNo }] }, select: { id: true } });
      if (existing) throw new ApiError(409, "CONFLICT", "Student email or enrollment number already exists.");
      await assertBranchAllowed(universityId, body.branch);
      const student = await prisma.student.create({
        data: { universityId, enrollmentNo: body.enrollmentNo, name: body.name, email: body.email, phone: body.phone ?? null, branch: body.branch, admissionYear: body.admissionYear, isActive: true, passwordHash: body.password, profilePhotoUrl: null },
      });
      return { id: student.id, role: "STUDENT", enrollmentNo: student.enrollmentNo, name: student.name, email: student.email };
    }
    if (!body.employeeId || !body.year) throw new ApiError(400, "VALIDATION_ERROR", "Faculty/HOD registration requires employeeId and year.");
    const existingF = await prisma.faculty.findFirst({ where: { OR: [{ email: body.email }, { employeeId: body.employeeId }] }, select: { id: true } });
    if (existingF) throw new ApiError(409, "CONFLICT", "Faculty email or employeeId already exists.");
    const isHod = body.role === "HOD" || body.isHod === true;
    const faculty = await prisma.faculty.create({
      data: { universityId, employeeId: body.employeeId, name: body.name, email: body.email, year: body.year, isHod, isActive: true, phone: body.phone ?? null, mentorCode: null, profilePhotoUrl: null, passwordHash: body.password },
    });
    return { id: faculty.id, role: isHod ? "HOD" : "FACULTY", employeeId: faculty.employeeId, name: faculty.name, email: faculty.email, year: faculty.year };
  },

  async refresh(refreshToken: string) {
    const token = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!token) throw new ApiError(401, "REFRESH_TOKEN_INVALID", "Refresh token is invalid.");
    const parts = refreshToken.split(":");
    if (parts.length < 4 || parts[0] !== "refresh") throw new ApiError(401, "REFRESH_TOKEN_INVALID", "Refresh token is invalid.");
    const accessRole = parts[1] as "STUDENT" | "HOD" | "FACULTY" | "SUPER_ADMIN";
    const userId = parts[2];
    if (accessRole === "STUDENT" && token.studentId !== userId) throw new ApiError(401, "REFRESH_TOKEN_INVALID", "Refresh token is invalid.");
    if (accessRole !== "STUDENT" && token.facultyId !== userId) throw new ApiError(401, "REFRESH_TOKEN_INVALID", "Refresh token is invalid.");
    return { accessToken: `${accessRole}:${userId}`, expiresIn: 900 };
  },

  async logout(refreshToken: string) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  },

  async me(userId: string, role: Role, universityId: string) {
    if (role === "STUDENT") {
      const student = await prisma.student.findUnique({ where: { id: userId }, select: { id: true, enrollmentNo: true, name: true, email: true, branch: true, admissionYear: true, profilePhotoUrl: true, phone: true, universityId: true } });
      if (!student) throw new ApiError(404, "NOT_FOUND", "User not found.");
      return { id: student.id, enrollmentNo: student.enrollmentNo, name: student.name, email: student.email, branch: student.branch, admissionYear: student.admissionYear, profilePhotoUrl: student.profilePhotoUrl ?? null, phone: student.phone, university: await getUniversity(universityId) };
    }
    if (role === "SUPER_ADMIN") {
      const admin = await prisma.faculty.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, year: true, employeeId: true, profilePhotoUrl: true } });
      if (!admin) throw new ApiError(404, "NOT_FOUND", "User not found.");
      return { id: admin.id, name: admin.name, email: admin.email, role: "SUPER_ADMIN", isHod: false, year: admin.year, employeeId: admin.employeeId, profilePhotoUrl: admin.profilePhotoUrl, university: await getUniversity(universityId) };
    }
    const faculty = await prisma.faculty.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, isHod: true, year: true, employeeId: true, profilePhotoUrl: true } });
    if (!faculty) throw new ApiError(404, "NOT_FOUND", "User not found.");
    return { id: faculty.id, name: faculty.name, email: faculty.email, role: "FACULTY", isHod: faculty.isHod, year: faculty.year, employeeId: faculty.employeeId, profilePhotoUrl: faculty.profilePhotoUrl, university: await getUniversity(universityId) };
  },

  // ── HOD Scope / Dashboard ─────────────────────────────────

  async myScope(scope: Scope) {
    const faculty = await facultyById(scope.userId);
    const activeSemester = await hodActiveSemester(scope.universityId, faculty.year, scope.hodSemesterIds ?? []);
    const allFaculty = await getScopedFaculty(scope);
    const assignedFacultyIds = new Set(
      (await prisma.facultyBatchAssignment.findMany({ where: { batchId: { in: scope.hodBatchIds } }, select: { facultyId: true } })).map((a) => a.facultyId),
    );
    const batches = await Promise.all(
      scope.hodBatchIds.map(async (batchId) => {
        const batch = await batchById(batchId);
        // current students in the batch — isCurrent is the source of truth (survives promotion).
        const studentCount = await prisma.studentEnrollment.count({ where: { batchId, isCurrent: true } });
        return { id: batch.id, code: batch.code, yearLevel: batch.yearLevel, studentCount };
      }),
    );
    // ponytail: onboarding trigger — first login into a new year-start sem (1/3/5/7) with no batches yet.
    const isYearStartSem = activeSemester.number > 0 && activeSemester.number % 2 === 1;
    return {
      hod: { id: faculty.id, name: faculty.name, year: faculty.year, employeeId: faculty.employeeId, sectionTag: sectionTag(faculty.year, batches[0]?.code) },
      activeSemester: { id: activeSemester.id, label: activeSemester.label, number: activeSemester.number },
      batches,
      totalStudents: batches.reduce((s, b) => s + b.studentCount, 0),
      totalFaculty: assignedFacultyIds.size,
      needsOnboarding: isYearStartSem && batches.length === 0,
    };
  },

  // ponytail: HOD chooses initial + branches + count → we create batches, scope them, and mark ready.
  async hodOnboardingComplete(scope: Scope, body: { initial: string; branches: string[]; batchCount: number }) {
    const initial = (body.initial || "").toUpperCase();
    if (!/^[A-Z]$/.test(initial)) throw new ApiError(400, "VALIDATION_ERROR", "initial must be a single A–Z letter.");
    if (!Array.isArray(body.branches) || body.branches.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "Select at least one branch.");
    const count = Math.max(1, Math.min(20, Number(body.batchCount || 1)));
    const faculty = await facultyById(scope.userId);
    const activeSem = await hodActiveSemester(scope.universityId, faculty.year, scope.hodSemesterIds ?? []);
    if (!activeSem.id) throw new ApiError(400, "NO_ACTIVE_SEMESTER", "No active semester.");
    for (const branch of body.branches) {
      await assertBranchAllowed(scope.universityId, branch.toUpperCase());
    }
    const created: { id: string; code: string }[] = [];
    for (let i = 1; i <= count; i++) {
      const code = `${initial}${i}`;
      let batch = await prisma.batch.findFirst({ where: { academicYearId: activeSem.academicYearId, code } });
      if (!batch) {
        batch = await prisma.batch.create({
          data: { universityId: scope.universityId, academicYearId: activeSem.academicYearId, code, yearLevel: activeSem.yearLevel },
        });
      }
      await prisma.hodBatchScope.upsert({
        where: { batchId: batch.id },
        update: { facultyId: scope.userId, semesterId: activeSem.id, academicYearId: activeSem.academicYearId },
        create: { facultyId: scope.userId, batchId: batch.id, semesterId: activeSem.id, academicYearId: activeSem.academicYearId },
      });
      created.push({ id: batch.id, code });
    }
    await this.logActivity(scope.universityId, scope.userId, "BATCH_CREATED", `${faculty.name} onboarded ${created.length} batches`, `Initial ${initial}, branches ${body.branches.join(", ")} in ${activeSem.label}.`);
    return { batches: created, branches: body.branches, initial, semester: activeSem.label };
  },

  // Roster for the onboarding "choose faculty" step: **strictly same year as the HOD**.
  // Also returns `inPool` flag so the UI can preselect already-linked faculty, and `takenByHod`
  // so the HOD sees which faculty are already claimed by a sibling HOD in the same year.
  async hodOnboardingFaculty(scope: Scope) {
    const hod = await facultyById(scope.userId);
    if (!hod.year) throw new ApiError(400, "HOD_YEAR_MISSING", "HOD must have a year level set.");
    const roster = await prisma.faculty.findMany({
      where: {
        universityId: scope.universityId, deletedAt: null, isDean: false, isHod: false,
        NOT: { employeeId: "ADMIN001" },
        year: hod.year,   // strict same-year gate — no cross-year picking
      },
      select: { id: true, name: true, employeeId: true, mentorCode: true, year: true, hodId: true },
      orderBy: { name: "asc" },
    });
    return {
      year: hod.year,
      data: roster.map((f) => ({
        id: f.id, name: f.name, employeeId: f.employeeId, mentorCode: f.mentorCode, year: f.year,
        inPool: f.hodId === scope.userId,
        takenByHod: !!f.hodId && f.hodId !== scope.userId,
      })),
    };
  },

  // Save the HOD's chosen faculty pool. The selection can ONLY include faculty of the same year;
  // faculty already claimed by another HOD are rejected unless explicitly reclaimed.
  async hodSaveFacultyPool(scope: Scope, body: { facultyIds: string[]; reclaim?: boolean }) {
    const hod = await facultyById(scope.userId);
    if (!hod.year) throw new ApiError(400, "HOD_YEAR_MISSING", "HOD must have a year level set.");
    const ids = Array.isArray(body.facultyIds) ? [...new Set(body.facultyIds)] : [];
    if (ids.length === 0) return { pooled: 0, released: 0 };
    const rows = await prisma.faculty.findMany({
      where: { id: { in: ids }, universityId: scope.universityId, isHod: false, isDean: false, deletedAt: null },
      select: { id: true, year: true, hodId: true, name: true },
    });
    // gate: strict same-year
    const wrongYear = rows.filter((f) => f.year !== hod.year);
    if (wrongYear.length > 0) throw new ApiError(400, "CROSS_YEAR_PICK", `Faculty must be ${hod.year}: ${wrongYear.map((f) => f.name).join(", ")}.`);
    // gate: don't steal from another HOD unless caller opts in
    if (!body.reclaim) {
      const claimed = rows.filter((f) => f.hodId && f.hodId !== scope.userId);
      if (claimed.length > 0) throw new ApiError(409, "ALREADY_CLAIMED", `Already in another HOD's pool: ${claimed.map((f) => f.name).join(", ")}.`);
    }
    // release faculty previously in this HOD's pool but not in the new set (to keep pool exact)
    const released = await prisma.faculty.updateMany({
      where: { hodId: scope.userId, id: { notIn: ids } },
      data: { hodId: null },
    });
    await prisma.faculty.updateMany({
      where: { id: { in: ids } },
      data: { hodId: scope.userId },
    });
    return { pooled: ids.length, released: released.count };
  },

  // Read the current pool (used by the HOD Faculty page + Announcements FACULTY_ONLY audience).
  async hodFacultyPool(scope: Scope) {
    const rows = await prisma.faculty.findMany({
      where: { hodId: scope.userId, deletedAt: null },
      select: { id: true, name: true, employeeId: true, mentorCode: true, year: true, isActive: true },
      orderBy: { name: "asc" },
    });
    return { data: rows };
  },

  // Every batch this HOD has ever owned, across all years/semesters (their history record).
  async hodBatchHistory(scope: Scope) {
    const scopes = await prisma.hodBatchScope.findMany({
      where: { facultyId: scope.userId },
      include: { batch: true, semester: { include: { academicYear: { select: { label: true } } } } },
      orderBy: [{ semester: { number: "desc" } }, { batch: { code: "asc" } }],
    });
    const rows = await Promise.all(scopes.map(async (s) => ({
      batchId: s.batch.id, batchCode: s.batch.code, yearLevel: s.batch.yearLevel,
      sectionTag: sectionTag(s.batch.yearLevel, s.batch.code),
      semesterLabel: s.semester.label, semesterNumber: s.semester.number,
      academicYear: s.semester.academicYear.label,
      isActive: s.semester.status === "ACTIVE",
      studentCount: await prisma.studentEnrollment.count({ where: { batchId: s.batch.id, semesterId: s.semester.id } }),
    })));
    return { data: rows };
  },

  // The semesters THIS HOD has data for — every semester that has enrollments in a batch the HOD
  // has ever owned. Powers the sidebar "Semester History" selector. The active one is `isCurrent`.
  async hodHistorySemesters(scope: Scope) {
    const batchIds = await hodAllBatchIds(scope.userId);
    if (batchIds.length === 0) return { data: [], currentSemesterId: null };
    const current = await hodActiveSemester(scope.universityId, (await facultyById(scope.userId)).year, scope.hodSemesterIds ?? []);
    // distinct semesters that hold this HOD's students
    const grouped = await prisma.studentEnrollment.groupBy({
      by: ["semesterId"],
      where: { batchId: { in: batchIds } },
      _count: { _all: true },
    });
    const semesters = await prisma.semester.findMany({
      where: { id: { in: grouped.map((g) => g.semesterId) } },
      include: { academicYear: { select: { label: true } } },
      orderBy: { number: "asc" },
    });
    const countById = new Map(grouped.map((g) => [g.semesterId, g._count._all]));
    return {
      currentSemesterId: current.id || null,
      data: semesters.map((s) => ({
        semesterId: s.id,
        number: s.number,
        label: s.label,
        yearLevel: s.yearLevel,
        academicYear: s.academicYear.label,
        studentCount: countById.get(s.id) ?? 0,
        isCurrent: s.id === current.id,
      })),
    };
  },

  // Reset — wipe THIS HOD's batches + students + timetable + assignments for their owned batches,
  // atomically, so the semester onboarding wizard reappears. Students exclusive to this HOD are
  // hard-deleted (no orphans); students shared with other batches keep their other enrollments.
  async hodResetSemester(scope: Scope) {
    const batchIds = scope.hodBatchIds;
    if (!batchIds.length) return { batchesRemoved: 0, studentsRemoved: 0, message: "Nothing to reset — no batches owned." };
    const enrollments = await prisma.studentEnrollment.findMany({ where: { batchId: { in: batchIds } }, select: { id: true, studentId: true } });
    const enrollmentIds = enrollments.map((e) => e.id);
    const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    // students whose ONLY enrollments are in these batches → safe to remove entirely
    const orphanIds: string[] = [];
    for (const sid of studentIds) {
      const other = await prisma.studentEnrollment.count({ where: { studentId: sid, batchId: { notIn: batchIds } } });
      if (other === 0) orphanIds.push(sid);
    }
    await prisma.$transaction([
      prisma.attendanceRecord.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } }),
      prisma.result.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } }),
      prisma.mentorAssignment.deleteMany({ where: { studentId: { in: studentIds } } }),
      prisma.studentEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } }),
      prisma.facultyBatchAssignment.deleteMany({ where: { batchId: { in: batchIds } } }),
      prisma.timetableSlot.deleteMany({ where: { batchId: { in: batchIds } } }),
      // ponytail: batch-audience targets (notes/quizzes) FK to batch with no cascade — clear them
      // before the batch delete or Postgres raises a foreign-key violation.
      prisma.noteBatchTarget.deleteMany({ where: { batchId: { in: batchIds } } }),
      prisma.quizBatchTarget.deleteMany({ where: { batchId: { in: batchIds } } }),
      prisma.hodBatchScope.deleteMany({ where: { batchId: { in: batchIds } } }),
      // clear orphan students' dependent rows, then the students themselves
      prisma.quizAttempt.deleteMany({ where: { studentId: { in: orphanIds } } }),
      prisma.selfNote.deleteMany({ where: { studentId: { in: orphanIds } } }),
      prisma.announcementRead.deleteMany({ where: { studentId: { in: orphanIds } } }),
      prisma.notification.deleteMany({ where: { studentId: { in: orphanIds } } }),
      prisma.aIConversation.deleteMany({ where: { studentId: { in: orphanIds } } }),
      prisma.refreshToken.deleteMany({ where: { studentId: { in: orphanIds } } }),
      prisma.student.deleteMany({ where: { id: { in: orphanIds } } }),
      prisma.batch.deleteMany({ where: { id: { in: batchIds } } }),
    ]);
    return { batchesRemoved: batchIds.length, studentsRemoved: orphanIds.length };
  },

  // Graduation: mark the HOD's current final-semester students PASS_OUT. Never deletes/archives —
  // it's a status flip, so all history stays accessible and searchable. Optional detain list marks
  // students who haven't cleared as DETAINED instead. Atomic.
  async graduateFinalYear(scope: Scope, opts: { detainEnrollmentNos?: string[] } = {}) {
    const sem = await scopeSemester(scope);
    if (sem.number !== 8) throw new ApiError(400, "NOT_FINAL_SEMESTER", "Graduation is only available at Semester 8.");
    const enrs = await prisma.studentEnrollment.findMany({
      where: { batchId: { in: scope.hodBatchIds }, isCurrent: true },
      include: { student: { select: { id: true, enrollmentNo: true } } },
    });
    const detain = new Set(opts.detainEnrollmentNos ?? []);
    const passIds = enrs.filter((e) => !detain.has(e.student.enrollmentNo)).map((e) => e.student.id);
    const detainIds = enrs.filter((e) => detain.has(e.student.enrollmentNo)).map((e) => e.student.id);
    const [passed, detained] = await prisma.$transaction([
      prisma.student.updateMany({ where: { id: { in: passIds } }, data: { graduationStatus: "PASS_OUT", graduatedAt: new Date() } }),
      prisma.student.updateMany({ where: { id: { in: detainIds } }, data: { graduationStatus: "DETAINED" } }),
    ]);
    return { graduated: passed.count, detained: detained.count, semester: sem.label };
  },

  async dashboardSummary(scope: Scope) {
    const enrollments = await scopedCurrentEnrollments(scope);
    const allFaculty = await getScopedFaculty(scope);
    const activeSemester = await scopeSemester(scope);
    const attendancePcts = await overallAttendancePctBulkArr(enrollments);
    const avgAttendance = average(attendancePcts);
    const results = await prisma.result.findMany({ where: { enrollment: { batchId: { in: scope.hodBatchIds }, isCurrent: true } } });
    const published = results.filter((r) => r.isPublished).length;
    return {
      totalStudents: { value: enrollments.length, deltaLabel: `${enrollments.length} current enrollments`, trend: "neutral" },
      totalFaculty: { value: allFaculty.length, deltaLabel: `${allFaculty.length} visible faculty`, trend: "neutral" },
      activeBatches: { value: scope.hodBatchIds.length, deltaLabel: scope.hodBatchIds.length === 0 ? "No batches assigned" : `${scope.hodBatchIds.length} assigned batches`, trend: "neutral" },
      avgAttendance: { value: avgAttendance, deltaLabel: enrollments.length === 0 ? "No attendance data" : "Current average", trend: "neutral" },
      resultsUploadedPct: { value: results.length === 0 ? 0 : Math.round((published / results.length) * 100), deltaLabel: results.length === 0 ? "No results uploaded" : `${published}/${results.length} published`, trend: "neutral" },
    };
  },

  async dashboardAttendanceTrend(scope: Scope, months = 6) {
    const labels = monthLabels(months);
    const enrollments = await scopedCurrentEnrollments(scope);
    const ids = enrollments.map((e) => e.id);
    // Real per-month attendance from lectureDate (was a flat line repeating the overall avg).
    const now = new Date();
    const data = await Promise.all(
      Array.from({ length: months }, async (_v, i) => {
        if (ids.length === 0) return null;
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - i - 1), 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - i - 1) + 1, 1));
        const [total, present] = await Promise.all([
          prisma.attendanceRecord.count({ where: { enrollmentId: { in: ids }, lectureDate: { gte: start, lt: end } } }),
          prisma.attendanceRecord.count({ where: { enrollmentId: { in: ids }, lectureDate: { gte: start, lt: end }, isPresent: true } }),
        ]);
        return total === 0 ? null : Number(((present / total) * 100).toFixed(1));
      }),
    );
    return { labels, series: [{ label: "Overall", data }] };
  },

  async dashboardAtRisk(scope: Scope) {
    const rules = await getAttendanceRules(scope.universityId);
    const enrollments = await scopedCurrentEnrollments(scope);
    const rows = await Promise.all(
      enrollments.map(async (e) => {
        const student = await prisma.student.findUnique({ where: { id: e.studentId } });
        const attendancePct = await computeOverallAttendancePct(e.id);
        const results = await prisma.result.findMany({ where: { enrollmentId: e.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
        const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
        const mentor = await getMentorAssignment(e.studentId, e.semesterId);
        const mentorFaculty = mentor ? await facultyById(mentor.facultyId) : null;
        const batch = await batchById(e.batchId);
        const riskFactor = attendancePct < rules.minThresholdPct && avgMarksPct < 40 ? "BOTH" : attendancePct < rules.minThresholdPct ? "ATTENDANCE" : "MARKS";
        return {
          enrollmentNo: student?.enrollmentNo ?? "",
          name: student?.name ?? "",
          batchCode: batch.code,
          attendancePct,
          avgMarksPct,
          riskFactor,
          mentorCode: mentorFaculty?.mentorCode ?? null,
          isAtRisk: attendancePct < rules.minThresholdPct || avgMarksPct < 40,
        };
      }),
    );
    return { data: rows.filter((r) => r.isAtRisk).map(({ isAtRisk: _, ...rest }) => rest) };
  },

  async dashboardRecentActivity(scope: Scope, limit = 10) {
    const logs = await prisma.activityLog.findMany({
      where: { universityId: scope.universityId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { data: logs.map((l) => ({ id: l.id, type: l.type, title: l.title, description: l.description, createdAt: l.createdAt })) };
  },

  // ponytail: routes call these two — either they were never written or got renamed.
  // Both return empty-safe payloads matching API.md so the frontend renders.
  async dashboardResultsOverview(scope: Scope, semesterId?: string) {
    const semester = semesterId
      ? await prisma.semester.findUnique({ where: { id: semesterId } })
      : await prisma.semester.findFirst({ where: { universityId: scope.universityId, status: "ACTIVE" } });
    if (!semester) return { phases: [] };
    const phases = await prisma.phase.findMany({ where: { semesterId: semester.id }, orderBy: { number: "asc" } });
    const rows = await Promise.all(
      phases.map(async (p) => {
        const results = await prisma.result.findMany({
          where: { phaseId: p.id, enrollment: { batchId: { in: scope.hodBatchIds }, isCurrent: true }, isPublished: true },
          select: { marksObtained: true, maxMarks: true },
        });
        const avg = results.length === 0 ? null : Math.round(average(results.map((r) => (r.marksObtained / r.maxMarks) * 100)));
        return { phase: p.label, avgMarksPct: avg, status: p.isComplete ? "complete" : "pending" };
      }),
    );
    return { phases: rows };
  },

  async dashboardActivityFeed(scope: Scope, page = 1, limit = 10) {
    const total = await prisma.activityLog.count({ where: { universityId: scope.universityId } });
    const logs = await prisma.activityLog.findMany({
      where: { universityId: scope.universityId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: logs.map((l) => ({ id: l.id, type: l.type, title: l.title, description: l.description, createdAt: l.createdAt })),
      ...buildPagination(page, limit, total),
    };
  },

  // ── Student list / management ─────────────────────────────

  async listStudents(scope: Scope, query: Record<string, string | number | undefined>) {
    // ponytail: current view → whoever is isCurrent in the HOD's active-year batches.
    // Historical view (query.semesterId set) → the students this HOD MANAGED in that semester:
    // enrollments at that semester in ANY batch the HOD has ever owned. This is how an SY HOD
    // still sees a student's Sem-4 data after the student moved to Sem-5 under a different HOD.
    const historySemesterId = query.semesterId as string | undefined;
    const enrollments = await prisma.studentEnrollment.findMany({
      where: historySemesterId
        ? {
            semesterId: historySemesterId,
            batchId: query.batchId ? (query.batchId as string) : { in: await hodAllBatchIds(scope.userId) },
            ...(query.branch ? { student: { branch: query.branch as string } } : {}),
          }
        : {
            isCurrent: true,
            batchId: query.batchId ? (query.batchId as string) : { in: scope.hodBatchIds },
            ...(query.branch ? { student: { branch: query.branch as string } } : {}),
          },
      include: { student: true, batch: true },
    });
    const rules = await getAttendanceRules(scope.universityId);
    const rows = await Promise.all(
      enrollments.map(async (e) => {
        const attendancePct = await computeOverallAttendancePct(e.id);
        const results = await prisma.result.findMany({ where: { enrollmentId: e.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
        const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
        const status = !e.student.isActive ? "INACTIVE" : attendancePct < rules.minThresholdPct || avgMarksPct < 40 ? "AT_RISK" : "ACTIVE";
        return {
          enrollmentNo: e.student.enrollmentNo,
          name: e.student.name,
          branch: e.student.branch,
          batchCode: e.batch.code,
          rollNo: e.rollNo,
          yearLevel: e.yearLevel,
          attendancePct,
          avgMarksPct,
          status,
          graduationStatus: (e.student as any).graduationStatus ?? "ACTIVE",
        };
      }),
    );
    const search = query.search as string | undefined;
    const filtered = rows
      .filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.enrollmentNo.includes(search))
      .filter((r) => !query.batchId || true) // batchId already filtered in DB
      .filter((r) => !query.status || r.status === query.status)
      .filter((r) => !query.graduationStatus || r.graduationStatus === query.graduationStatus);
    return paginate(filtered, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async getStudentByEnrollmentNo(enrollmentNo: string, scope: Scope) {
    const student = await studentByEnrollmentNo(enrollmentNo);
    const enrollment = await currentEnrollmentForStudent(student.id);
    if (!enrollment || !scope.hodBatchIds.includes(enrollment.batchId)) {
      throw new ApiError(403, "STUDENT_NOT_IN_SCOPE", "Student is not in your scope.");
    }
    const batch = await batchById(enrollment.batchId);
    const semester = await getSemester(enrollment.semesterId);
    return { enrollmentNo: student.enrollmentNo, name: student.name, branch: student.branch, batchCode: batch.code, rollNo: enrollment.rollNo, semesterLabel: semester.label, yearLevel: enrollment.yearLevel };
  },

  // CSV columns: enrollment_no, name, branch, batch, roll_no.
  // Batch is per-row (batch code). email + admission_year are derived — not in the sheet.
  // ponytail: hodId (optional) → any batch code not yet in this year gets auto-created and scoped to this HOD.
  // ponytail: validate-then-transact. Every row is checked first; if ANY row is invalid the whole
  // upload is rejected (nothing written). Valid uploads run in ONE transaction so students, batches,
  // HOD ownership and enrollments all land together or not at all — no partial/orphan state.
  async uploadStudentCsv(fileBuffer: Buffer | undefined, universityId: string, semesterId: string, hodId?: string) {
    if (!fileBuffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    const rows = parseCsvRecords(fileBuffer, ["enrollment_no", "name", "branch", "batch", "roll_no"]);
    const semester = await getSemester(semesterId);
    const hod = hodId ? await prisma.faculty.findFirst({ where: { id: hodId, universityId, isHod: true, deletedAt: null } }) : null;
    const autoYearLevel = (hod?.year || (semester as any).yearLevel || "FY") as any;
    const allowedBranches = new Set((await prisma.universityBranch.findMany({ where: { universityId }, select: { code: true } })).map((b) => b.code.toUpperCase()));

    // ── Phase 1: validate every row (no writes) ──
    type Clean = { row: number; enrollmentNo: string; name: string; branch: string; batchCode: string; rollNo: string };
    const clean: Clean[] = [];
    const errors: Array<{ row: number; enrollmentNo: string; reason: string }> = [];
    const seen = new Set<string>();
    for (const { row, record } of rows) {
      const enrollmentNo = String(record.enrollment_no ?? "").trim();
      const name = String(record.name ?? record.student ?? "").trim();
      const branch = String(record.branch ?? "").trim().toUpperCase();
      const batchCode = String(record.batch ?? "").trim().toUpperCase();
      const rollNo = String(record.roll_no ?? "").trim();
      if (!enrollmentNo || !name || !branch || !batchCode || !rollNo) {
        errors.push({ row, enrollmentNo, reason: "Missing one of: enrollment_no, name, branch, batch, roll_no." }); continue;
      }
      if (seen.has(enrollmentNo)) { errors.push({ row, enrollmentNo, reason: "Duplicate enrollment_no within this CSV." }); continue; }
      seen.add(enrollmentNo);
      if (!allowedBranches.has(branch)) { errors.push({ row, enrollmentNo, reason: `Branch "${branch}" is not configured. Ask the Dean to add it.` }); continue; }
      clean.push({ row, enrollmentNo, name, branch, batchCode, rollNo });
    }
    // Reject the whole file if anything is wrong — no partial imports.
    if (errors.length > 0) {
      return { created: 0, updated: 0, batchesCreated: 0, errors, totalRows: rows.length, aborted: true };
    }

    // ── Phase 2: pre-fetch everything in bulk (OUTSIDE the tx), then write with few queries ──
    // The old per-row lookups made the transaction O(rows) round-trips and blew the 5s timeout on
    // large uploads. Now the tx does a handful of bulk writes regardless of CSV size.
    const enrNos = clean.map((r) => r.enrollmentNo);
    const existingStudents = await prisma.student.findMany({ where: { enrollmentNo: { in: enrNos } } });
    const existingByEnr = new Map(existingStudents.map((s) => [s.enrollmentNo, s]));
    const studentIdByEnr = new Map(existingStudents.map((s) => [s.enrollmentNo, s.id]));
    const preExisting = new Set(existingStudents.map((s) => s.enrollmentNo));
    const existingIds = existingStudents.map((s) => s.id);

    // prior + same-semester enrollments for existing students (one query)
    const allEnrs = existingIds.length
      ? await prisma.studentEnrollment.findMany({ where: { studentId: { in: existingIds } }, include: { semester: { select: { number: true } } } })
      : [];
    const priorMostRecent = new Map<string, { id: string; num: number }>(); // studentId → most-recent prior enrollment
    const sameSem = new Map<string, { id: string; promotedFromId: string | null; batchId: string; rollNo: string; isCurrent: boolean }>(); // studentId → enrollment at THIS semester
    const hasPriorCurrent = new Set<string>();
    for (const e of allEnrs) {
      if (e.semesterId === semesterId) { sameSem.set(e.studentId, { id: e.id, promotedFromId: e.promotedFromId, batchId: e.batchId, rollNo: e.rollNo, isCurrent: e.isCurrent }); continue; }
      if (e.isCurrent) hasPriorCurrent.add(e.studentId);
      const cur = priorMostRecent.get(e.studentId);
      if (!cur || e.semester.number > cur.num) priorMostRecent.set(e.studentId, { id: e.id, num: e.semester.number });
    }

    const yearBatches = await prisma.batch.findMany({ where: { academicYearId: semester.academicYearId } });
    const batchByCode = new Map(yearBatches.map((b) => [b.code.toUpperCase(), b]));
    const missingCodes = [...new Set(clean.map((r) => r.batchCode))].filter((c) => !batchByCode.has(c));

    const result = await prisma.$transaction(async (tx) => {
      let batchesCreated = 0;
      // 1. create missing batches (few — distinct codes) + HOD scope
      for (const code of missingCodes) {
        const b = await tx.batch.create({ data: { universityId, academicYearId: semester.academicYearId, code, yearLevel: autoYearLevel } });
        batchByCode.set(code, b);
        batchesCreated += 1;
        if (hod) {
          await tx.hodBatchScope.upsert({
            where: { batchId: b.id },
            update: { facultyId: hod.id, semesterId, academicYearId: semester.academicYearId },
            create: { facultyId: hod.id, batchId: b.id, semesterId, academicYearId: semester.academicYearId },
          });
        }
      }
      // 2. bulk-insert NEW students, then fetch their ids in one query
      const newRows = clean.filter((r) => !preExisting.has(r.enrollmentNo));
      if (newRows.length) {
        await tx.student.createMany({
          data: newRows.map((r) => {
            const yr2 = r.enrollmentNo.slice(0, 2);
            const admissionYear = /^\d{2}$/.test(yr2) ? 2000 + Number(yr2) : new Date().getFullYear();
            return { universityId, enrollmentNo: r.enrollmentNo, name: r.name, branch: r.branch, admissionYear, email: `${r.enrollmentNo.toLowerCase()}@lju.edu.in`, passwordHash: `${r.enrollmentNo}@123`, isActive: true };
          }),
          skipDuplicates: true,
        });
        const created = await tx.student.findMany({ where: { enrollmentNo: { in: newRows.map((r) => r.enrollmentNo) } }, select: { id: true, enrollmentNo: true } });
        for (const s of created) studentIdByEnr.set(s.enrollmentNo, s.id);
      }
      // 3. reactivate/update pre-existing students — skip no-op rows so a plain re-upload is near-instant.
      for (const r of clean) {
        if (!preExisting.has(r.enrollmentNo)) continue;
        const s = existingByEnr.get(r.enrollmentNo)!;
        if (s.name === r.name && s.branch === r.branch && !s.deletedAt && s.isActive) continue;
        await tx.student.update({ where: { id: s.id }, data: { name: r.name, branch: r.branch, deletedAt: null, isActive: true } });
      }
      // 4. one query to archive any prior current enrollment (only one current per student)
      if (hasPriorCurrent.size) {
        await tx.studentEnrollment.updateMany({ where: { studentId: { in: [...hasPriorCurrent] }, isCurrent: true, semesterId: { not: semesterId } }, data: { isCurrent: false } });
      }
      // 5. enrollments — update ones that already exist at this semester, bulk-create the rest
      let updated = 0;
      const toCreate: Array<{ studentId: string; semesterId: string; batchId: string; rollNo: string; yearLevel: any; isCurrent: boolean; promotedFromId: string | null }> = [];
      for (const r of clean) {
        const sid = studentIdByEnr.get(r.enrollmentNo)!;
        const batch = batchByCode.get(r.batchCode)!;
        const prior = priorMostRecent.get(sid);
        const same = sameSem.get(sid);
        if (same) {
          updated += 1;
          // skip the write when nothing changed (idempotent re-upload)
          const nextPromoted = same.promotedFromId ?? prior?.id ?? null;
          if (same.batchId !== batch.id || same.rollNo !== r.rollNo || !same.isCurrent || same.promotedFromId !== nextPromoted) {
            await tx.studentEnrollment.update({ where: { id: same.id }, data: { batchId: batch.id, rollNo: r.rollNo, yearLevel: batch.yearLevel, isCurrent: true, promotedFromId: nextPromoted } });
          }
        } else {
          toCreate.push({ studentId: sid, semesterId, batchId: batch.id, rollNo: r.rollNo, yearLevel: batch.yearLevel, isCurrent: true, promotedFromId: prior?.id ?? null });
        }
      }
      if (toCreate.length) await tx.studentEnrollment.createMany({ data: toCreate });
      return { created: toCreate.length, updated, batchesCreated };
    }, { timeout: 60000, maxWait: 20000 });
    return { ...result, errors: [], totalRows: rows.length, aborted: false };
  },

  // ── Faculty list / management ─────────────────────────────

  async listFaculty(scope: Scope, query: Record<string, string | number | undefined>) {
    const semester = await scopeSemester(scope);
    // ponytail: HOD-year-strict — filter by the HOD's own `year` label; drop any faculty in other years.
    const hod = await prisma.faculty.findFirst({ where: { id: scope.userId }, select: { year: true } });
    const hodYear = hod?.year || null;
    // ponytail: pool-first — if the HOD has claimed a pool, show only that pool.
    // Fall back to year-strict for HODs who haven't set a pool yet.
    const poolCount = await prisma.faculty.count({ where: { hodId: scope.userId, deletedAt: null } });
    const faculties = await prisma.faculty.findMany({
      where: {
        universityId: scope.universityId, deletedAt: null, isDean: false, NOT: { employeeId: "ADMIN001" },
        ...(poolCount > 0 ? { hodId: scope.userId } : hodYear ? { year: hodYear } : {}),
      },
    });
    const rows = await Promise.all(
      faculties.map(async (f) => {
        const assignments = await prisma.facultyBatchAssignment.findMany({ where: { facultyId: f.id, semesterId: semester.id }, select: { batchId: true, subjectId: true, batch: { select: { yearLevel: true } } } });
        const menteeCount = await prisma.mentorAssignment.count({ where: { facultyId: f.id, semesterId: semester.id } });
        // the year level(s) this faculty teaches this semester (usually one)
        const yearLevels = [...new Set(assignments.map((a) => a.batch.yearLevel))];
        return {
          id: f.id,
          employeeId: f.employeeId,
          name: f.name,
          email: f.email,
          year: f.year,
          yearLevel: yearLevels[0] ?? null,
          yearLevels,
          isHod: f.isHod,
          mentorCode: f.mentorCode,
          isActive: f.isActive,
          assignedBatches: [...new Set(assignments.map((a) => a.batchId))].length,
          assignedSubjects: [...new Set(assignments.map((a) => a.subjectId).filter(Boolean))].length,
          menteeCount,
        };
      }),
    );
    const search = query.search as string | undefined;
    const filtered = rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.employeeId.includes(search));
    return paginate(filtered, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async getFacultyProfile(facultyId: string) {
    const f = await facultyById(facultyId);
    return { id: f.id, employeeId: f.employeeId, name: f.name, email: f.email, phone: f.phone, year: f.year, isHod: f.isHod, mentorCode: f.mentorCode, isActive: f.isActive, profilePhotoUrl: f.profilePhotoUrl };
  },

  async uploadFacultyCsv(fileBuffer: Buffer | undefined, universityId: string) {
    if (!fileBuffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    const rows = parseCsvRecords(fileBuffer, ["employee_id", "name", "email", "year"]);
    let created = 0;
    const errors: Array<{ row: number; employeeId: string; reason: string }> = [];
    for (const { row, record } of rows) {
      const employeeId = String(record.employee_id ?? "");
      try {
        const existing = await prisma.faculty.findFirst({ where: { OR: [{ employeeId }, { email: String(record.email ?? "") }] } });
        if (!existing) {
          await prisma.faculty.create({
            data: { universityId, employeeId, name: String(record.name ?? ""), email: String(record.email ?? ""), year: String(record.year ?? ""), isHod: false, isActive: true, passwordHash: `${employeeId}@123` },
          });
          created += 1;
        } else {
          errors.push({ row, employeeId, reason: "Faculty already exists." });
        }
      } catch {
        errors.push({ row, employeeId, reason: "Failed to create faculty." });
      }
    }
    return { created, errors, totalRows: rows.length };
  },

  async deactivateFaculty(facultyId: string) {
    const f = await facultyById(facultyId);
    if (f.isHod) throw new ApiError(403, "CANNOT_DEACTIVATE_HOD", "Cannot deactivate an HOD.");
    await prisma.faculty.update({ where: { id: facultyId }, data: { isActive: false } });
    return { id: facultyId, isActive: false };
  },

  async assignFacultyBatch(facultyId: string, subjectId: string, batchId: string, semesterId: string) {
    await facultyById(facultyId);
    const existing = await prisma.facultyBatchAssignment.findFirst({ where: { facultyId, batchId, subjectId, semesterId } });
    if (existing) throw new ApiError(409, "ALREADY_ASSIGNED", "Faculty already assigned to this batch/subject.");
    const assignment = await prisma.facultyBatchAssignment.create({ data: { facultyId, batchId, subjectId, semesterId } });
    return { id: assignment.id, facultyId, subjectId, batchId, semesterId };
  },

  // ── Results ───────────────────────────────────────────────

  async listResults(scope: Scope, query: Record<string, string | number | undefined>) {
    const enrollmentWhere = await hodEnrollmentWhere(scope, query.semesterId as string | undefined, query.batchId as string | undefined);
    const where = {
      enrollment: enrollmentWhere,
      ...(query.phaseId ? { phaseId: query.phaseId as string } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId as string } : {}),
    };
    const results = await prisma.result.findMany({ where, include: { enrollment: { include: { student: true, batch: true } }, phase: true, subject: true } });
    const rows = results.map((r) => ({
      enrollmentNo: r.enrollment.student.enrollmentNo,
      studentName: r.enrollment.student.name,
      batchCode: r.enrollment.batch.code,
      phaseLabel: r.phase.label,
      subjectCode: r.subject.code,
      marksObtained: r.marksObtained,
      maxMarks: r.maxMarks,
      grade: r.grade,
      isPublished: r.isPublished,
      publishedAt: r.publishedAt,
    }));
    return paginate(rows, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async uploadResults(
    scope: Scope,
    batchId: string,
    phaseId: string,
    subjectId: string,
    results: Array<{ enrollmentId: string; marksObtained: number; maxMarks?: number }>,
    uploadedById: string,
  ) {
    ensureBatchInScope(batchId, scope);
    let uploaded = 0;
    for (const r of results) {
      const pct = (r.marksObtained / (r.maxMarks ?? 100)) * 100;
      await prisma.result.upsert({
        where: { enrollmentId_phaseId_subjectId: { enrollmentId: r.enrollmentId, phaseId, subjectId } },
        update: { marksObtained: r.marksObtained, maxMarks: r.maxMarks ?? 100, grade: gradeFromPct(pct), updatedAt: new Date() },
        create: { enrollmentId: r.enrollmentId, phaseId, subjectId, marksObtained: r.marksObtained, maxMarks: r.maxMarks ?? 100, grade: gradeFromPct(pct), isPublished: false, uploadedById },
      });
      uploaded += 1;
    }
    return { uploaded, phaseId, subjectId };
  },

  async uploadResultsCsv(fileBuffer: Buffer | undefined, scope: Scope, phaseId: string, subjectId: string, batchId: string, uploadedById: string) {
    if (!fileBuffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    await ensureBatchInScope(batchId, scope);
    const rows = parseCsvRecords(fileBuffer, ["enrollment_no", "marks_obtained"]);
    let uploaded = 0;
    const errors: Array<{ row: number; enrollmentNo: string; reason: string }> = [];
    for (const { row, record } of rows) {
      const enrollmentNo = String(record.enrollment_no ?? "");
      try {
        const student = await prisma.student.findFirst({ where: { enrollmentNo } });
        if (!student) { errors.push({ row, enrollmentNo, reason: "Student not found" }); continue; }
        const enrollment = await currentEnrollmentForStudent(student.id);
        if (!enrollment) { errors.push({ row, enrollmentNo, reason: "No active enrollment" }); continue; }
        const marksObtained = Number(record.marks_obtained);
        const maxMarks = Number(record.max_marks ?? 100);
        const pct = (marksObtained / maxMarks) * 100;
        await prisma.result.upsert({
          where: { enrollmentId_phaseId_subjectId: { enrollmentId: enrollment.id, phaseId, subjectId } },
          update: { marksObtained, maxMarks, grade: gradeFromPct(pct), updatedAt: new Date() },
          create: { enrollmentId: enrollment.id, phaseId, subjectId, marksObtained, maxMarks, grade: gradeFromPct(pct), isPublished: false, uploadedById },
        });
        uploaded += 1;
      } catch {
        errors.push({ row, enrollmentNo, reason: "Upload failed." });
      }
    }
    return { uploaded, errors };
  },

  async publishResults(phaseId: string, subjectId: string, batchId: string, scope: Scope) {
    await ensureBatchInScope(batchId, scope);
    const enrollments = await prisma.studentEnrollment.findMany({ where: { batchId, isCurrent: true }, select: { id: true } });
    const ids = enrollments.map((e) => e.id);
    const { count } = await prisma.result.updateMany({
      where: { enrollmentId: { in: ids }, phaseId, subjectId, isPublished: false },
      data: { isPublished: true, publishedAt: new Date() },
    });
    return { published: count, phaseId, subjectId };
  },

  async resultsSummary(scope: Scope, semesterId?: string) {
    const semester = await scopeSemester(scope, semesterId);
    const enrollmentWhere = await hodEnrollmentWhere(scope, semesterId);
    const phases = await prisma.phase.findMany({ where: { semesterId: semester.id }, orderBy: { number: "asc" } });
    const subjects = await subjectsBySemester(semester.id);
    const summary = await Promise.all(
      phases.map(async (phase) => ({
        phaseLabel: phase.label,
        phaseNumber: phase.number,
        isComplete: phase.isComplete,
        subjects: await Promise.all(
          subjects.map(async (subject) => {
            const results = await prisma.result.findMany({ where: { phaseId: phase.id, subjectId: subject.id, enrollment: enrollmentWhere } });
            return {
              subjectCode: subject.code,
              uploadedCount: results.length,
              publishedCount: results.filter((r) => r.isPublished).length,
              avgMarksPct: results.length === 0 ? null : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100)),
            };
          }),
        ),
      })),
    );
    return { semesterLabel: semester.label, summary };
  },

  // ── Batches ───────────────────────────────────────────────

  async listBatches(scope: Scope, semesterId?: string) {
    const semester = await scopeSemester(scope, semesterId);
    const batches = await prisma.batch.findMany({
      where: { id: { in: scope.hodBatchIds } },
      include: { hodScope: true },
    });
    const result = await Promise.all(
      batches.map(async (b) => {
        const studentCount = await prisma.studentEnrollment.count({ where: { batchId: b.id, semesterId: semester.id, isCurrent: true } });
        const facultyCount = await prisma.facultyBatchAssignment.count({ where: { batchId: b.id, semesterId: semester.id } });
        return { id: b.id, code: b.code, yearLevel: b.yearLevel, studentCount, facultyCount };
      }),
    );
    return { data: result };
  },

  async createBatch(universityId: string, academicYearId: string, code: string, yearLevel: YearLevel) {
    const existing = await prisma.batch.findFirst({ where: { academicYearId, code } });
    if (existing) throw new ApiError(409, "BATCH_CODE_EXISTS", "Batch code already exists in this academic year.");
    const batch = await prisma.batch.create({ data: { universityId, academicYearId, code, yearLevel } });
    return { id: batch.id, code: batch.code, yearLevel: batch.yearLevel };
  },

  async getBatch(batchId: string) {
    return batchById(batchId);
  },

  // ── Subjects ──────────────────────────────────────────────

  async listSubjects(scope: Scope, semesterId?: string, search?: string, type?: string) {
    const semester = await scopeSemester(scope, semesterId);
    const subjects = await prisma.subject.findMany({
      where: {
        universityId: scope.universityId, semesterNumber: semester.number,
        deletedAt: null,
        ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }] } : {}),
        ...(type ? { type: type as any } : {}),
      },
    });
    const facultyBySubject = await subjectFacultyMap(semester.id);
    const data = await Promise.all(
      subjects.map(async (subject) => {
        const assignments = await prisma.facultyBatchAssignment.findMany({
          where: { subjectId: subject.id, semesterId: semester.id },
          include: { batch: { select: { id: true, code: true } }, faculty: { select: { id: true, name: true } } },
          orderBy: [{ faculty: { name: "asc" } }, { batch: { code: "asc" } }],
        });
        const teachingFaculty = facultyBySubject.get(subject.id) ?? [];
        const pyqCount = await prisma.pYQFile.count({ where: { subjectId: subject.id } });
        return {
          id: subject.id,
          code: subject.code,
          name: subject.name,
          credits: subject.credits,
          type: subject.type,
          assignedFaculty: teachingFaculty[0] ? { id: teachingFaculty[0].id, name: teachingFaculty[0].name } : null,
          faculty: teachingFaculty.map((f) => ({ id: f.id, name: f.name })),
          // full many-to-many: one row per (faculty, batch) this subject is taught in
          assignments: assignments.map((a) => ({ id: a.id, facultyId: a.faculty.id, facultyName: a.faculty.name, batchId: a.batch.id, batchCode: a.batch.code })),
          batches: [...new Set(assignments.map((a) => a.batch.code))],
          pyqUploaded: pyqCount > 0,
        };
      }),
    );
    return {
      data,
      summary: { totalSubjects: data.length, totalCredits: data.reduce((s, d) => s + d.credits, 0), assignedCount: data.filter((d) => d.assignedFaculty).length, unassignedCount: data.filter((d) => !d.assignedFaculty).length },
    };
  },

  async getSubject(subjectId: string) {
    return subjectById(subjectId);
  },

  // Global catalog: one subject per (university, semesterNumber, code). Added once, used everywhere.
  async createSubject(body: { semesterNumber?: number; universityId: string; code: string; name: string; credits: number; type: string; branch?: string }) {
    const semesterNumber = Number(body.semesterNumber);
    if (!semesterNumber || semesterNumber < 1 || semesterNumber > 8) throw new ApiError(400, "VALIDATION_ERROR", "semesterNumber (1–8) is required.");
    const code = body.code.trim().toUpperCase();
    const existing = await prisma.subject.findFirst({ where: { universityId: body.universityId, semesterNumber, code, deletedAt: null } });
    if (existing) throw new ApiError(409, "SUBJECT_CODE_EXISTS", "Subject code already exists in this semester.");
    if (body.branch) await assertBranchAllowed(body.universityId, body.branch);
    const subject = await prisma.subject.create({
      data: { universityId: body.universityId, semesterNumber, code, name: body.name, credits: body.credits, type: body.type as any, branch: body.branch ?? null },
    });
    return { id: subject.id, code: subject.code, name: subject.name };
  },

  // On change: if the subject has dependent data, soft-delete the old row and create a new one
  // (so past results/attendance keep pointing at the original). Otherwise edit in place.
  async updateSubject(subjectId: string, body: { code?: string; name?: string; credits?: number; type?: string; branch?: string | null }) {
    const cur = await subjectById(subjectId);
    const hasData = (await prisma.result.count({ where: { subjectId } })) > 0 || (await prisma.attendanceRecord.count({ where: { subjectId } })) > 0;
    const next = {
      code: (body.code ?? cur.code).trim().toUpperCase(),
      name: body.name ?? cur.name,
      credits: body.credits ?? cur.credits,
      type: (body.type as any) ?? cur.type,
      branch: body.branch === undefined ? cur.branch : body.branch,
    };
    if (hasData) {
      await prisma.subject.update({ where: { id: subjectId }, data: { deletedAt: new Date() } });
      const created = await prisma.subject.create({ data: { universityId: cur.universityId, semesterNumber: cur.semesterNumber, ...next } });
      return created;
    }
    return prisma.subject.update({ where: { id: subjectId }, data: next });
  },

  // ── Dean subjects (global catalog by semester number) ──
  async uniSubjectList(universityId: string, opts: { semesterNumber?: number; branch?: string }) {
    const subjects = await prisma.subject.findMany({
      where: {
        universityId, deletedAt: null,
        ...(opts.semesterNumber ? { semesterNumber: Number(opts.semesterNumber) } : {}),
        ...(opts.branch ? { branch: opts.branch } : {}),
      },
      orderBy: [{ semesterNumber: "asc" }, { code: "asc" }],
    });
    return {
      data: subjects.map((s) => ({
        id: s.id, code: s.code, name: s.name, credits: s.credits, type: s.type, branch: s.branch,
        semesterNumber: s.semesterNumber,
      })),
    };
  },

  uniSubjectsCsvTemplate() {
    return "semester_number,branch,code,name,credits,type\n3,IT,TOC,Theory of Computation,4,THEORY\n";
  },

  async uniUploadSubjectsCsv(universityId: string, buffer: Buffer | undefined) {
    if (!buffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    const rows = parseCsvRecords(buffer, ["semester_number", "code", "name"]);
    let created = 0, updated = 0;
    const errors: { row: number; enrollmentNo: string; reason: string }[] = [];
    const conflicts: { row: number; enrollmentNo: string; reason: string }[] = [];
    const seen = new Set<string>();
    for (const { row, record } of rows) {
      const ref = `${record.code}/S${record.semester_number}`;
      try {
        const semNum = Number(record.semester_number);
        const branch = String(record.branch ?? "").trim().toUpperCase() || null;
        const code = String(record.code ?? "").trim().toUpperCase();
        const name = String(record.name ?? "").trim();
        const credits = Number(record.credits ?? 4) || 4;
        const type = String(record.type ?? "THEORY").trim().toUpperCase();
        if (!semNum || semNum < 1 || semNum > 8 || !code || !name) { errors.push({ row, enrollmentNo: ref, reason: "semester_number (1–8), code and name are required." }); continue; }
        // In-file duplicate: same code+semester appears twice in THIS upload — flag the later row.
        const key = `${code}|${semNum}`;
        if (seen.has(key)) { conflicts.push({ row, enrollmentNo: ref, reason: "Duplicate code/semester within the file." }); continue; }
        seen.add(key);
        if (branch) await assertBranchAllowed(universityId, branch);
        const existing = await prisma.subject.findFirst({ where: { universityId, semesterNumber: semNum, code, deletedAt: null } });
        if (existing) {
          await prisma.subject.update({ where: { id: existing.id }, data: { name, credits, type: type as any, branch } });
          updated++;
        } else {
          await prisma.subject.create({ data: { universityId, semesterNumber: semNum, code, name, credits, type: type as any, branch } });
          created++;
        }
      } catch (e) {
        errors.push({ row, enrollmentNo: ref, reason: e instanceof ApiError ? e.message : "Failed to import row." });
      }
    }
    return { totalRows: rows.length, created, updated, skipped: errors.length + conflicts.length, conflicts, errors, warnings: [] as string[] };
  },

  async deleteSubject(subjectId: string) {
    // ponytail: always soft-delete — old row is retained so past results/attendance stay consistent.
    await prisma.subject.update({ where: { id: subjectId }, data: { deletedAt: new Date() } });
  },

  // ── Configuration-driven assessment: subject components + weightages ──

  // Available component types. `key` is free-form so HODs can add custom components too.
  subjectComponentCatalog() {
    return [
      { key: "THEORY", label: "Theory" },
      { key: "IPE", label: "Internal Practical Exam" },
      { key: "GP", label: "Group Project" },
      { key: "ASSIGNMENT", label: "Assignment" },
      { key: "QUIZ", label: "Quiz" },
      { key: "VIVA", label: "Viva" },
      { key: "LAB", label: "Lab Work" },
      { key: "PRESENTATION", label: "Presentation" },
      { key: "ATTENDANCE", label: "Attendance" },
    ];
  },

  async getSubjectConfig(subjectId: string) {
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    if (!subject) throw new ApiError(404, "SUBJECT_NOT_FOUND", "Subject not found.");
    const totalWeightage = subject.components.filter((c) => c.isEnabled).reduce((a, c) => a + c.weightagePct, 0);
    return {
      id: subject.id, code: subject.code, name: subject.name, semesterNumber: subject.semesterNumber,
      credits: subject.credits, type: subject.type, branch: subject.branch,
      totalMarks: subject.totalMarks, passingMarks: subject.passingMarks, theoryRule: subject.theoryRule, isActive: subject.isActive,
      components: subject.components.map((c) => ({
        key: c.key, label: c.label, weightagePct: c.weightagePct, isEnabled: c.isEnabled,
        // derived — never stored: the actual marks this component contributes.
        marks: Math.round((c.weightagePct / 100) * subject.totalMarks * 100) / 100,
      })),
      totalWeightage,
      catalog: this.subjectComponentCatalog(),
    };
  },

  // Save the whole config atomically. Enabled component weightages MUST sum to 100.
  async saveSubjectConfig(subjectId: string, body: {
    totalMarks?: number; passingMarks?: number; theoryRule?: string; isActive?: boolean;
    components?: { key: string; label: string; weightagePct: number; isEnabled: boolean }[];
  }) {
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new ApiError(404, "SUBJECT_NOT_FOUND", "Subject not found.");
    const comps = body.components ?? [];
    const enabled = comps.filter((c) => c.isEnabled);
    const sum = enabled.reduce((a, c) => a + Number(c.weightagePct || 0), 0);
    if (enabled.length > 0 && Math.round(sum) !== 100) {
      throw new ApiError(400, "WEIGHTAGE_NOT_100", `Enabled component weightages must total exactly 100% (currently ${Math.round(sum)}%).`);
    }
    if (body.theoryRule && !["AVG_ALL", "BEST_3", "BEST_2"].includes(body.theoryRule)) {
      throw new ApiError(400, "VALIDATION_ERROR", "theoryRule must be AVG_ALL, BEST_3 or BEST_2.");
    }
    const seen = new Set<string>();
    for (const c of comps) {
      const key = (c.key || "").trim().toUpperCase();
      if (!key) throw new ApiError(400, "VALIDATION_ERROR", "Component key is required.");
      if (seen.has(key)) throw new ApiError(400, "DUPLICATE_COMPONENT", `Duplicate component "${key}".`);
      seen.add(key);
    }
    await prisma.$transaction([
      prisma.subject.update({
        where: { id: subjectId },
        data: {
          ...(body.totalMarks != null ? { totalMarks: Math.max(1, Number(body.totalMarks)) } : {}),
          ...(body.passingMarks != null ? { passingMarks: Math.max(0, Number(body.passingMarks)) } : {}),
          ...(body.theoryRule ? { theoryRule: body.theoryRule } : {}),
          ...(body.isActive != null ? { isActive: body.isActive } : {}),
        },
      }),
      // remove components no longer in the payload
      prisma.subjectComponent.deleteMany({ where: { subjectId, key: { notIn: comps.map((c) => c.key.trim().toUpperCase()) } } }),
      ...comps.map((c, i) =>
        prisma.subjectComponent.upsert({
          where: { subjectId_key: { subjectId, key: c.key.trim().toUpperCase() } },
          update: { label: c.label, weightagePct: Number(c.weightagePct || 0), isEnabled: c.isEnabled, sortOrder: i },
          create: { subjectId, key: c.key.trim().toUpperCase(), label: c.label, weightagePct: Number(c.weightagePct || 0), isEnabled: c.isEnabled, sortOrder: i },
        }),
      ),
    ]);
    return this.getSubjectConfig(subjectId);
  },

  async uploadPyq(subjectId: string, uploadedById: string, year: string, fileUrl: string, fileKey: string) {
    const subject = await subjectById(subjectId);
    const activeSemester = await prisma.semester.findFirst({
      where: { universityId: subject.universityId, number: subject.semesterNumber, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    }) ?? await prisma.semester.findFirst({
      where: { universityId: subject.universityId, number: subject.semesterNumber },
      orderBy: { startDate: "desc" },
    });
    const pyq = await prisma.pYQFile.create({ data: { subjectId, uploadedById, year, fileUrl, fileKey } });
    if (activeSemester) {
      await prisma.pYQAnalysis.upsert({
        where: { subjectId_semesterId: { subjectId, semesterId: activeSemester.id } },
        update: {},
        create: { subjectId, semesterId: activeSemester.id, topicFrequencies: {} },
      });
    }
    await bestEffortStudentAi(() => studentAiBridge.triggerPyqProcessing(pyq.id));
    return { uploaded: 1, subjectId, pyqId: pyq.id, processingStatus: studentAiBridge.isConfigured() ? "queued" : "uploaded" };
  },

  // ── Attendance (HOD) ──────────────────────────────────────

  async attendanceSummary(scope: Scope, semesterId?: string) {
    const rules = await getAttendanceRules(scope.universityId);
    const where = await hodEnrollmentWhere(scope, semesterId);
    const enrollments = await prisma.studentEnrollment.findMany({ where });
    const attendancePcts = await overallAttendancePctBulkArr(enrollments);
    const records = await prisma.attendanceRecord.findMany({ where: { enrollment: where } });
    const lockedCount = records.filter((r) => r.isLocked).length;
    return {
      overallAvgPct: average(attendancePcts),
      deltaLabel: enrollments.length === 0 ? "No attendance data" : "Current attendance average",
      belowThresholdCount: attendancePcts.filter((p) => p < rules.minThresholdPct).length,
      totalLectures: [...new Set(records.map((r) => r.lectureDate.toISOString().slice(0, 10)))].length,
      lockedRecordsPct: records.length === 0 ? 0 : Math.round((lockedCount / records.length) * 100),
    };
  },

  async attendanceHeatmap(scope: Scope, batchId: string, semesterId: string) {
    if (batchId) await ensureBatchInScope(batchId, scope);
    const subjects = await subjectsBySemester(semesterId);
    // historical-aware: enrollments at this semester in the HOD's batches (isCurrent when it's the live sem).
    const enrollments = await prisma.studentEnrollment.findMany({ where: { ...(await hodEnrollmentWhere(scope, semesterId, batchId || undefined)) }, include: { student: true } });
    const students = await Promise.all(
      enrollments.map(async (e) => {
        const perSubjectPct = await Promise.all(subjects.map((s) => computeAttendancePct(e.id, s.id)));
        return { enrollmentNo: e.student.enrollmentNo, name: e.student.name, perSubjectPct: perSubjectPct.map((p) => Math.round(p)), avgPct: Math.round(average(perSubjectPct)) };
      }),
    );
    return { subjects: subjects.map((s) => s.code), students };
  },

  async attendanceTable(scope: Scope, batchId: string, semesterId: string, search?: string, page = 1, limit = 20) {
    if (batchId) await ensureBatchInScope(batchId, scope);
    const subjects = await subjectsBySemester(semesterId);
    const enrollments = await prisma.studentEnrollment.findMany({ where: { ...(await hodEnrollmentWhere(scope, semesterId, batchId || undefined)) }, include: { student: true, batch: { select: { code: true } } } });
    const rules = await getAttendanceRules(scope.universityId);
    const rows = await Promise.all(
      enrollments.map(async (e) => {
        const perSubjectEntries = await Promise.all(
          subjects.map(async (s) => [s.code, Math.round(await computeAttendancePct(e.id, s.id))] as [string, number]),
        );
        const avgPct = Math.round(average(perSubjectEntries.map(([, pct]) => pct)));
        const allRecords = await prisma.attendanceRecord.findMany({ where: { enrollmentId: e.id } });
        return {
          enrollmentNo: e.student.enrollmentNo,
          name: e.student.name,
          batchCode: e.batch.code,
          perSubject: Object.fromEntries(perSubjectEntries),
          avgPct,
          status: avgPct < rules.minThresholdPct ? "AT_RISK" : "ACTIVE",
          isLocked: allRecords.length > 0 && allRecords.every((r) => r.isLocked),
        };
      }),
    );
    const filtered = rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.enrollmentNo.includes(search));
    return paginate(filtered, page, limit);
  },

  async attendanceBySubject(scope: Scope, batchId: string, semesterId: string) {
    if (batchId) await ensureBatchInScope(batchId, scope);
    const subjects = await subjectsBySemester(semesterId);
    const enrollments = await prisma.studentEnrollment.findMany({ where: { batchId: batchId || { in: scope.hodBatchIds }, semesterId, isCurrent: true } });
    const result = await Promise.all(
      subjects.map(async (subject) => {
        const pcts = await Promise.all(enrollments.map((e) => computeAttendancePct(e.id, subject.id)));
        return { code: subject.code, avgPct: Math.round(average(pcts)) };
      }),
    );
    return { subjects: result };
  },

  async lockAttendance(subjectId: string, batchId: string, semesterId: string) {
    const enrollments = await prisma.studentEnrollment.findMany({ where: { batchId, semesterId, isCurrent: true }, select: { id: true } });
    const { count } = await prisma.attendanceRecord.updateMany({
      where: { enrollmentId: { in: enrollments.map((e) => e.id) }, subjectId },
      data: { isLocked: true },
    });
    return { lockedCount: count, isLocked: true };
  },

  async unlockAttendance(enrollmentId: string, subjectId: string) {
    const enrollment = await enrollmentById(enrollmentId);
    await prisma.attendanceRecord.updateMany({ where: { enrollmentId, subjectId }, data: { isLocked: false } });
    const student = await prisma.student.findUnique({ where: { id: enrollment.studentId }, select: { enrollmentNo: true } });
    return { enrollmentNo: student?.enrollmentNo ?? "", isLocked: false };
  },

  async lockAllAttendance(batchId: string, semesterId: string) {
    const enrollments = await prisma.studentEnrollment.findMany({ where: { batchId, semesterId, isCurrent: true }, select: { id: true } });
    const { count } = await prisma.attendanceRecord.updateMany({ where: { enrollmentId: { in: enrollments.map((e) => e.id) } }, data: { isLocked: true } });
    return { lockedCount: count };
  },

  async attendanceExport(scope: Scope, batchId: string, semesterId: string): Promise<ExportTable> {
    const table = (await this.attendanceTable(scope, batchId, semesterId, undefined, 1, 1000)).data;
    const subjects = await subjectsBySemester(semesterId);
    const subjectCodes = subjects.map((s) => s.code);
    const batch = await batchById(batchId);
    return {
      title: `Attendance — Batch ${batch.code}`,
      subtitle: `${table.length} student(s) · exported ${new Date().toLocaleString("en-IN")}`,
      headers: ["Enrollment No", "Name", ...subjectCodes, "Avg %", "Status"],
      rows: table.map((row) => [row.enrollmentNo, row.name, ...subjectCodes.map((c) => row.perSubject[c] ?? 0), row.avgPct, row.status]),
    };
  },

  // ── Faculty Attendance (marking) ──────────────────────────

  async facultyAttendance(
    body: { subjectId: string; batchId: string; lectureDate: string; attendance: Array<{ enrollmentId: string; isPresent: boolean }> },
    facultyId: string,
    universityId: string,
  ) {
    const assignment = await prisma.facultyBatchAssignment.findFirst({ where: { facultyId, batchId: body.batchId, subjectId: body.subjectId } });
    if (!assignment) throw new ApiError(403, "NOT_ASSIGNED_TO_BATCH", "Faculty is not assigned to this batch.");
    const lectureDate = new Date(body.lectureDate);
    for (const item of body.attendance) {
      const existing = await prisma.attendanceRecord.findFirst({
        where: { enrollmentId: item.enrollmentId, subjectId: body.subjectId, lectureDate, slotId: null },
      });
      if (existing?.isLocked) throw new ApiError(409, "ATTENDANCE_RECORD_LOCKED", "Attendance record is locked.");
      if (existing) {
        await prisma.attendanceRecord.update({ where: { id: existing.id }, data: { isPresent: item.isPresent, updatedAt: new Date() } });
      } else {
        await prisma.attendanceRecord.create({ data: { enrollmentId: item.enrollmentId, subjectId: body.subjectId, facultyId, lectureDate, isPresent: item.isPresent } });
      }
    }
    const subject = await subjectById(body.subjectId);
    return { recordsCreated: body.attendance.length, lectureDate: body.lectureDate, subjectCode: subject.code };
  },

  // ── Mentorship ────────────────────────────────────────────

  async mentorshipSummary(scope: Scope, semesterId?: string) {
    const semester = await scopeSemester(scope, semesterId);
    const enrollments = await scopedCurrentEnrollments(scope, semester.id);
    const assignments = await prisma.mentorAssignment.findMany({ where: { semesterId: semester.id } });
    const activeMentors = new Set(assignments.map((a) => a.facultyId)).size;
    const assignedStudentIds = new Set(assignments.map((a) => a.studentId));
    return {
      activeMentors,
      studentsAssigned: assignments.length,
      unassignedStudents: enrollments.filter((e) => !assignedStudentIds.has(e.studentId)).length,
      avgMenteesPerMentor: activeMentors === 0 ? 0 : Number((assignments.length / activeMentors).toFixed(1)),
    };
  },

  async mentorshipMentors(scope: Scope, semesterId?: string) {
    const semester = await scopeSemester(scope, semesterId);
    const allFaculty = await getScopedFaculty(scope);
    const assignments = await prisma.mentorAssignment.findMany({ where: { semesterId: semester.id }, include: { student: true } });
    const data = allFaculty
      .filter((f) => !f.isHod && f.mentorCode)
      .map((faculty) => {
        const mentees = assignments.filter((a) => a.facultyId === faculty.id).map((a) => ({ enrollmentNo: a.student.enrollmentNo, name: a.student.name }));
        return { facultyId: faculty.id, name: faculty.name, year: faculty.year, mentorCode: faculty.mentorCode, menteeCount: mentees.length, mentees };
      });
    return { data };
  },

  async mentorshipAssignments(scope: Scope, query: Record<string, string | number | undefined>) {
    const semester = await scopeSemester(scope, query.semesterId as string | undefined);
    const assignments = await prisma.mentorAssignment.findMany({
      where: { semesterId: semester.id },
      include: { student: true, faculty: true },
    });
    const rows = await Promise.all(
      assignments.map(async (a) => {
        const enrollment = await currentEnrollmentForStudent(a.studentId, semester.id);
        const batch = enrollment ? await batchById(enrollment.batchId) : null;
        return { enrollmentNo: a.student.enrollmentNo, studentName: a.student.name, batchCode: batch?.code ?? "", mentorName: a.faculty.name, mentorCode: a.faculty.mentorCode };
      }),
    );
    const search = query.search as string | undefined;
    const filtered = rows
      .filter((r) => !search || r.studentName.toLowerCase().includes(search.toLowerCase()) || r.enrollmentNo.includes(search))
      .filter((r) => !query.mentorCode || r.mentorCode === query.mentorCode);
    return paginate(filtered, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async mentorshipUnassigned(scope: Scope, semesterId?: string) {
    const semester = await scopeSemester(scope, semesterId);
    const assignedIds = new Set((await prisma.mentorAssignment.findMany({ where: { semesterId: semester.id }, select: { studentId: true } })).map((a) => a.studentId));
    const enrollments = await scopedCurrentEnrollments(scope, semester.id);
    const data = await Promise.all(
      enrollments.filter((e) => !assignedIds.has(e.studentId)).map(async (e) => {
        const student = await prisma.student.findUnique({ where: { id: e.studentId }, select: { enrollmentNo: true, name: true, branch: true } });
        const batch = await batchById(e.batchId);
        return { enrollmentNo: student?.enrollmentNo ?? "", name: student?.name ?? "", batchCode: batch.code, branch: student?.branch ?? "" };
      }),
    );
    return { data, total: data.length };
  },

  async assignMentor(studentEnrollmentNo: string, facultyId: string, semesterId: string) {
    const student = await studentByEnrollmentNo(studentEnrollmentNo);
    const faculty = await facultyById(facultyId);
    if (faculty.isHod) throw new ApiError(400, "CANNOT_ASSIGN_TO_HOD", "Cannot assign mentor to HOD.");
    const existing = await getMentorAssignment(student.id, semesterId);
    if (existing) throw new ApiError(409, "STUDENT_ALREADY_HAS_MENTOR_THIS_SEMESTER", "Student already assigned.");
    const assignment = await prisma.mentorAssignment.create({ data: { facultyId, studentId: student.id, semesterId, mentorCode: faculty.mentorCode ?? "" } });
    return { id: assignment.id, mentorCode: faculty.mentorCode, student: { enrollmentNo: student.enrollmentNo, name: student.name }, faculty: { id: faculty.id, name: faculty.name } };
  },

  async assignMentorCsv(fileBuffer: Buffer | undefined, semesterId: string) {
    if (!fileBuffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    const rows = parseCsvRecords(fileBuffer, ["enrollment_no", "mentor_code"]);
    let assigned = 0;
    const errors: Array<{ row: number; enrollmentNo: string; reason: string }> = [];
    for (const { row, record } of rows) {
      const enrollmentNo = String(record.enrollment_no ?? "");
      const mentorCode = String(record.mentor_code ?? "");
      const student = await prisma.student.findFirst({ where: { enrollmentNo } });
      const faculty = await prisma.faculty.findFirst({ where: { mentorCode } });
      if (!student) { errors.push({ row, enrollmentNo, reason: "Student not found" }); continue; }
      if (!faculty) { errors.push({ row, enrollmentNo, reason: `Mentor code ${mentorCode} not found` }); continue; }
      const existing = await getMentorAssignment(student.id, semesterId);
      if (existing) { errors.push({ row, enrollmentNo, reason: "Student already has mentor this semester" }); continue; }
      await prisma.mentorAssignment.create({ data: { facultyId: faculty.id, studentId: student.id, semesterId, mentorCode } });
      assigned += 1;
    }
    return { assigned, errors };
  },

  async reassignMentor(studentEnrollmentNo: string, newFacultyId: string, semesterId: string) {
    const student = await studentByEnrollmentNo(studentEnrollmentNo);
    const existing = await getMentorAssignment(student.id, semesterId);
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Mentor assignment not found.");
    const newFaculty = await facultyById(newFacultyId);
    await prisma.mentorAssignment.update({ where: { id: existing.id }, data: { facultyId: newFacultyId, mentorCode: newFaculty.mentorCode ?? "" } });
    return { enrollmentNo: student.enrollmentNo, newMentorCode: newFaculty.mentorCode };
  },

  async autoAssignMentors(scope: Scope, semesterId: string) {
    const unassigned = (await this.mentorshipUnassigned(scope, semesterId)).data;
    const allFaculty = await getScopedFaculty(scope);
    const mentors = allFaculty.filter((f) => !f.isHod && f.mentorCode);
    const distribution = mentors.map((f) => ({ mentorCode: f.mentorCode!, newCount: 0 }));
    for (let i = 0; i < unassigned.length; i++) {
      const mentor = mentors[i % mentors.length];
      await this.assignMentor(unassigned[i].enrollmentNo, mentor.id, semesterId);
      distribution[i % mentors.length].newCount += 1;
    }
    return { assignedCount: unassigned.length, distribution };
  },

  async deleteMentorAssignment(assignmentId: string) {
    await prisma.mentorAssignment.delete({ where: { id: assignmentId } });
  },

  async resetMentorAssignments(semesterId: string, confirm: boolean) {
    if (!confirm) throw new ApiError(400, "VALIDATION_ERROR", "Confirmation required.");
    const { count } = await prisma.mentorAssignment.deleteMany({ where: { semesterId } });
    return { clearedCount: count };
  },

  // ── Analytics ─────────────────────────────────────────────

  async analyticsKpi(scope: Scope, batchId?: string) {
    const semester = await scopeSemester(scope);
    const rules = await getAttendanceRules(scope.universityId);
    // ponytail: prefer the *last completed* phase for KPIs so avg-marks isn't 0 mid-semester
    const currentPhase = (await prisma.phase.findFirst({ where: { semesterId: semester.id, isComplete: true }, orderBy: { number: "desc" } }))
      ?? await currentPhaseForSemester(semester.id);
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { isCurrent: true, batchId: { in: batchId ? [batchId] : scope.hodBatchIds } },
      include: { student: true },
    });
    const attendancePcts = await overallAttendancePctBulkArr(enrollments);
    const avgAttendance = average(attendancePcts);
    const phaseResults = currentPhase
      ? await prisma.result.findMany({ where: { phaseId: currentPhase.id, enrollmentId: { in: enrollments.map((e) => e.id) } } })
      : [];
    const avgMarks = phaseResults.length === 0 ? 0 : average(phaseResults.map((r) => (r.marksObtained / r.maxMarks) * 100));
    const atRiskCount = enrollments.filter((_, i) => attendancePcts[i] < rules.minThresholdPct).length;
    const passRate = phaseResults.length === 0 ? 0 : Number(((phaseResults.filter((r) => r.marksObtained >= 40).length / phaseResults.length) * 100).toFixed(1));
    const markPcts = await Promise.all(enrollments.map(async (e) => {
      const results = await prisma.result.findMany({ where: { enrollmentId: e.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
      return results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
    }));
    let topIdx = 0;
    for (let i = 1; i < markPcts.length; i++) { if (markPcts[i] > markPcts[topIdx]) topIdx = i; }
    const topStudent = enrollments[topIdx]?.student ?? null;
    return {
      avgAttendance: { value: avgAttendance, deltaLabel: `${enrollments.length} students` },
      avgMarksLatestPhase: { value: avgMarks, phaseLabel: currentPhase?.label ?? "", deltaLabel: `${phaseResults.length} rows` },
      atRiskCount: { value: atRiskCount, deltaLabel: "Current count" },
      passRateLatestPhase: { value: passRate, phaseLabel: currentPhase?.label ?? "", deltaLabel: `${phaseResults.length} rows` },
      topScorer: topStudent ? { name: topStudent.name, avgPct: markPcts[topIdx] } : { name: "-", avgPct: 0 },
    };
  },

  async analyticsAttendanceTrend(scope: Scope, months = 6) {
    const labels = monthLabels(months);
    // Real month buckets (UTC month boundaries, aligned to monthLabels) instead of a flat line.
    const now = new Date();
    const buckets = Array.from({ length: months }, (_v, i) => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - i - 1), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - i - 1) + 1, 1));
      return { start, end };
    });
    const series = await Promise.all(
      scope.hodBatchIds.map(async (batchId) => {
        const enrollments = await prisma.studentEnrollment.findMany({ where: { batchId, isCurrent: true }, select: { id: true } });
        const ids = enrollments.map((e) => e.id);
        const batch = await batchById(batchId);
        const data = await Promise.all(
          buckets.map(async (b) => {
            if (ids.length === 0) return null;
            const [total, present] = await Promise.all([
              prisma.attendanceRecord.count({ where: { enrollmentId: { in: ids }, lectureDate: { gte: b.start, lt: b.end } } }),
              prisma.attendanceRecord.count({ where: { enrollmentId: { in: ids }, lectureDate: { gte: b.start, lt: b.end }, isPresent: true } }),
            ]);
            return total === 0 ? null : Number(((present / total) * 100).toFixed(1));
          }),
        );
        return { batchCode: batch.code, data };
      }),
    );
    return { labels, series };
  },

  async analyticsAttendanceDistribution(scope: Scope, batchId?: string) {
    const enrollments = await prisma.studentEnrollment.findMany({ where: { isCurrent: true, batchId: { in: batchId ? [batchId] : scope.hodBatchIds } } });
    const values = await overallAttendancePctBulkArr(enrollments);
    return {
      buckets: [
        { range: "< 60%", count: values.filter((v) => v < 60).length },
        { range: "60–74%", count: values.filter((v) => v >= 60 && v < 75).length },
        { range: "75–84%", count: values.filter((v) => v >= 75 && v < 85).length },
        { range: "85–94%", count: values.filter((v) => v >= 85 && v < 95).length },
        { range: "≥ 95%", count: values.filter((v) => v >= 95).length },
      ],
    };
  },

  async analyticsAttendanceBySubject(scope: Scope, semesterId?: string, batchId?: string) {
    const targetBatchId = batchId ?? scope.hodBatchIds[0];
    if (!targetBatchId) return { subjects: [] };
    return this.attendanceBySubject(scope, targetBatchId, (await scopeSemester(scope, semesterId)).id);
  },

  async analyticsMarksByPhase(scope: Scope) {
    const semester = await scopeSemester(scope);
    const phases = await prisma.phase.findMany({ where: { semesterId: semester.id }, orderBy: { number: "asc" } });
    const subjects = await subjectsBySemester(semester.id);
    const series = await Promise.all(
      subjects.slice(0, 2).map(async (subject) => ({
        subjectCode: subject.code,
        data: await Promise.all(
          phases.map(async (phase) => {
            const rows = await prisma.result.findMany({ where: { phaseId: phase.id, subjectId: subject.id, enrollment: { batchId: { in: scope.hodBatchIds }, isCurrent: true } } });
            return rows.length === 0 ? null : average(rows.map((r) => (r.marksObtained / r.maxMarks) * 100));
          }),
        ),
      })),
    );
    return { phases: phases.map((p) => p.label), series };
  },

  async analyticsMarksBySubject(scope: Scope, phaseId: string, batchId?: string) {
    const phase = await phaseById(phaseId);
    const subjects = await subjectsBySemester(phase.semesterId);
    const result = await Promise.all(
      subjects.map(async (subject) => {
        const rows = await prisma.result.findMany({
          where: { phaseId, subjectId: subject.id, enrollment: { batchId: { in: batchId ? [batchId] : scope.hodBatchIds }, isCurrent: true } },
        });
        return { code: subject.code, avgMarksPct: rows.length === 0 ? 0 : Math.round(average(rows.map((r) => (r.marksObtained / r.maxMarks) * 100))) };
      }),
    );
    return { subjects: result };
  },

  async analyticsGradeDistribution(scope: Scope, phaseId: string, batchId?: string) {
    const rows = await prisma.result.findMany({ where: { phaseId, enrollment: { batchId: { in: batchId ? [batchId] : scope.hodBatchIds }, isCurrent: true } } });
    const grades = rows.map((r) => r.grade);
    return {
      buckets: [
        { grade: "A+ (≥90)", count: grades.filter((g) => g === "A+").length },
        { grade: "A (80–89)", count: grades.filter((g) => g === "A").length },
        { grade: "B (70–79)", count: grades.filter((g) => g === "B").length },
        { grade: "C (60–69)", count: grades.filter((g) => g === "C").length },
        { grade: "D (50–59)", count: grades.filter((g) => g === "D").length },
        { grade: "F (<50)", count: grades.filter((g) => g === "F").length },
      ],
    };
  },

  async analyticsLeaderboard(scope: Scope, phaseId: string, batchId?: string, limit = 10) {
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { isCurrent: true, batchId: { in: batchId ? [batchId] : scope.hodBatchIds } },
      include: { student: true, batch: true },
    });
    const rows = await Promise.all(
      enrollments.map(async (e) => {
        const results = await prisma.result.findMany({ where: { enrollmentId: e.id, phaseId } });
        const avgPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
        return { enrollmentNo: e.student.enrollmentNo, name: e.student.name, batchCode: e.batch.code, avgPct };
      }),
    );
    return { data: rows.sort((a, b) => b.avgPct - a.avgPct).slice(0, limit).map((r, i) => ({ rank: i + 1, ...r })) };
  },

  async analyticsAtRisk(scope: Scope, query: Record<string, string | number | undefined>) {
    const rules = await getAttendanceRules(scope.universityId);
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { isCurrent: true, batchId: { in: scope.hodBatchIds } },
      include: { student: true, batch: true },
    });
    const rows = await Promise.all(
      enrollments.map(async (e) => {
        const attendancePct = await computeOverallAttendancePct(e.id);
        const results = await prisma.result.findMany({ where: { enrollmentId: e.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
        const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
        const mentor = await getMentorAssignment(e.studentId, e.semesterId);
        const mentorFaculty = mentor ? await prisma.faculty.findUnique({ where: { id: mentor.facultyId }, select: { mentorCode: true } }) : null;
        const riskFactor = attendancePct < rules.minThresholdPct && avgMarksPct < 40 ? "BOTH" : attendancePct < rules.minThresholdPct ? "ATTENDANCE" : "MARKS";
        return { enrollmentNo: e.student.enrollmentNo, name: e.student.name, batchCode: e.batch.code, mentorCode: mentorFaculty?.mentorCode ?? null, avgAttendancePct: attendancePct, latestPhaseMarksPct: avgMarksPct, riskFactor, batchId: e.batchId };
      }),
    );
    const filtered = rows
      .filter((r) => r.avgAttendancePct < rules.minThresholdPct || r.latestPhaseMarksPct < 40)
      .filter((r) => !query.batchId || r.batchId === query.batchId)
      .filter((r) => !query.riskFactor || r.riskFactor === query.riskFactor)
      .map(({ batchId: _, ...rest }) => rest);
    return paginate(filtered, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async notifyAtRiskMentor(enrollmentNo: string) {
    const student = await studentByEnrollmentNo(enrollmentNo);
    const current = await currentEnrollmentForStudent(student.id);
    if (!current) throw new ApiError(404, "NOT_FOUND", "Student not found.");
    const assignment = await getMentorAssignment(student.id, current.semesterId);
    const mentorFaculty = assignment ? await prisma.faculty.findUnique({ where: { id: assignment.facultyId }, select: { mentorCode: true } }) : null;
    return { notified: Boolean(assignment), mentorCode: mentorFaculty?.mentorCode ?? null };
  },

  async analyticsYearComparison(universityId: string) {
    const years = await prisma.academicYear.findMany({ where: { universityId }, orderBy: { startDate: "desc" }, take: 2 });
    const subjects = await prisma.subject.findMany({ where: { universityId, deletedAt: null }, select: { code: true }, distinct: ["code"] });
    const subjectCodes = subjects.map((s) => s.code);
    return {
      subjects: subjectCodes,
      current: { label: years[0]?.label ?? "", data: Array.from({ length: subjectCodes.length }, () => 0) },
      compare: { label: years[1]?.label ?? "", data: Array.from({ length: subjectCodes.length }, () => 0) },
      attendanceComparison: { current: 0, compare: 0 },
      passRateComparison: { current: 0, compare: 0 },
    };
  },

  // Real at-risk report (this used to return an empty stub PDF).
  async analyticsExport(scope: Scope, query: Record<string, string | number | undefined> = {}): Promise<ExportTable> {
    const { data } = await this.analyticsAtRisk(scope, { ...query, limit: 1000 });
    return {
      title: "Analytics — At-Risk Students",
      subtitle: `${data.length} student(s) below threshold · exported ${new Date().toLocaleString("en-IN")}`,
      headers: ["Enrollment No", "Name", "Batch", "Mentor", "Attendance %", "Latest Marks %", "Risk"],
      rows: data.map((r: any) => [r.enrollmentNo, r.name, r.batchCode, r.mentorCode ?? "—", Math.round(r.avgAttendancePct), Math.round(r.latestPhaseMarksPct), r.riskFactor]),
    };
  },

  async analyticsPerformanceRadar(scope: Scope, phaseId: string) {
    const phase = await phaseById(phaseId);
    const subjects = await subjectsBySemester(phase.semesterId);
    // Per-subject averages for the top-10 vs bottom-10 students (ranked by their overall
    // phase average). The old version filled every axis with one overall number → flat polygon.
    const results = await prisma.result.findMany({
      where: { phaseId, isPublished: true, enrollment: { batchId: { in: scope.hodBatchIds }, isCurrent: true } },
      include: { subject: { select: { code: true } } },
    });
    const byEnr = new Map<string, { sum: number; n: number }>();
    for (const r of results) {
      const pct = (r.marksObtained / r.maxMarks) * 100;
      const e = byEnr.get(r.enrollmentId) ?? { sum: 0, n: 0 };
      e.sum += pct; e.n += 1;
      byEnr.set(r.enrollmentId, e);
    }
    const ranked = [...byEnr.entries()].map(([id, v]) => ({ id, avg: v.sum / v.n })).sort((a, b) => b.avg - a.avg);
    const topIds = new Set(ranked.slice(0, 10).map((r) => r.id));
    const bottomIds = new Set(ranked.slice(-10).map((r) => r.id));
    const perSubject = (ids: Set<string>, code: string) => {
      const rs = results.filter((r) => ids.has(r.enrollmentId) && r.subject.code === code);
      return rs.length === 0 ? 0 : average(rs.map((r) => (r.marksObtained / r.maxMarks) * 100));
    };
    return {
      subjects: subjects.map((s) => s.code),
      topAvg: subjects.map((s) => perSubject(topIds, s.code)),
      bottomAvg: subjects.map((s) => perSubject(bottomIds, s.code)),
    };
  },

  // ── Promotion ─────────────────────────────────────────────

  async promotionYears(universityId: string) {
    const years = await prisma.academicYear.findMany({ where: { universityId } });
    const data = await Promise.all(
      years.map(async (y) => ({
        id: y.id,
        label: y.label,
        status: y.status,
        studentCount: await prisma.studentEnrollment.count({ where: { semester: { academicYearId: y.id } } }),
      })),
    );
    return { years: data };
  },

  async promotionPreview(fromAcademicYearId: string, toAcademicYearId: string) {
    const fromYear = await getAcademicYear(fromAcademicYearId);
    const toYear = await getAcademicYear(toAcademicYearId);
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { isCurrent: true, semester: { academicYearId: fromAcademicYearId } },
      include: { student: true, batch: true, semester: true },
    });
    const groups: Array<{ yearLevel: YearLevel; targetYearLevel: YearLevel; students: Array<{ enrollmentNo: string; name: string; fromBatchCode: string; fromSemesterLabel: string }>; availableTargetBatches: Array<{ id: string; code: string }> }> = [];
    for (const e of enrollments) {
      const targetYL: YearLevel = e.batch.yearLevel === "FY" ? "SY" : e.batch.yearLevel === "SY" ? "TY" : "FINAL";
      let group = groups.find((g) => g.yearLevel === e.batch.yearLevel);
      if (!group) {
        const targetBatches = await prisma.batch.findMany({ where: { academicYearId: toAcademicYearId, yearLevel: targetYL }, select: { id: true, code: true } });
        group = { yearLevel: e.batch.yearLevel, targetYearLevel: targetYL, students: [], availableTargetBatches: targetBatches };
        groups.push(group);
      }
      group.students.push({ enrollmentNo: e.student.enrollmentNo, name: e.student.name, fromBatchCode: e.batch.code, fromSemesterLabel: e.semester.label });
    }
    return { fromYearLabel: fromYear.label, toYearLabel: toYear.label, groups, unmappedCount: groups.reduce((s, g) => s + g.students.length, 0) };
  },

  async savePromotionMapping(hodId: string, fromAcademicYearId: string, toAcademicYearId: string, mappings: Array<{ enrollmentNo: string; toBatchId: string; fromEnrollmentId?: string; fromSemesterId?: string; toSemesterId?: string }>) {
    const draft = await prisma.promotionDraft.create({ data: { hodId, fromAcademicYearId, toAcademicYearId, status: "IN_PROGRESS" } });
    for (const m of mappings) {
      const student = await prisma.student.findFirst({ where: { enrollmentNo: m.enrollmentNo } });
      if (!student) continue;
      const enrollment = m.fromEnrollmentId ? { id: m.fromEnrollmentId } : await currentEnrollmentForStudent(student.id);
      if (!enrollment) continue;
      const sem = await prisma.semester.findFirst({ where: { academicYearId: toAcademicYearId, yearLevel: { not: "FY" } } });
      await prisma.promotionMapping.create({
        data: { draftId: draft.id, enrollmentNo: m.enrollmentNo, fromEnrollmentId: enrollment.id, fromSemesterId: m.fromSemesterId ?? "", toSemesterId: m.toSemesterId ?? sem?.id ?? "", toBatchId: m.toBatchId },
      });
    }
    return { savedCount: mappings.length, draftId: draft.id };
  },

  async suggestRollNumbers(draftId: string) {
    const draft = await prisma.promotionDraft.findUnique({ where: { id: draftId }, include: { mappings: true } });
    if (!draft) throw new ApiError(404, "NOT_FOUND", "Draft not found.");
    return {
      suggestions: draft.mappings.map((m, i) => ({ enrollmentNo: m.enrollmentNo, suggestedRollNo: m.toRollNo ?? `IT-25-00${i + 1}` })),
    };
  },

  async promotionRollCsv(fileBuffer: Buffer | undefined, draftId: string) {
    if (!fileBuffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    const draft = await prisma.promotionDraft.findUnique({ where: { id: draftId }, include: { mappings: true } });
    if (!draft) throw new ApiError(404, "NOT_FOUND", "Draft not found.");
    const rows = parseCsvRecords(fileBuffer, ["enrollment_no", "new_roll_no", "new_batch_code"]);
    let assigned = 0;
    const errors: Array<{ row: number; enrollmentNo: string; reason: string }> = [];
    for (const { row, record } of rows) {
      const enrollmentNo = String(record.enrollment_no ?? "");
      const newRollNo = String(record.new_roll_no ?? "");
      const newBatchCode = String(record.new_batch_code ?? "");
      const mapping = draft.mappings.find((m) => m.enrollmentNo === enrollmentNo);
      const batch = await prisma.batch.findFirst({ where: { code: newBatchCode } });
      if (!mapping || !batch) { errors.push({ row, enrollmentNo, reason: "Draft mapping or batch not found" }); continue; }
      await prisma.promotionMapping.update({ where: { id: mapping.id }, data: { toBatchId: batch.id, toRollNo: newRollNo } });
      assigned += 1;
    }
    return { assigned, errors };
  },

  async promotionPreviewSummary(draftId: string) {
    const draft = await prisma.promotionDraft.findUnique({ where: { id: draftId }, include: { mappings: true } });
    if (!draft) throw new ApiError(404, "NOT_FOUND", "Draft not found.");
    const byBatch: Record<string, number> = {};
    for (const m of draft.mappings) {
      const batch = await prisma.batch.findUnique({ where: { id: m.toBatchId }, select: { code: true } });
      const code = batch?.code ?? m.toBatchId;
      byBatch[code] = (byBatch[code] ?? 0) + 1;
    }
    return { totalStudents: draft.mappings.length, mappedStudents: draft.mappings.length, heldStudents: draft.mappings.filter((m) => m.isHeld).length, byBatch: Object.entries(byBatch).map(([toBatchCode, count]) => ({ toBatchCode, count })) };
  },

  async executePromotion(draftId: string, mappings: Array<{ enrollmentNo: string; fromEnrollmentId: string; toSemesterId: string; toBatchId: string; toRollNo: string }>) {
    const draft = await prisma.promotionDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new ApiError(404, "NOT_FOUND", "Draft not found.");
    for (const m of mappings) {
      const student = await prisma.student.findFirst({ where: { enrollmentNo: m.enrollmentNo } });
      if (!student) continue;
      await prisma.studentEnrollment.update({ where: { id: m.fromEnrollmentId }, data: { isCurrent: false } });
      const semester = await getSemester(m.toSemesterId);
      await prisma.studentEnrollment.create({
        data: { studentId: student.id, semesterId: m.toSemesterId, batchId: m.toBatchId, rollNo: m.toRollNo, yearLevel: semester.yearLevel, isCurrent: true, promotedFromId: m.fromEnrollmentId },
      });
    }
    await prisma.promotionDraft.update({ where: { id: draftId }, data: { status: "EXECUTED", executedAt: new Date() } });
    return { promoted: mappings.length, skipped: 0, executedAt: new Date().toISOString(), executedBy: "System" };
  },

  async promotionHistory(page = 1, limit = 10) {
    const drafts = await prisma.promotionDraft.findMany({ where: { status: "EXECUTED" }, orderBy: { executedAt: "desc" } });
    return paginate(drafts.map((d) => ({ id: d.id, executedAt: d.executedAt, status: d.status })), page, limit);
  },

  async promotionMappingCsv(fileBuffer: Buffer | undefined, toAcademicYearId: string) {
    if (!fileBuffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    await getAcademicYear(toAcademicYearId);
    const rows = parseCsvRecords(fileBuffer, ["enrollment_no", "new_batch_code"]);
    let mapped = 0;
    const errors: Array<{ row: number; enrollmentNo: string; reason: string }> = [];
    for (const { row, record } of rows) {
      const enrollmentNo = String(record.enrollment_no ?? "");
      const batchCode = String(record.new_batch_code ?? "");
      const batch = await prisma.batch.findFirst({ where: { code: batchCode, academicYearId: toAcademicYearId } });
      if (!batch) { errors.push({ row, enrollmentNo, reason: `Batch code '${batchCode}' does not exist in target year` }); continue; }
      mapped += 1;
    }
    return { mapped, errors };
  },

  // ════════════════════════════════════════════════════════════
  // Promotion v2 — result-based semester + academic-year transition
  // Merit = aggregate % of published results (no CGPA/SGPA stored yet).
  // ════════════════════════════════════════════════════════════

  async logActivity(universityId: string, facultyId: string, type: string, title: string, description: string) {
    await prisma.activityLog.create({ data: { universityId, facultyId, type: type as any, title, description } });
  },

  async promotionContext(scope: Scope) {
    const sem = await scopeSemester(scope);
    if (!sem.id) return { mode: null as null | "SEMESTER" | "YEAR" };
    // odd semester (1,3,5,7) → next semester in same year; even (2,4,6,8) → next academic year
    const mode: "SEMESTER" | "YEAR" = sem.number % 2 === 1 ? "SEMESTER" : "YEAR";
    const enrs = await prisma.studentEnrollment.findMany({
      where: { semesterId: sem.id, batchId: { in: scope.hodBatchIds }, isCurrent: true },
      include: { student: { select: { branch: true } } },
    });
    const agg = await promotionAggregates(enrs.map((e) => e.id));
    let passed = 0, failed = 0, pending = 0;
    for (const e of enrs) {
      const a = agg.get(e.id);
      if (!a || a.max === 0) pending++;
      else if ((a.got / a.max) * 100 >= 40) passed++;
      else failed++;
    }
    const nextYearLevel = sem.yearLevel === "FY" ? "SY" : sem.yearLevel === "SY" ? "TY" : "FINAL";
    const nextSemester = mode === "SEMESTER"
      ? await prisma.semester.findFirst({ where: { academicYearId: sem.academicYearId, number: sem.number + 1 }, select: { id: true, label: true, number: true } })
      : null;
    const nextYear = mode === "YEAR"
      ? await prisma.academicYear.findFirst({ where: { universityId: scope.universityId, label: { gt: (await getAcademicYear(sem.academicYearId)).label } }, orderBy: { label: "asc" }, select: { id: true, label: true } })
      : null;
    const [hods, branches] = await Promise.all([
      prisma.faculty.findMany({ where: { universityId: scope.universityId, isHod: true, deletedAt: null }, select: { id: true, name: true, employeeId: true }, orderBy: { name: "asc" } }),
      prisma.universityBranch.findMany({ where: { universityId: scope.universityId }, orderBy: { code: "asc" }, select: { code: true, name: true } }),
    ]);
    return {
      mode,
      activeSemester: { id: sem.id, label: sem.label, number: sem.number, yearLevel: sem.yearLevel },
      nextSemester, nextYear, nextYearLevel,
      currentStudentCount: enrs.length,
      passedCount: passed, failedCount: failed, pendingCount: pending,
      branchesInScope: [...new Set(enrs.map((e) => e.student.branch))].sort(),
      hods, branches,
    };
  },

  // Merit leaderboard for the current cohort (optionally one branch), ranked by aggregate %.
  async promotionLeaderboard(scope: Scope, branch?: string) {
    const sem = await scopeSemester(scope);
    if (!sem.id) return { data: [], total: 0 };
    const enrs = await prisma.studentEnrollment.findMany({
      where: { semesterId: sem.id, batchId: { in: scope.hodBatchIds }, isCurrent: true, ...(branch ? { student: { branch } } : {}) },
      include: { student: { select: { enrollmentNo: true, name: true, branch: true } }, batch: { select: { code: true } } },
    });
    const agg = await promotionAggregates(enrs.map((e) => e.id));
    const rows = enrs.map((e) => {
      const a = agg.get(e.id);
      const pct = a && a.max > 0 ? (a.got / a.max) * 100 : null;
      return {
        enrollmentId: e.id, enrollmentNo: e.student.enrollmentNo, name: e.student.name,
        branch: e.student.branch, batchCode: e.batch.code, rollNo: e.rollNo,
        aggregatePct: pct === null ? null : Math.round(pct * 10) / 10,
        status: pct === null ? "Pending" : pct >= 40 ? "Pass" : "Fail",
      };
    });
    // merit order: highest % first, ungraded last, then enrollment no
    rows.sort((a, b) => {
      if (a.aggregatePct === null && b.aggregatePct === null) return a.enrollmentNo.localeCompare(b.enrollmentNo);
      if (a.aggregatePct === null) return 1;
      if (b.aggregatePct === null) return -1;
      return b.aggregatePct - a.aggregatePct || a.enrollmentNo.localeCompare(b.enrollmentNo);
    });
    return { data: rows.map((r, i) => ({ rank: i + 1, ...r })), total: rows.length };
  },

  // Preview auto-generated batches + capacity fit for the year-promotion wizard.
  async promotionYearPreview(scope: Scope, opts: { branch: string; batchCount: number; capacity: number; batchInitial?: string }) {
    const { data } = await this.promotionLeaderboard(scope, opts.branch);
    const initial = (opts.batchInitial || "C").toUpperCase().slice(0, 1);
    const promotable = data.filter((r) => r.status !== "Fail"); // failing students are detained by default
    const batches = Array.from({ length: opts.batchCount }, (_, i) => {
      const start = i * opts.capacity;
      const slice = promotable.slice(start, start + opts.capacity);
      return { code: `${initial}${i + 1}`, assigned: slice.length, capacity: opts.capacity };
    });
    return {
      totalStudents: data.length,
      promotable: promotable.length,
      detained: data.length - promotable.length,
      seats: opts.batchCount * opts.capacity,
      overflow: Math.max(0, promotable.length - opts.batchCount * opts.capacity),
      batches,
    };
  },

  async promotionExecuteSemester(scope: Scope, opts: { detainEnrollmentIds?: string[] } = {}) {
    const sem = await scopeSemester(scope);
    if (!sem.id) throw new ApiError(400, "NO_ACTIVE_SEMESTER", "No active semester.");
    if (sem.number % 2 !== 1) throw new ApiError(400, "NOT_SEMESTER_POINT", "This is a year-end semester — use year promotion.");
    // create the next semester (same year, same year level) if it doesn't exist yet
    let next = await prisma.semester.findFirst({ where: { academicYearId: sem.academicYearId, number: sem.number + 1 } });
    if (!next) {
      const start = new Date(sem.endDate);
      const end = new Date(start.getTime() + 1000 * 60 * 60 * 24 * 120);
      next = await prisma.semester.create({
        data: { universityId: scope.universityId, academicYearId: sem.academicYearId, number: sem.number + 1, label: `Semester ${sem.number + 1}`, yearLevel: sem.yearLevel, status: "UPCOMING", startDate: start, endDate: end },
      });
      const span = (end.getTime() - start.getTime()) / 4;
      await prisma.phase.createMany({ data: [1, 2, 3, 4].map((i) => ({ semesterId: next!.id, label: `T${i}`, number: i, startDate: new Date(start.getTime() + span * (i - 1)), endDate: new Date(start.getTime() + span * i) })) });
    }
    const detain = new Set(opts.detainEnrollmentIds ?? []);
    const enrs = await prisma.studentEnrollment.findMany({ where: { semesterId: sem.id, batchId: { in: scope.hodBatchIds }, isCurrent: true } });
    const nextId = next.id;
    // ponytail: atomic — enrollments carried forward, HOD batch scopes moved to the new semester,
    // and the active semester advanced, all together. Prevents the "students vanish after promotion"
    // state where enrollments moved but scope/active semester lagged behind.
    const promoted = await prisma.$transaction(async (tx) => {
      let n = 0;
      for (const e of enrs) {
        if (detain.has(e.id)) continue;
        await tx.studentEnrollment.update({ where: { id: e.id }, data: { isCurrent: false } });
        await tx.studentEnrollment.create({
          data: { studentId: e.studentId, semesterId: nextId, batchId: e.batchId, rollNo: e.rollNo, yearLevel: next!.yearLevel, isCurrent: true, promotedFromId: e.id },
        });
        n++;
      }
      // move HOD batch ownership to the new semester (batchId is @unique on the scope)
      await tx.hodBatchScope.updateMany({ where: { batchId: { in: scope.hodBatchIds } }, data: { semesterId: nextId } });
      // advance the active semester within this batch/year
      await tx.semester.update({ where: { id: sem.id }, data: { status: "COMPLETE" } });
      await tx.semester.update({ where: { id: nextId }, data: { status: "ACTIVE" } });
      return n;
    });
    await this.logActivity(scope.universityId, scope.userId, "PROMOTION_EXECUTED", `Promoted to ${next.label}`, `${promoted} students promoted from ${sem.label} to ${next.label}. Detained: ${detain.size}.`);
    return { mode: "SEMESTER", promoted, detained: detain.size, fromSemester: sem.label, toSemester: next.label };
  },

  async promotionExecuteYear(scope: Scope, body: { destinationHodId: string; branch: string; batchCount: number; capacity: number; batchInitial?: string; detainEnrollmentIds?: string[] }) {
    const sem = await scopeSemester(scope);
    if (!sem.id) throw new ApiError(400, "NO_ACTIVE_SEMESTER", "No active semester.");
    if (sem.number % 2 !== 0) throw new ApiError(400, "NOT_YEAR_POINT", "This is a mid-year semester — use semester promotion.");
    const curYear = await getAcademicYear(sem.academicYearId);
    const nextYear = await prisma.academicYear.findFirst({ where: { universityId: scope.universityId, label: { gt: curYear.label } }, orderBy: { label: "asc" } });
    if (!nextYear) throw new ApiError(400, "NO_NEXT_YEAR", "Create the next academic year first (University portal).");
    const nextYL = sem.yearLevel === "FY" ? "SY" : sem.yearLevel === "SY" ? "TY" : "FINAL";
    const nextSem = await prisma.semester.findFirst({ where: { academicYearId: nextYear.id, yearLevel: nextYL as any }, orderBy: { number: "asc" } });
    if (!nextSem) throw new ApiError(400, "NO_NEXT_SEMESTER", `Create the first ${nextYL} semester in ${nextYear.label} first.`);
    const hod = await prisma.faculty.findFirst({ where: { id: body.destinationHodId, universityId: scope.universityId, isHod: true, deletedAt: null } });
    if (!hod) throw new ApiError(404, "HOD_NOT_FOUND", "Destination HOD not found.");

    const { data } = await this.promotionLeaderboard(scope, body.branch);
    const detain = new Set(body.detainEnrollmentIds ?? []);
    const promotable = data.filter((r) => r.status !== "Fail" && !detain.has(r.enrollmentId));
    if (promotable.length > body.batchCount * body.capacity) {
      throw new ApiError(400, "INSUFFICIENT_CAPACITY", `${promotable.length} students but only ${body.batchCount * body.capacity} seats. Add batches or capacity.`);
    }
    const initial = (body.batchInitial || "C").toUpperCase().slice(0, 1);
    // ponytail: ALL year-promotion writes (batches, scopes, enrollment carry-forward) in ONE
    // transaction — a partial failure must never leave orphan batches or half-promoted students.
    const { promoted, createdBatches } = await prisma.$transaction(async (tx) => {
      let promoted = 0;
      const createdBatches: { code: string; count: number }[] = [];
      for (let i = 0; i < body.batchCount; i++) {
        const code = `${initial}${i + 1}`;
        const existing = await tx.batch.findFirst({ where: { academicYearId: nextYear.id, code } });
        const batch = existing ?? await tx.batch.create({ data: { universityId: scope.universityId, academicYearId: nextYear.id, code, yearLevel: nextYL as any } });
        await tx.hodBatchScope.upsert({
          where: { batchId: batch.id },
          update: { facultyId: hod.id, semesterId: nextSem.id, academicYearId: nextYear.id },
          create: { facultyId: hod.id, batchId: batch.id, semesterId: nextSem.id, academicYearId: nextYear.id },
        });
        const slice = promotable.slice(i * body.capacity, i * body.capacity + body.capacity);
        let seq = 1;
        for (const r of slice) {
          const from = await tx.studentEnrollment.findUnique({ where: { id: r.enrollmentId }, select: { studentId: true } });
          if (!from) continue;
          await tx.studentEnrollment.update({ where: { id: r.enrollmentId }, data: { isCurrent: false } });
          await tx.studentEnrollment.create({
            data: { studentId: from.studentId, semesterId: nextSem.id, batchId: batch.id, rollNo: `${code}-${String(seq).padStart(3, "0")}`, yearLevel: nextYL as any, isCurrent: true, promotedFromId: r.enrollmentId },
          });
          seq++; promoted++;
        }
        createdBatches.push({ code, count: slice.length });
      }
      return { promoted, createdBatches };
    });
    await this.logActivity(scope.universityId, scope.userId, "PROMOTION_EXECUTED",
      `Year promotion → ${hod.name}`,
      `${promoted} ${body.branch} students promoted from ${curYear.label} (${sem.yearLevel}) to ${nextYear.label} (${nextYL}) under ${hod.name}. Detained/failed: ${data.length - promoted}.`);
    return { mode: "YEAR", promoted, detained: data.length - promoted, destinationHod: hod.name, toYear: nextYear.label, batches: createdBatches };
  },

  // ── Calendar Events ───────────────────────────────────────

  async calendarEvents(universityId: string, query: Record<string, string | number | undefined>) {
    const where: any = { universityId };
    if (query.year && query.month) {
      const y = Number(query.year); const m = Number(query.month);
      const start = new Date(y, m - 1, 1); const end = new Date(y, m, 0);
      where.startDate = { gte: start, lte: end };
    }
    if (query.startDate && query.endDate) {
      where.startDate = { gte: new Date(String(query.startDate)) };
      where.endDate = { lte: new Date(String(query.endDate)) };
    }
    const rows = await prisma.calendarEvent.findMany({ where, orderBy: { startDate: "asc" } });
    return { data: rows.map((e) => ({ id: e.id, date: e.startDate, startDate: e.startDate, endDate: e.endDate, title: e.title, type: e.eventType, description: e.description })) };
  },

  async upcomingEvents(universityId: string, limit = 6) {
    const rows = await prisma.calendarEvent.findMany({
      where: { universityId, startDate: { gte: new Date() }, deletedAt: null },
      orderBy: { startDate: "asc" },
      take: limit,
    });
    return { data: rows.map((e) => ({ id: e.id, date: e.startDate, startDate: e.startDate, endDate: e.endDate, title: e.title, type: e.eventType, description: e.description })) };
  },

  async getEvent(eventId: string) {
    const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new ApiError(404, "NOT_FOUND", "Event not found.");
    return { id: event.id, title: event.title, date: event.startDate, endDate: event.endDate, type: event.eventType, description: event.description, visibleTo: event.visibleTo, createdBy: event.createdById };
  },

  async createEvent(universityId: string, facultyId: string, body: Record<string, string>) {
    const event = await prisma.calendarEvent.create({
      data: { universityId, title: body.title, description: body.description ?? null, startDate: new Date(body.startDate), endDate: new Date(body.endDate), eventType: body.type as any, visibleTo: (body.visibleTo as any) ?? "ALL", createdById: facultyId, semesterId: body.semesterId ?? null },
    });
    return { id: event.id, title: event.title, startDate: event.startDate };
  },

  async updateEvent(eventId: string, body: Record<string, string>) {
    const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new ApiError(404, "NOT_FOUND", "Event not found.");
    const updated = await prisma.calendarEvent.update({
      where: { id: eventId },
      data: { title: body.title ?? event.title, startDate: body.startDate ? new Date(body.startDate) : event.startDate, endDate: body.endDate ? new Date(body.endDate) : event.endDate, eventType: (body.type as any) ?? event.eventType },
    });
    return { id: updated.id, title: updated.title, date: updated.startDate, endDate: updated.endDate, type: updated.eventType };
  },

  async deleteEvent(eventId: string) {
    await prisma.calendarEvent.update({ where: { id: eventId }, data: { deletedAt: new Date() } });
  },

  async phaseTimeline(scope: Scope, semesterId?: string) {
    const semester = await scopeSemester(scope, semesterId);
    const phases = await prisma.phase.findMany({ where: { semesterId: semester.id }, orderBy: { number: "asc" } });
    return { phases: phases.map((p) => ({ label: p.label, startDate: p.startDate, endDate: p.endDate, examDate: p.examDate, isComplete: p.isComplete })) };
  },

  // Real calendar listing (this used to return an empty stub PDF).
  async calendarExport(universityId: string, query: Record<string, string | number | undefined> = {}): Promise<ExportTable> {
    const { data } = await this.calendarEvents(universityId, query);
    const fmt = (d: Date | string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    return {
      title: "Academic Calendar",
      subtitle: `${data.length} event(s) · exported ${new Date().toLocaleString("en-IN")}`,
      headers: ["Start Date", "End Date", "Title", "Type", "Description"],
      rows: data.map((e: any) => [fmt(e.startDate ?? e.date), fmt(e.endDate ?? e.date), e.title, e.type, e.description ?? ""]),
    };
  },

  // ── Announcements (HOD) ───────────────────────────────────

  async listAnnouncements(scope: Scope, page = 1, limit = 20) {
    const rows = await prisma.announcement.findMany({
      where: { universityId: scope.universityId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { faculty: { select: { name: true, isHod: true } } },
    });
    const data = rows.map((a) => ({ id: a.id, title: a.title, body: a.body, scope: a.scope, scopeValue: a.scopeValue, senderName: a.faculty.name, senderRole: a.faculty.isHod ? "HOD" : "FACULTY", createdAt: a.createdAt }));
    return paginate(data, page, limit);
  },

  async createAnnouncement(scope: Scope, facultyId: string, body: { title: string; body: string; scope: string; scopeValue?: string }) {
    const a = await prisma.announcement.create({
      data: { universityId: scope.universityId, facultyId, title: body.title, body: body.body, scope: body.scope as any, scopeValue: body.scopeValue ?? null },
    });
    return { id: a.id, title: a.title, scope: a.scope, createdAt: a.createdAt };
  },

  async updateAnnouncement(announcementId: string, facultyId: string, body: { title?: string; body?: string }) {
    const a = await prisma.announcement.findFirst({ where: { id: announcementId, facultyId, deletedAt: null } });
    if (!a) throw new ApiError(404, "NOT_FOUND", "Announcement not found.");
    return prisma.announcement.update({ where: { id: announcementId }, data: { title: body.title ?? a.title, body: body.body ?? a.body, updatedAt: new Date() } });
  },

  async deleteAnnouncement(announcementId: string, facultyId: string) {
    const a = await prisma.announcement.findFirst({ where: { id: announcementId, facultyId, deletedAt: null } });
    if (!a) throw new ApiError(404, "NOT_FOUND", "Announcement not found.");
    await prisma.announcement.update({ where: { id: announcementId }, data: { deletedAt: new Date() } });
  },

  // ── Settings ──────────────────────────────────────────────

  async settingsProfile(userId: string) {
    const f = await facultyById(userId);
    return { employeeId: f.employeeId, name: f.name, email: f.email, phone: f.phone, year: f.year, profilePhotoUrl: f.profilePhotoUrl };
  },

  async updateSettingsProfile(userId: string, body: Record<string, string>) {
    await prisma.faculty.update({ where: { id: userId }, data: { name: body.name, phone: body.phone ?? null } });
    return this.settingsProfile(userId);
  },

  async uploadProfilePhoto(userId: string, photoUrl: string) {
    const student = await prisma.student.findFirst({ where: { id: userId, deletedAt: null } });
    if (student) {
      await prisma.student.update({ where: { id: userId }, data: { profilePhotoUrl: photoUrl } });
      return { profilePhotoUrl: photoUrl };
    }
    await prisma.faculty.update({ where: { id: userId }, data: { profilePhotoUrl: photoUrl } });
    return { profilePhotoUrl: photoUrl };
  },

  async universitySettings(universityId: string) {
    return getUniversity(universityId);
  },

  async updateUniversity(universityId: string, body: Record<string, string>) {
    return prisma.university.update({ where: { id: universityId }, data: { name: body.name, website: body.website, contactEmail: body.contactEmail, address: body.address } });
  },

  async addUniversityBranch(universityId: string, code: string, name: string) {
    const existing = await prisma.universityBranch.findFirst({ where: { universityId, code } });
    if (existing) throw new ApiError(409, "BRANCH_EXISTS", "Branch already exists.");
    await prisma.universityBranch.create({ data: { universityId, code, name } });
    const branches = await prisma.universityBranch.findMany({ where: { universityId } });
    return { branches: branches.map((b) => b.code) };
  },

  async academicYears(universityId: string) {
    const years = await prisma.academicYear.findMany({ where: { universityId }, include: { semesters: true }, orderBy: { startDate: "desc" } });
    return {
      data: years.map((y) => ({
        id: y.id,
        label: y.label,
        status: y.status,
        semesters: y.semesters.map((s) => ({ id: s.id, number: s.number, label: s.label, status: s.status })),
      })),
    };
  },

  async createAcademicYear(universityId: string, body: { label: string; startDate: string; endDate: string }) {
    const university = await prisma.university.findUnique({ where: { id: universityId }, select: { id: true } });
    if (!university) throw new ApiError(409, "UNIVERSITY_CONTEXT_STALE", "Your session is connected to an old university record. Sign in again and retry.");
    const year = await prisma.academicYear.create({ data: { universityId, label: body.label, startDate: new Date(body.startDate), endDate: new Date(body.endDate), status: "DRAFT" } });
    return { id: year.id, label: year.label, status: year.status };
  },

  async activateAcademicYear(yearId: string, universityId: string) {
    await prisma.academicYear.updateMany({ where: { universityId, status: "ACTIVE" }, data: { status: "ARCHIVED" } });
    await prisma.academicYear.update({ where: { id: yearId }, data: { status: "ACTIVE" } });
    return { id: yearId, status: "ACTIVE" };
  },

  async createSemester(yearId: string, universityId: string, body: { number: number; yearLevel: YearLevel; startDate: string; endDate: string }) {
    const year = await getAcademicYear(yearId);
    const semester = await prisma.semester.create({
      data: { universityId, academicYearId: yearId, number: body.number, label: `Semester ${body.number}`, yearLevel: body.yearLevel, status: "UPCOMING", startDate: new Date(body.startDate), endDate: new Date(body.endDate) },
    });
    return { id: semester.id, number: semester.number, label: semester.label };
  },

  async notifications(userId: string) {
    const prefs = await prisma.notificationConfig.findMany({ where: { facultyId: userId } });
    return { preferences: prefs.map((p) => ({ key: p.key, enabled: p.enabled })) };
  },

  async updateNotifications(userId: string, universityId: string, preferences: Array<{ key: string; enabled: boolean }>) {
    for (const pref of preferences) {
      await prisma.notificationConfig.upsert({
        where: { facultyId_key: { facultyId: userId, key: pref.key as any } },
        update: { enabled: pref.enabled },
        create: { universityId, facultyId: userId, key: pref.key as any, enabled: pref.enabled },
      });
    }
    return this.notifications(userId);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (newPassword.length < 8) throw new ApiError(400, "PASSWORD_TOO_WEAK", "Password must be at least 8 characters.");
    const faculty = await facultyById(userId);
    if (!matchesPassword(faculty.passwordHash, currentPassword)) throw new ApiError(401, "CURRENT_PASSWORD_INCORRECT", "Current password is incorrect.");
    await prisma.faculty.update({ where: { id: userId }, data: { passwordHash: newPassword } });
    return { message: "Password updated successfully" };
  },

  async securitySessions(userId: string) {
    const tokens = await prisma.refreshToken.findMany({ where: { OR: [{ facultyId: userId }, { studentId: userId }] } });
    return { data: tokens.map((t) => ({ id: t.id, userAgent: t.userAgent, ipAddress: t.ipAddress, createdAt: t.createdAt, expiresAt: t.expiresAt })) };
  },

  async revokeSession(sessionId: string) {
    await prisma.refreshToken.delete({ where: { id: sessionId } });
  },

  async attendanceRules(universityId: string) {
    return getAttendanceRules(universityId);
  },

  async updateAttendanceRules(universityId: string, body: { minThresholdPct?: number; warningThresholdPct?: number; autoNotifyMentor?: boolean; autoLockAfterDays?: number }) {
    return prisma.attendanceRules.upsert({
      where: { universityId },
      update: { ...body },
      create: { universityId, minThresholdPct: body.minThresholdPct ?? 75, warningThresholdPct: body.warningThresholdPct ?? 80, autoNotifyMentor: body.autoNotifyMentor ?? true, autoLockAfterDays: body.autoLockAfterDays ?? 7 },
    });
  },

  async deleteAttendanceRecords(universityId: string, semesterId: string, confirm: boolean) {
    if (!confirm) throw new ApiError(400, "VALIDATION_ERROR", "Confirmation required.");
    const enrollments = await prisma.studentEnrollment.findMany({ where: { semesterId }, select: { id: true } });
    const ids = enrollments.map((e) => e.id);
    const lockedCount = await prisma.attendanceRecord.count({ where: { enrollmentId: { in: ids }, isLocked: true } });
    if (lockedCount > 0) return { deletedCount: 0, blocked: true, reason: `${lockedCount} records are locked. Unlock before deleting.` };
    const { count } = await prisma.attendanceRecord.deleteMany({ where: { enrollmentId: { in: ids } } });
    return { deletedCount: count, blocked: false };
  },

  async archiveYear(universityId: string, academicYearId: string, requestedById: string) {
    const job = await prisma.archiveJob.create({ data: { universityId, academicYearId, requestedById, status: "QUEUED" } });
    return { jobId: job.id, status: "queued", estimatedTimeSeconds: 45 };
  },

  async archiveStatus(jobId: string) {
    const job = await prisma.archiveJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError(404, "NOT_FOUND", "Archive job not found.");
    return { jobId: job.id, status: job.status, academicYearId: job.academicYearId };
  },

  // ── Student endpoints ─────────────────────────────────────

  async studentAttendance(userId: string, universityId: string, semesterId?: string) {
    const { student, semester, enrollment } = await getStudentEnrollment(userId, universityId, semesterId);
    const subjectIds = await getStudentSubjectIds(userId, universityId, semester.id);
    const rules = await getAttendanceRules(universityId);
    const subjects = await Promise.all(
      subjectIds.map(async (subjectId) => {
        const subject = await subjectById(subjectId);
        const records = await prisma.attendanceRecord.findMany({ where: { enrollmentId: enrollment.id, subjectId }, select: { isPresent: true } });
        const totalLectures = records.length;
        const attended = records.filter((r) => r.isPresent).length;
        const absent = totalLectures - attended;
        const pct = totalLectures === 0 ? 0 : Number(((attended / totalLectures) * 100).toFixed(2));
        const lecturesNeeded = (threshold: number) => {
          if (pct >= threshold) return 0;
          let extra = 0;
          while (((attended + extra) / (totalLectures + extra || 1)) * 100 < threshold) {
            extra++;
            if (extra > 1000) break;
          }
          return extra;
        };
        return {
          subjectId: subject.id, subjectCode: subject.code, subjectName: subject.name, totalLectures, attended, absent, percentage: pct,
          status: pct < rules.minThresholdPct ? "AT_RISK" : pct < rules.warningThresholdPct ? "WARNING" : "GOOD",
          isBelowThreshold: pct < rules.minThresholdPct, isBelowWarning: pct < rules.warningThresholdPct,
          lecturesNeededToReach75: lecturesNeeded(rules.minThresholdPct), lecturesNeededToReach85: lecturesNeeded(85),
        };
      }),
    );
    const overallPct = average(subjects.map((s) => s.percentage));
    return {
      semesterLabel: semester.label,
      threshold: rules.minThresholdPct,
      warningThreshold: rules.warningThresholdPct,
      overallPct,
      overallStatus: overallPct < rules.minThresholdPct ? "AT_RISK" : overallPct < rules.warningThresholdPct ? "WARNING" : "GOOD",
      subjects,
    };
  },

  async studentDashboard(studentId: string, universityId: string) {
    const { student, semester, enrollment } = await getStudentEnrollment(studentId, universityId);
    const attendance = await this.studentAttendance(studentId, universityId, semester.id);
    const currentPhase = await currentPhaseForSemester(semester.id);
    const mentorAssignment = await getStudentMentorAssignment(studentId, universityId, semester.id);
    const mentor = mentorAssignment ? await facultyById(mentorAssignment.facultyId) : null;
    const recentResults = await prisma.result.findMany({
      where: { enrollmentId: enrollment.id, isPublished: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { phase: true, subject: true },
    });
    const batch = await batchById(enrollment.batchId);
    const ay = await getAcademicYear((await getSemester(semester.id)).academicYearId);
    const unreadAnnouncements = await prisma.announcement.findMany({ where: { universityId, deletedAt: null } });
    const unreadAnn = (await Promise.all(unreadAnnouncements.map(async (a) => {
      const visible = await studentAnnouncementVisible(a, studentId, universityId, semester.id);
      if (!visible) return false;
      return !(await isAnnouncementRead(studentId, a.id));
    }))).filter(Boolean).length;
    const unreadMentorMessages = mentorAssignment
      ? await prisma.chatMessage.count({ where: { mentorAssignmentId: mentorAssignment.id, senderRole: "FACULTY", isRead: false } })
      : 0;
    const subjectIds = await getStudentSubjectIds(studentId, universityId, semester.id);
    const pendingQuizzes = await prisma.quiz.count({ where: { isPublished: true, deletedAt: null, semesterId: semester.id, subjectId: { in: subjectIds }, attempts: { none: { studentId } } } });
    const upcomingEvents = await prisma.calendarEvent.findMany({ where: { universityId, startDate: { gte: new Date() }, deletedAt: null }, orderBy: { startDate: "asc" }, take: 5 });
    const latestPhaseResults = currentPhase ? await prisma.result.findMany({ where: { enrollmentId: enrollment.id, phaseId: currentPhase.id, isPublished: true } }) : [];
    return {
      student: { enrollmentNo: student.enrollmentNo, name: student.name, branch: student.branch },
      currentEnrollment: { semesterLabel: semester.label, yearLevel: batch.yearLevel, batchCode: batch.code, rollNo: enrollment.rollNo, academicYear: ay.label },
      stats: {
        overallAttendancePct: attendance.overallPct, attendanceStatus: attendance.overallStatus,
        subjectsBelowThreshold: attendance.subjects.filter((s) => s.isBelowThreshold).length,
        latestPhaseLabel: currentPhase?.label ?? null,
        latestPhaseAvgPct: latestPhaseResults.length === 0 ? null : average(latestPhaseResults.map((r) => (r.marksObtained / r.maxMarks) * 100)),
        pendingQuizzes, unreadAnnouncements: unreadAnn, unreadMentorMessages,
      },
      upcomingEvents: upcomingEvents.map((e) => ({ id: e.id, title: e.title, date: e.startDate, type: e.eventType })),
      recentResults: recentResults.map((r) => ({ phase: r.phase.label, subjectCode: r.subject.code, marks: r.marksObtained, maxMarks: r.maxMarks, grade: r.grade })),
      mentor: mentor ? { name: mentor.name, mentorCode: mentor.mentorCode, unreadMessages: unreadMentorMessages } : null,
    };
  },

  async studentProfile(studentId: string, universityId: string) {
    const { student, semester, enrollment } = await getStudentEnrollment(studentId, universityId);
    const batch = await batchById(enrollment.batchId);
    return {
      enrollmentNo: student.enrollmentNo, name: student.name, email: student.email, phone: student.phone, branch: student.branch, admissionYear: student.admissionYear, profilePhotoUrl: student.profilePhotoUrl ?? null,
      currentEnrollment: { batchCode: batch.code, rollNo: enrollment.rollNo, semesterLabel: semester.label, yearLevel: batch.yearLevel },
    };
  },

  async updateStudentProfile(studentId: string, universityId: string, body: Record<string, string>) {
    if ("email" in body || "enrollmentNo" in body || "branch" in body) throw new ApiError(400, "READONLY_FIELD", "email, enrollmentNo, and branch are read-only.");
    await prisma.student.update({ where: { id: studentId }, data: { name: body.name, phone: body.phone ?? null } });
    return this.studentProfile(studentId, universityId);
  },

  async changeStudentPassword(studentId: string, currentPassword: string, newPassword: string, confirmPassword: string) {
    if (newPassword !== confirmPassword) throw new ApiError(400, "PASSWORDS_DO_NOT_MATCH", "Passwords do not match.");
    if (newPassword.length < 8) throw new ApiError(400, "PASSWORD_TOO_WEAK", "Password must be at least 8 characters.");
    const student = await getStudentUser(studentId);
    if (!matchesPassword(student.passwordHash, currentPassword)) throw new ApiError(401, "CURRENT_PASSWORD_INCORRECT", "Current password is incorrect.");
    await prisma.student.update({ where: { id: studentId }, data: { passwordHash: newPassword } });
    return { message: "Password updated successfully", isFirstLogin: false };
  },

  async studentCurrentEnrollment(studentId: string, universityId: string) {
    const { student, semester, enrollment } = await getStudentEnrollment(studentId, universityId);
    const batch = await batchById(enrollment.batchId);
    const ay = await getAcademicYear(semester.academicYearId);
    return { id: enrollment.id, enrollmentNo: student.enrollmentNo, semesterId: semester.id, semesterLabel: semester.label, semesterNumber: semester.number, yearLevel: batch.yearLevel, batchCode: batch.code, rollNo: enrollment.rollNo, academicYear: ay.label, startDate: semester.startDate, endDate: semester.endDate };
  },

  async studentEnrollmentHistory(studentId: string) {
    const student = await getStudentUser(studentId);
    const enrollments = await prisma.studentEnrollment.findMany({ where: { studentId }, include: { semester: { include: { academicYear: true } }, batch: true }, orderBy: { semester: { number: "asc" } } });
    return {
      enrollmentNo: student.enrollmentNo, branch: student.branch, admissionYear: student.admissionYear,
      journey: enrollments.map((e) => ({ semesterNumber: e.semester.number, semesterLabel: e.semester.label, yearLevel: e.batch.yearLevel, batchCode: e.batch.code, rollNo: e.rollNo, academicYear: e.semester.academicYear.label, isCurrent: e.isCurrent, promotedFromId: e.promotedFromId ?? null })),
    };
  },

  async studentSubjects(studentId: string, universityId: string, semesterId?: string) {
    const { semester, enrollment } = await getStudentEnrollment(studentId, universityId, semesterId);
    const subjectIds = await getStudentSubjectIds(studentId, universityId, semester.id);
    const subjects = await Promise.all(
      subjectIds.map(async (subjectId) => {
        const subject = await subjectById(subjectId);
        const assignment = await prisma.facultyBatchAssignment.findFirst({ where: { batchId: enrollment.batchId, semesterId: semester.id, subjectId: subject.id } });
        const faculty = assignment ? await prisma.faculty.findUnique({ where: { id: assignment.facultyId }, select: { name: true } }) : null;
        return { id: subject.id, code: subject.code, name: subject.name, credits: subject.credits, type: subject.type, facultyName: faculty?.name ?? null };
      }),
    );
    return { semesterLabel: semester.label, subjects, totalCredits: subjects.reduce((s, sub) => s + sub.credits, 0) };
  },

  async studentTimetable(studentId: string, universityId: string, semesterId?: string) {
    const { semester, enrollment } = await getStudentEnrollment(studentId, universityId, semesterId);
    const slots = await prisma.timetableSlot.findMany({ where: { batchId: enrollment.batchId, semesterId: semester.id }, orderBy: [{ dayOfWeek: "asc" }, { slotStart: "asc" }] });
    const batch = await batchById(enrollment.batchId);
    const mappedSlots = await Promise.all(
      slots.map(async (slot) => {
        const subject = await subjectById(slot.subjectId);
        const faculty = slot.facultyId ? await prisma.faculty.findUnique({ where: { id: slot.facultyId }, select: { name: true } }) : null;
        return { id: slot.id, dayOfWeek: slot.dayOfWeek, dayLabel: DAY_LABELS[slot.dayOfWeek] ?? "", slotStart: slot.slotStart, slotEnd: slot.slotEnd, subject: { code: subject.code, name: subject.name }, faculty: { name: faculty?.name ?? "" }, room: slot.room };
      }),
    );
    return { batchCode: batch.code, semesterLabel: semester.label, slots: mappedSlots };
  },

  async studentTodayTimetable(studentId: string, universityId: string, semesterId?: string) {
    // The calendar decides whether lectures run today. Non-working day → no lectures.
    const dayStatus = await resolveDayStatus(universityId);
    const timetable = await this.studentTimetable(studentId, universityId, semesterId);
    const slots = dayStatus.isWorkingDay
      ? timetable.slots.filter((s) => s.dayOfWeek === dayStatus.dayOfWeek).map((s) => ({ id: s.id, slotStart: s.slotStart, slotEnd: s.slotEnd, subject: { code: s.subject.code }, faculty: s.faculty, room: s.room }))
      : [];
    return { date: dayStatus.date, dayLabel: dayStatus.dayLabel, dayStatus, slots };
  },

  async calendarDayStatus(universityId: string, dateStr?: string) {
    return resolveDayStatus(universityId, dateStr);
  },

  async studentResults(studentId: string, universityId: string, semesterId?: string) {
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { studentId, ...(semesterId ? { semesterId } : {}) },
      include: { semester: { include: { academicYear: true } }, batch: true },
      orderBy: { semester: { number: "desc" } },
    });
    const semesters = await Promise.all(
      enrollments.map(async (e) => {
        const phases = await prisma.phase.findMany({ where: { semesterId: e.semesterId }, orderBy: { number: "asc" } });
        const phaseData = await Promise.all(
          phases.map(async (phase) => {
            const rows = await prisma.result.findMany({ where: { enrollmentId: e.id, phaseId: phase.id, isPublished: true }, include: { subject: true } });
            const subjects = rows.map((r) => ({ subjectCode: r.subject.code, subjectName: r.subject.name, marksObtained: r.marksObtained, maxMarks: r.maxMarks, grade: r.grade, isPublished: r.isPublished, publishedAt: r.publishedAt }));
            return { phaseLabel: phase.label, phaseNumber: phase.number, subjects, phaseAvgPct: subjects.length === 0 ? null : average(subjects.map((s) => (s.marksObtained / s.maxMarks) * 100)), phaseTotalMarks: subjects.reduce((s, r) => s + r.marksObtained, 0), phaseMaxMarks: subjects.reduce((s, r) => s + r.maxMarks, 0), ...(subjects.length === 0 ? { status: "pending" } : {}) };
          }),
        );
        return {
          semesterId: e.semesterId, semesterLabel: e.semester.label, semesterNumber: e.semester.number, yearLevel: e.batch.yearLevel, batchCode: e.batch.code, academicYear: e.semester.academicYear.label, phases: phaseData,
          semesterAvgPct: average(phaseData.flatMap((p) => p.subjects.map((s) => (s.marksObtained / s.maxMarks) * 100))),
        };
      }),
    );
    const student = await getStudentUser(studentId);
    return { enrollmentNo: student.enrollmentNo, semesters };
  },

  async studentResultsSummary(studentId: string) {
    const enrollments = await prisma.studentEnrollment.findMany({ where: { studentId }, include: { semester: true, batch: true }, orderBy: { semester: { number: "asc" } } });
    const summary = await Promise.all(
      enrollments.map(async (e) => {
        const rows = await prisma.result.findMany({ where: { enrollmentId: e.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
        return { semesterNumber: e.semester.number, label: `Sem ${e.semester.number}`, yearLevel: e.batch.yearLevel, avgPct: rows.length === 0 ? null : average(rows.map((r) => (r.marksObtained / r.maxMarks) * 100)), status: e.semester.status === "ACTIVE" ? "in_progress" : "complete" };
      }),
    );
    return { summary };
  },

  async studentResultsSemester(studentId: string, semesterId: string) {
    const student = await getStudentUser(studentId);
    return this.studentResults(studentId, student.universityId, semesterId);
  },

  async studentPhaseProgress(studentId: string, universityId: string) {
    const { enrollment, semester } = await getStudentEnrollment(studentId, universityId);
    const phases = await prisma.phase.findMany({ where: { semesterId: semester.id }, orderBy: { number: "asc" } });
    return {
      semesterLabel: semester.label,
      phases: await Promise.all(phases.map(async (phase) => {
        const rows = await prisma.result.findMany({ where: { enrollmentId: enrollment.id, phaseId: phase.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
        return { label: phase.label, number: phase.number, avgPct: rows.length === 0 ? null : average(rows.map((r) => (r.marksObtained / r.maxMarks) * 100)), isPublished: rows.length > 0, examDate: phase.examDate };
      })),
    };
  },

  async studentAttendanceLog(studentId: string, universityId: string, subjectId: string, semesterId?: string) {
    await ensureStudentSubject(studentId, universityId, subjectId, semesterId);
    const { enrollment } = await getStudentEnrollment(studentId, universityId, semesterId);
    const records = await prisma.attendanceRecord.findMany({ where: { enrollmentId: enrollment.id, subjectId }, include: { faculty: { select: { name: true } } }, orderBy: { lectureDate: "asc" } });
    const subject = await subjectById(subjectId);
    return {
      subjectCode: subject.code, subjectName: subject.name, totalLectures: records.length,
      attended: records.filter((r) => r.isPresent).length,
      percentage: records.length === 0 ? 0 : Number(((records.filter((r) => r.isPresent).length / records.length) * 100).toFixed(2)),
      log: records.map((r) => ({ date: r.lectureDate.toISOString().slice(0, 10), isPresent: r.isPresent, markedBy: r.faculty.name })),
    };
  },

  async studentAttendanceHistory(studentId: string) {
    const enrollments = await prisma.studentEnrollment.findMany({ where: { studentId }, include: { semester: { include: { academicYear: true } } }, orderBy: { semester: { number: "asc" } } });
    const history = await Promise.all(enrollments.map(async (e) => ({
      semesterLabel: e.semester.label,
      academicYear: e.semester.academicYear.label,
      overallPct: await computeOverallAttendancePct(e.id),
    })));
    return { history };
  },

  // ── Student — Notes ───────────────────────────────────────

  async studentNotes(studentId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const { enrollment, semester } = await getStudentEnrollment(studentId, universityId, query.semesterId as string | undefined);
    const notes = await prisma.note.findMany({
      where: {
        deletedAt: null,
        status: "PUBLISHED", // scheduled notes stay hidden until the scheduler flips them
        universityId,
        subject: { semesterNumber: semester.number },
        targets: { some: { batchId: enrollment.batchId } },
        ...(query.subjectId ? { subjectId: query.subjectId as string } : {}),
        ...(query.search ? { OR: [{ title: { contains: String(query.search), mode: "insensitive" } }, { description: { contains: String(query.search), mode: "insensitive" } }] } : {}),
      },
      include: { subject: true, faculty: { select: { name: true } }, flashcards: { select: { id: true } } },
      orderBy: { releaseAt: "desc" },
    });
    const rows = notes.map((n) => ({
      id: n.id, subjectCode: n.subject.code, subjectName: n.subject.name, title: n.title, description: n.description,
      mimeType: n.mimeType, fileType: n.mimeType, fileUrl: n.fileUrl, fileSizeKb: n.fileSizeKb, fileSize: n.fileSizeKb,
      hasAiSummary: Boolean(n.aiSummary), hasFlashcards: n.flashcards.length > 0,
      flashcardCount: n.flashcards.length, uploadedBy: n.faculty.name, facultyName: n.faculty.name,
      subject: { code: n.subject.code, name: n.subject.name }, releaseAt: n.releaseAt, createdAt: n.createdAt,
    }));
    return paginate(rows, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async studentNoteDrive(studentId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const { enrollment, semester } = await getStudentEnrollment(studentId, universityId, query.semesterId as string | undefined);
    const subjectId = String(query.subjectId ?? "");
    if (!subjectId) throw new ApiError(400, "VALIDATION_ERROR", "subjectId is required.");
    const allowedSubjects = await getStudentSubjectIds(studentId, universityId, semester.id);
    if (!allowedSubjects.includes(subjectId)) throw new ApiError(403, "FORBIDDEN", "You do not have access to this subject.");
    await this.ensureNotePhaseFolders(universityId, subjectId);
    const parentId = query.parentId ? String(query.parentId) : null;
    if (parentId) {
      const parent = await prisma.noteFolder.findFirst({ where: { id: parentId, universityId, subjectId, deletedAt: null } });
      if (!parent) throw new ApiError(404, "NOT_FOUND", "Folder not found.");
    }
    const [subject, folders, notes] = await Promise.all([
      prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, code: true, name: true } }),
      prisma.noteFolder.findMany({ where: { universityId, subjectId, parentId, deletedAt: null }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
      prisma.note.findMany({ where: { universityId, subjectId, folderId: parentId, deletedAt: null, status: "PUBLISHED", targets: { some: { batchId: enrollment.batchId } }, ...(query.search ? { OR: [{ title: { contains: String(query.search), mode: "insensitive" } }, { description: { contains: String(query.search), mode: "insensitive" } }] } : {}) }, include: { faculty: { select: { name: true } }, flashcards: { select: { id: true } } }, orderBy: { releaseAt: "desc" } }),
    ]);
    const breadcrumbs: Array<{ id: string | null; name: string }> = [{ id: null, name: subject?.code ?? "Subject" }];
    const chain: Array<{ id: string; name: string }> = [];
    let cursor = parentId;
    while (cursor) {
      const folder = await prisma.noteFolder.findFirst({ where: { id: cursor, universityId, subjectId, deletedAt: null }, select: { id: true, name: true, parentId: true } });
      if (!folder) break;
      chain.unshift({ id: folder.id, name: folder.name });
      cursor = folder.parentId;
    }
    breadcrumbs.push(...chain);
    return {
      subject,
      breadcrumbs,
      folders: folders.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId, isSystem: folder.isSystem, createdAt: folder.createdAt })),
      files: notes.map((note) => ({ id: note.id, title: note.title, description: note.description, originalFileName: note.originalFileName, mimeType: note.mimeType, fileSizeKb: note.fileSizeKb, fileUrl: note.fileUrl, folderId: note.folderId, hasFlashcards: note.flashcards.length > 0, hasAiSummary: Boolean(note.aiSummary), uploadedBy: note.faculty.name, releaseAt: note.releaseAt, createdAt: note.createdAt })),
    };
  },

  async studentNote(studentId: string, universityId: string, noteId: string) {
    const { enrollment } = await getStudentEnrollment(studentId, universityId);
    const note = await prisma.note.findFirst({
      where: { id: noteId, universityId, deletedAt: null, status: "PUBLISHED", targets: { some: { batchId: enrollment.batchId } } },
      include: { subject: true, faculty: { select: { name: true } }, flashcards: { orderBy: { order: "asc" } } },
    });
    if (!note) throw new ApiError(404, "NOT_FOUND", "Note not found.");
    return { id: note.id, subjectCode: note.subject.code, subjectName: note.subject.name, title: note.title, description: note.description, mimeType: note.mimeType, fileUrl: note.fileUrl, fileSizeKb: note.fileSizeKb, uploadedBy: note.faculty.name, releaseAt: note.releaseAt, createdAt: note.createdAt, aiSummary: note.aiSummary, flashcards: note.flashcards };
  },

  async studentNoteDownload(studentId: string, universityId: string, noteId: string) {
    const note = await this.studentNote(studentId, universityId, noteId); // enforces batch + PUBLISHED access
    const stored = await prisma.note.findUnique({ where: { id: noteId }, select: { fileKey: true, fileUrl: true, originalFileName: true } });
    const downloadUrl = storageEnabled && stored?.fileKey ? presignGetUrl(stored.fileKey, 15 * 60) : stored?.fileUrl;
    return { downloadUrl, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), mimeType: note.mimeType, filename: stored?.originalFileName ?? `${note.title.replace(/\s+/g, "_")}_${note.subjectCode}` };
  },

  async studentNoteFlashcards(studentId: string, universityId: string, noteId: string) {
    const note = await this.studentNote(studentId, universityId, noteId);
    return { noteTitle: note.title, subjectCode: note.subjectCode, flashcards: note.flashcards, total: note.flashcards.length };
  },

  // ── Student — Self Notes ──────────────────────────────────

  async studentSelfNotes(studentId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const selfNotes = await prisma.selfNote.findMany({
      where: {
        studentId,
        deletedAt: null,
        ...(query.subjectId ? { subjectId: query.subjectId as string } : {}),
        ...(query.search ? { OR: [{ title: { contains: String(query.search), mode: "insensitive" } }, { content: { contains: String(query.search), mode: "insensitive" } }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: { student: { select: { id: true } } },
    });
    const semesterId = query.semesterId as string | undefined;
    const targetNumber = semesterId ? (await prisma.semester.findUnique({ where: { id: semesterId }, select: { number: true } }))?.number : undefined;
    const filtered = targetNumber
      ? await Promise.all(selfNotes.map(async (n) => {
          if (!n.subjectId) return n;
          const subject = await prisma.subject.findUnique({ where: { id: n.subjectId }, select: { semesterNumber: true } });
          return subject?.semesterNumber === targetNumber ? n : null;
        })).then((r) => r.filter(Boolean) as typeof selfNotes)
      : selfNotes;
    const rows = await Promise.all(filtered.map(async (n) => {
      const subject = n.subjectId ? await prisma.subject.findUnique({ where: { id: n.subjectId }, select: { code: true } }) : null;
      return { id: n.id, title: n.title, subjectCode: subject?.code ?? null, contentPreview: n.content.slice(0, 120), createdAt: n.createdAt, updatedAt: n.updatedAt };
    }));
    return paginate(rows, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async studentSelfNote(studentId: string, selfNoteId: string) {
    const note = await prisma.selfNote.findUnique({ where: { id: selfNoteId } });
    if (!note) throw new ApiError(404, "NOT_FOUND", "Self note not found.");
    if (note.studentId !== studentId) throw new ApiError(403, "STUDENT_NOT_OWNER", "Self note does not belong to this student.");
    const subject = note.subjectId ? await prisma.subject.findUnique({ where: { id: note.subjectId }, select: { code: true } }) : null;
    return { id: note.id, title: note.title, subjectId: note.subjectId, subjectCode: subject?.code ?? null, content: note.content, createdAt: note.createdAt, updatedAt: note.updatedAt };
  },

  async createStudentSelfNote(studentId: string, universityId: string, body: { title: string; subjectId?: string; content: string }) {
    if (body.subjectId) await ensureStudentSubject(studentId, universityId, body.subjectId);
    const note = await prisma.selfNote.create({ data: { studentId, subjectId: body.subjectId ?? null, title: body.title, content: body.content } });
    const subject = note.subjectId ? await prisma.subject.findUnique({ where: { id: note.subjectId }, select: { code: true } }) : null;
    return { id: note.id, title: note.title, subjectCode: subject?.code ?? null, createdAt: note.createdAt };
  },

  async updateStudentSelfNote(studentId: string, selfNoteId: string, body: { title?: string; subjectId?: string; content?: string }) {
    const note = await prisma.selfNote.findUnique({ where: { id: selfNoteId } });
    if (!note) throw new ApiError(404, "NOT_FOUND", "Self note not found.");
    if (note.studentId !== studentId) throw new ApiError(403, "STUDENT_NOT_OWNER", "Self note does not belong to this student.");
    await prisma.selfNote.update({ where: { id: selfNoteId }, data: { title: body.title ?? note.title, content: body.content ?? note.content, subjectId: body.subjectId !== undefined ? (body.subjectId || null) : note.subjectId, updatedAt: new Date() } });
    return this.studentSelfNote(studentId, selfNoteId);
  },

  async deleteStudentSelfNote(studentId: string, selfNoteId: string) {
    const note = await prisma.selfNote.findUnique({ where: { id: selfNoteId } });
    if (!note) throw new ApiError(404, "NOT_FOUND", "Self note not found.");
    if (note.studentId !== studentId) throw new ApiError(403, "STUDENT_NOT_OWNER", "Self note does not belong to this student.");
    await prisma.selfNote.update({ where: { id: selfNoteId }, data: { deletedAt: new Date() } });
  },

  // ── Student — Quizzes ─────────────────────────────────────

  async studentQuizzes(studentId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const { semester, enrollment } = await getStudentEnrollment(studentId, universityId, query.semesterId as string | undefined);
    const subjectIds = await getStudentSubjectIds(studentId, universityId, semester.id);
    const now = new Date();
    const quizzes = await prisma.quiz.findMany({ where: { isPublished: true, deletedAt: null, semesterId: semester.id, subjectId: { in: subjectIds }, targets: { some: { batchId: enrollment.batchId } } }, include: { _count: { select: { questions: true } }, attempts: { where: { studentId }, select: { score: true, submittedAt: true } } } });
    const rows = quizzes.map((quiz) => {
      const attempt = quiz.attempts[0];
      const expired = Boolean(quiz.dueDate && quiz.dueDate < now);
      const status = attempt ? "ATTEMPTED" : expired ? "EXPIRED" : "PENDING";
      return { id: quiz.id, title: quiz.title, subjectId: quiz.subjectId, semesterId: quiz.semesterId, questionCount: quiz._count.questions, timeLimitMins: quiz.timeLimitMins, isAiGenerated: quiz.isAiGenerated, dueDate: quiz.dueDate, status, attemptedAt: attempt?.submittedAt ?? null, score: attempt?.score ?? null };
    });
    return paginate(
      rows.filter((r) => !query.subjectId || r.subjectId === query.subjectId).filter((r) => !query.status || r.status === query.status).map(({ subjectId: _, semesterId: __, ...rest }) => rest),
      Number(query.page ?? 1), Number(query.limit ?? 20),
    );
  },

  async studentQuiz(studentId: string, universityId: string, quizId: string) {
    const { enrollment } = await getStudentEnrollment(studentId, universityId);
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, isPublished: true, deletedAt: null, targets: { some: { batchId: enrollment.batchId } } }, include: { _count: { select: { questions: true } } } });
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    await ensureStudentSubject(studentId, universityId, quiz.subjectId, quiz.semesterId);
    if (quiz.dueDate && quiz.dueDate < new Date()) throw new ApiError(410, "QUIZ_EXPIRED", "Quiz due date has passed.");
    const attempt = await prisma.quizAttempt.findUnique({ where: { studentId_quizId: { studentId, quizId } } });
    const subject = await subjectById(quiz.subjectId);
    return { id: quiz.id, title: quiz.title, description: quiz.description, subjectCode: subject.code, questionCount: quiz._count.questions, timeLimitMins: quiz.timeLimitMins, dueDate: quiz.dueDate, isAiGenerated: quiz.isAiGenerated, status: attempt ? "ATTEMPTED" : "PENDING", alreadyAttempted: Boolean(attempt) };
  },

  async startStudentQuiz(studentId: string, universityId: string, quizId: string) {
    const { enrollment } = await getStudentEnrollment(studentId, universityId);
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, isPublished: true, deletedAt: null, targets: { some: { batchId: enrollment.batchId } } } });
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    await ensureStudentSubject(studentId, universityId, quiz.subjectId, quiz.semesterId);
    const existing = await prisma.quizAttempt.findUnique({ where: { studentId_quizId: { studentId, quizId } } });
    if (existing) throw new ApiError(409, "ALREADY_ATTEMPTED", "Quiz already attempted.");
    if (quiz.dueDate && quiz.dueDate < new Date()) throw new ApiError(410, "QUIZ_EXPIRED", "Quiz due date has passed.");
    const questions = await prisma.question.findMany({ where: { quizId }, orderBy: { order: "asc" }, select: { id: true, order: true, text: true, options: true } });
    const startedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (quiz.timeLimitMins ?? 0) * 60000).toISOString();
    return { attemptId: `att_${Date.now()}`, quizId, title: quiz.title, timeLimitMins: quiz.timeLimitMins, startedAt, expiresAt, questions };
  },

  async submitStudentQuiz(studentId: string, universityId: string, quizId: string, answers: Record<string, string>) {
    const { enrollment } = await getStudentEnrollment(studentId, universityId);
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, isPublished: true, deletedAt: null, targets: { some: { batchId: enrollment.batchId } } } });
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    await ensureStudentSubject(studentId, universityId, quiz.subjectId, quiz.semesterId);
    const existing = await prisma.quizAttempt.findUnique({ where: { studentId_quizId: { studentId, quizId } } });
    if (existing) throw new ApiError(409, "ALREADY_SUBMITTED", "Quiz already submitted.");
    const questions = await prisma.question.findMany({ where: { quizId }, orderBy: { order: "asc" } });
    if (questions.some((q) => !answers[q.id])) throw new ApiError(400, "MISSING_ANSWERS", "Some quiz questions are unanswered.");
    const results = questions.map((q) => ({ questionId: q.id, questionText: q.text, selectedOption: answers[q.id], correctOption: q.correctOption, isCorrect: answers[q.id] === q.correctOption, explanation: q.explanation }));
    const correctCount = results.filter((r) => r.isCorrect).length;
    const score = questions.length === 0 ? 0 : Number(((correctCount / questions.length) * 100).toFixed(1));
    const attempt = await prisma.quizAttempt.create({ data: { studentId, quizId, score, answers } });
    return { attemptId: attempt.id, score, correctCount, incorrectCount: questions.length - correctCount, totalQuestions: questions.length, submittedAt: attempt.submittedAt, results };
  },

  async studentQuizResult(studentId: string, quizId: string) {
    const attempt = await prisma.quizAttempt.findUnique({ where: { studentId_quizId: { studentId, quizId } } });
    if (!attempt) throw new ApiError(404, "NOT_FOUND", "Quiz attempt not found.");
    const questions = await prisma.question.findMany({ where: { quizId }, orderBy: { order: "asc" } });
    const answers = attempt.answers as Record<string, string>;
    const results = questions.map((q) => ({ questionId: q.id, questionText: q.text, selectedOption: answers[q.id], correctOption: q.correctOption, isCorrect: answers[q.id] === q.correctOption, explanation: q.explanation }));
    const correctCount = results.filter((r) => r.isCorrect).length;
    return { attemptId: attempt.id, score: attempt.score, correctCount, incorrectCount: questions.length - correctCount, totalQuestions: questions.length, submittedAt: attempt.submittedAt, results };
  },

  async studentQuizHistory(studentId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const attempts = await prisma.quizAttempt.findMany({
      where: { studentId },
      include: { quiz: { include: { _count: { select: { questions: true } } } } },
      orderBy: { submittedAt: "desc" },
    });
    const rows = attempts
      .filter((a) => !query.subjectId || a.quiz.subjectId === query.subjectId)
      .filter((a) => !query.semesterId || a.quiz.semesterId === query.semesterId)
      .map((a) => ({ quizId: a.quizId, title: a.quiz.title, score: a.score, totalQuestions: a.quiz._count.questions, submittedAt: a.submittedAt }));
    return paginate(rows, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  // ── Student — Announcements ───────────────────────────────

  async studentAnnouncements(studentId: string, universityId: string, page = 1, limit = 20, unreadOnly = false) {
    const allAnn = await prisma.announcement.findMany({ where: { universityId, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { faculty: { select: { name: true, isHod: true } }, reads: { where: { studentId } } } });
    const visible = await Promise.all(allAnn.map(async (a) => {
      const vis = await studentAnnouncementVisible(a, studentId, universityId);
      return vis ? a : null;
    }));
    const filtered = visible.filter(Boolean) as typeof allAnn;
    const rows = await Promise.all(filtered.map(async (a) => {
      const isRead = a.reads.length > 0;
      const batch = a.scope === "BATCH" && a.scopeValue ? await prisma.batch.findUnique({ where: { id: a.scopeValue }, select: { code: true } }) : null;
      return { id: a.id, title: a.title, body: a.body, senderName: a.faculty.name, senderRole: a.faculty.isHod ? "HOD" : "FACULTY", scope: a.scope, scopeLabel: a.scope === "ALL" ? "All Students" : a.scope === "BATCH" && batch ? `Batch ${batch.code}` : a.scopeValue, isRead, createdAt: a.createdAt };
    }));
    const final = rows.filter((r) => !unreadOnly || !r.isRead);
    return { ...paginate(final, page, limit), unreadCount: rows.filter((r) => !r.isRead).length };
  },

  async studentAnnouncement(studentId: string, universityId: string, announcementId: string) {
    const a = await prisma.announcement.findUnique({ where: { id: announcementId }, include: { faculty: { select: { name: true, isHod: true } } } });
    if (!a) throw new ApiError(404, "NOT_FOUND", "Announcement not found.");
    const visible = await studentAnnouncementVisible(a, studentId, universityId);
    if (!visible) throw new ApiError(404, "NOT_FOUND", "Announcement not found.");
    const isRead = await isAnnouncementRead(studentId, announcementId);
    return { id: a.id, title: a.title, body: a.body, senderName: a.faculty.name, senderRole: a.faculty.isHod ? "HOD" : "FACULTY", scope: a.scope, isRead, createdAt: a.createdAt };
  },

  async markStudentAnnouncementRead(studentId: string, universityId: string, announcementId: string) {
    await this.studentAnnouncement(studentId, universityId, announcementId);
    const result = await prisma.announcementRead.upsert({ where: { announcementId_studentId: { announcementId, studentId } }, update: {}, create: { announcementId, studentId } });
    return { announcementId, isRead: true, readAt: result.readAt };
  },

  async markAllStudentAnnouncementsRead(studentId: string, universityId: string) {
    const allAnn = await prisma.announcement.findMany({ where: { universityId, deletedAt: null }, select: { id: true, universityId: true, scope: true, scopeValue: true, deletedAt: true } });
    const visibleIds = (await Promise.all(allAnn.map(async (a) => ((await studentAnnouncementVisible(a, studentId, universityId)) ? a.id : null)))).filter(Boolean) as string[];
    let count = 0;
    for (const announcementId of visibleIds) {
      await prisma.announcementRead.upsert({ where: { announcementId_studentId: { announcementId, studentId } }, update: {}, create: { announcementId, studentId } });
      count++;
    }
    return { markedRead: count };
  },

  async studentAnnouncementUnreadCount(studentId: string, universityId: string) {
    const allAnn = await prisma.announcement.findMany({ where: { universityId, deletedAt: null }, select: { id: true, universityId: true, scope: true, scopeValue: true, deletedAt: true } });
    const unread = (await Promise.all(allAnn.map(async (a) => {
      const vis = await studentAnnouncementVisible(a, studentId, universityId);
      if (!vis) return false;
      return !(await isAnnouncementRead(studentId, a.id));
    }))).filter(Boolean).length;
    return { unreadCount: unread };
  },

  // ── Student — Mentor / Chat ───────────────────────────────

  async studentMentor(studentId: string, universityId: string, semesterId?: string) {
    const assignment = await getStudentMentorAssignment(studentId, universityId, semesterId);
    if (!assignment) return { mentorAssignmentId: null, mentor: null, message: "No mentor has been assigned to you for this semester. Contact your HOD." };
    const mentor = await facultyById(assignment.facultyId);
    const unread = await prisma.chatMessage.count({ where: { mentorAssignmentId: assignment.id, senderRole: "FACULTY", isRead: false } });
    const lastMsg = await prisma.chatMessage.findFirst({ where: { mentorAssignmentId: assignment.id }, orderBy: { sentAt: "desc" } });
    return { mentorAssignmentId: assignment.id, mentor: { name: mentor.name, year: mentor.year, mentorCode: mentor.mentorCode, profilePhotoUrl: mentor.profilePhotoUrl }, unreadMessages: unread, lastMessageAt: lastMsg?.sentAt ?? null };
  },

  async studentMentorMessages(studentId: string, universityId: string, page = 1, limit = 30) {
    const assignment = await getStudentMentorAssignment(studentId, universityId);
    if (!assignment) throw new ApiError(404, "NO_MENTOR_ASSIGNED", "No mentor assigned.");
    const mentor = await facultyById(assignment.facultyId);
    const rows = await prisma.chatMessage.findMany({ where: { mentorAssignmentId: assignment.id }, orderBy: { sentAt: "asc" } });
    return { mentorAssignmentId: assignment.id, mentor: { name: mentor.name, mentorCode: mentor.mentorCode }, ...paginate(rows, page, limit) };
  },

  async sendStudentMentorMessage(studentId: string, universityId: string, content: string) {
    const assignment = await getStudentMentorAssignment(studentId, universityId);
    if (!assignment) throw new ApiError(404, "NO_MENTOR_ASSIGNED", "No mentor assigned.");
    if (!content.trim()) throw new ApiError(400, "EMPTY_MESSAGE", "Message cannot be empty.");
    const msg = await prisma.chatMessage.create({ data: { mentorAssignmentId: assignment.id, senderRole: "STUDENT", studentId, content: content.trim(), isRead: false } });
    return { id: msg.id, senderRole: msg.senderRole, content: msg.content, sentAt: msg.sentAt };
  },

  async markStudentMentorMessagesRead(studentId: string, universityId: string) {
    const assignment = await getStudentMentorAssignment(studentId, universityId);
    if (!assignment) throw new ApiError(404, "NO_MENTOR_ASSIGNED", "No mentor assigned.");
    const { count } = await prisma.chatMessage.updateMany({ where: { mentorAssignmentId: assignment.id, senderRole: "FACULTY", isRead: false }, data: { isRead: true } });
    return { markedRead: count };
  },

  async studentMentorUnreadCount(studentId: string, universityId: string) {
    const assignment = await getStudentMentorAssignment(studentId, universityId);
    if (!assignment) return { unreadCount: 0 };
    const count = await prisma.chatMessage.count({ where: { mentorAssignmentId: assignment.id, senderRole: "FACULTY", isRead: false } });
    return { unreadCount: count };
  },

  // ── Student — AI Conversations ────────────────────────────

  async studentAiConversations(studentId: string) {
    if (studentAiBridge.isConfigured()) {
      try {
        const chats = await studentAiBridge.listChats(studentId);
        const data = await Promise.all(chats.map(async (chat) => {
          const fullChat = await studentAiBridge.getChat(studentId, chat.chat_id).catch(() => null);
          const subject = chat.subject_id ? await prisma.subject.findUnique({ where: { id: chat.subject_id }, select: { code: true, name: true } }) : null;
          const messages = fullChat?.messages ?? [];
          return {
            id: chat.chat_id,
            title: chat.title,
            subjectCode: subject?.code ?? null,
            subjectName: subject?.name ?? "General",
            lastMessage: messages.length > 0 ? messages[messages.length - 1]?.content ?? null : null,
            messageCount: chat.message_count,
            updatedAt: chat.updated_at,
            createdAt: chat.updated_at,
          };
        }));
        return { data: data.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) };
      } catch {
        // The chat history is mirrored in Prisma; keep the UI usable if Django AI is offline.
      }
    }

    const sessions = await prisma.studentAIChatSession.findMany({
      where: { studentId, isDeleted: false },
      include: { conversation: true, subject: { select: { code: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    });
    const data = sessions.map((session) => {
      const messages = session.conversation.messages as Array<{ role: string; content: string }>;
      return {
        id: session.id,
        title: session.title,
        subjectCode: session.subject?.code ?? null,
        subjectName: session.subject?.name ?? "General",
        lastMessage: messages[messages.length - 1]?.content ?? null,
        messageCount: messages.length,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
      };
    });
    return { data };
  },

  async createStudentAiConversation(studentId: string, universityId: string, body: { subjectId?: string; initialMessage?: string; title?: string }) {
    if (body.subjectId) await ensureStudentSubject(studentId, universityId, body.subjectId);
    if (studentAiBridge.isConfigured()) {
      try {
        const created = await studentAiBridge.createChat(studentId, { title: body.title, subject_id: body.subjectId ?? null });
        return { id: created.chat_id, title: created.title, subjectId: created.subject_id, messages: created.messages, createdAt: created.created_at };
      } catch {
        // Fall back to the local mirror so creating a thread does not depend on AI service uptime.
      }
    }

    const conversation = await prisma.aIConversation.create({
      data: { studentId, subjectId: body.subjectId ?? null, messages: [] },
    });
    const session = await prisma.studentAIChatSession.create({
      data: {
        studentId,
        subjectId: body.subjectId ?? null,
        conversationId: conversation.id,
        title: body.title?.trim() || `Chat ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      },
    });
    return { id: session.id, title: session.title, subjectId: session.subjectId, messages: [], createdAt: session.createdAt };
  },

  async studentAiConversation(studentId: string, conversationId: string) {
    if (studentAiBridge.isConfigured()) {
      try {
        const chat = await studentAiBridge.getChat(studentId, conversationId);
        return {
          id: chat.chat_id,
          title: chat.title,
          subjectId: chat.subject_id,
          messages: (chat.messages ?? []).map((message, index) => ({
            id: `${conversationId}-${index}`,
            role: String(message.role).toUpperCase(),
            content: message.content,
            createdAt: new Date().toISOString(),
          })),
        };
      } catch {
        // Fall through to Prisma; this also supports older chats created while Django was down.
      }
    }

    const session = await prisma.studentAIChatSession.findFirst({
      where: { id: conversationId, studentId, isDeleted: false },
      include: { conversation: true, subject: { select: { code: true } } },
    });
    if (!session) throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
    return {
      id: session.id,
      title: session.title,
      subjectId: session.subjectId,
      subjectCode: session.subject?.code ?? null,
      messages: (session.conversation.messages as Array<{ role: string; content: string }>).map((message, index) => ({
        id: `${session.id}-${index}`,
        role: String(message.role).toUpperCase(),
        content: message.content,
        createdAt: session.updatedAt.toISOString(),
      })),
    };
  },

  async sendStudentAiMessage(studentId: string, conversationId: string, content: string) {
    if (!content.trim()) throw new ApiError(400, "EMPTY_MESSAGE", "Message cannot be empty.");
    if (studentAiBridge.isConfigured()) {
      try {
        return await studentAiBridge.sendChatMessage(studentId, conversationId, content.trim());
      } catch {
        // Save the message locally and return a structured context response if AI is unavailable.
      }
    }

    const session = await prisma.studentAIChatSession.findFirst({
      where: { id: conversationId, studentId, isDeleted: false },
      include: { conversation: true, subject: true },
    });
    if (!session) throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
    const noteInsights = await prisma.noteInsight.findMany({
      where: { note: session.subjectId ? { subjectId: session.subjectId } : undefined },
      include: { note: { select: { title: true } } },
      orderBy: { lastGeneratedAt: "desc" },
      take: 2,
    });
    const pyqAnalysis = session.subjectId
      ? await prisma.pYQAnalysis.findFirst({ where: { subjectId: session.subjectId }, orderBy: { analyzedAt: "desc" } })
      : null;
    const enrollment = await prisma.studentEnrollment.findFirst({ where: { studentId, isCurrent: true } });
    const subjectResults = session.subjectId && enrollment
      ? await prisma.result.findMany({ where: { enrollmentId: enrollment.id, subjectId: session.subjectId, isPublished: true } })
      : [];
    const subjectPct = subjectResults.length
      ? Math.round((subjectResults.reduce((sum, result) => sum + ((result.marksObtained / result.maxMarks) * 100), 0) / subjectResults.length))
      : null;

    const replyParts = [
      "AI service is not reachable right now, so I saved your message and used the available student context.",
      "",
      "Current context:",
      `- ${session.subject ? `Subject focus: ${session.subject.code} ${session.subject.name}` : "General study support"}`,
      `- ${subjectPct === null ? "No published marks are available yet for this context" : `Recent published average: ${subjectPct}%`}`,
      noteInsights.length > 0
        ? `- Relevant note summaries: ${noteInsights.map((item) => `${item.note.title}: ${item.shortSummary || "summary pending"}`).join("; ")}`
        : "- No processed faculty note insights are available yet",
      pyqAnalysis
        ? `- Recurring PYQ topics: ${Object.entries((pyqAnalysis.topicFrequencies as Record<string, number>) ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([topic]) => topic).join(", ") || "not enough PYQ data yet"}`
        : "- PYQ analysis is still building for this subject",
      "",
      `Your question: ${content.trim()}`,
    ];

    const messages = [...(session.conversation.messages as Array<{ role: string; content: string }>), { role: "user", content: content.trim() }, { role: "assistant", content: replyParts.join("\n") }];
    await prisma.aIConversation.update({ where: { id: session.conversationId }, data: { messages } });
    await prisma.studentAIChatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
    return { conversationId, reply: replyParts.join("\n") };
  },

  async deleteStudentAiConversation(studentId: string, conversationId: string) {
    if (studentAiBridge.isConfigured()) {
      try {
        await studentAiBridge.deleteChat(studentId, conversationId);
        return;
      } catch {
        // Fall through to the local mirror.
      }
    }
    const session = await prisma.studentAIChatSession.findFirst({ where: { id: conversationId, studentId, isDeleted: false } });
    if (!session) throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
    await prisma.studentAIChatSession.update({ where: { id: session.id }, data: { isDeleted: true } });
  },

  // ── Student — Leaderboard ─────────────────────────────────

  async studentLeaderboard(studentId: string, universityId: string, phaseId?: string, subjectId?: string) {
    const { enrollment, semester } = await getStudentEnrollment(studentId, universityId);
    const phase = phaseId ? await phaseById(phaseId) : await currentPhaseForSemester(semester.id);
    if (!phase) throw new ApiError(404, "PHASE_NOT_FOUND", "No phase found.");
    const batchEnrollments = await prisma.studentEnrollment.findMany({ where: { batchId: enrollment.batchId, semesterId: semester.id, isCurrent: true }, include: { student: true } });
    const leaderboard = await Promise.all(batchEnrollments.map(async (e) => {
      const rows = await prisma.result.findMany({ where: { enrollmentId: e.id, phaseId: phase.id, isPublished: true, ...(subjectId ? { subjectId } : {}) } });
      return { studentId: e.studentId, name: e.student.name, enrollmentNo: e.student.enrollmentNo, avgPct: rows.length === 0 ? 0 : average(rows.map((r) => (r.marksObtained / r.maxMarks) * 100)) };
    }));
    const sorted = leaderboard.sort((a, b) => b.avgPct - a.avgPct);
    const mapped = sorted.map((r, i) => ({ rank: i + 1, name: r.name, enrollmentNo: r.enrollmentNo, avgPct: r.avgPct, isMe: r.studentId === studentId }));
    const me = mapped.find((r) => r.isMe) ?? { rank: batchEnrollments.length, avgPct: 0 };
    const batch = await batchById(enrollment.batchId);
    return { batchCode: batch.code, phaseLabel: phase.label, myRank: me.rank, myAvgPct: me.avgPct, totalStudents: batchEnrollments.length, leaderboard: mapped.slice(0, 10) };
  },

  async studentLeaderboardMyRank(studentId: string, universityId: string, phaseId?: string) {
    const lb = await this.studentLeaderboard(studentId, universityId, phaseId);
    return { batchCode: lb.batchCode, phaseLabel: lb.phaseLabel, myRank: lb.myRank, totalStudents: lb.totalStudents, myAvgPct: lb.myAvgPct, percentile: lb.totalStudents === 0 ? 0 : Number((((lb.totalStudents - lb.myRank + 1) / lb.totalStudents) * 100).toFixed(1)) };
  },

  async studentSubjectLeaderboard(studentId: string, universityId: string, subjectId: string, phaseId?: string) {
    const board = await this.studentLeaderboard(studentId, universityId, phaseId, subjectId);
    const { enrollment, semester } = await getStudentEnrollment(studentId, universityId);
    const phase = phaseId ? await phaseById(phaseId) : await currentPhaseForSemester(semester.id);
    const myResult = phase ? await prisma.result.findFirst({ where: { enrollmentId: enrollment.id, phaseId: phase.id, subjectId, isPublished: true } }) : null;
    return { subjectCode: (await subjectById(subjectId)).code, batchCode: board.batchCode, phaseLabel: board.phaseLabel, myRank: board.myRank, myMarks: myResult?.marksObtained ?? null, maxMarks: myResult?.maxMarks ?? null, topStudents: board.leaderboard.map((r) => ({ rank: r.rank, name: r.name, marksObtained: r.avgPct, isMe: r.isMe })) };
  },

  async studentPyqAnalysis(studentId: string, universityId: string, subjectId: string) {
    await ensureStudentSubject(studentId, universityId, subjectId);
    const subject = await subjectById(subjectId);
    const { enrollment } = await getStudentEnrollment(studentId, universityId);
    const pyqFiles = await prisma.pYQFile.findMany({ where: { subjectId }, orderBy: { createdAt: "desc" } });
    const analysis = await prisma.pYQAnalysis.findFirst({ where: { subjectId, semesterId: enrollment.semesterId } });
    const insights = await prisma.pYQInsight.findMany({
      where: { subjectId, semesterId: enrollment.semesterId },
      include: { pyqFile: { select: { id: true, year: true, createdAt: true } } },
      orderBy: { updatedAt: "desc" },
    });
    if (insights.length === 0 && pyqFiles.length > 0) {
      await Promise.all(pyqFiles.slice(0, 3).map((pyqFile) => bestEffortStudentAi(() => studentAiBridge.triggerPyqProcessing(pyqFile.id))));
    }
    const topicFrequency = analysis ? Object.entries((analysis.topicFrequencies as Record<string, number>) ?? {}) : [];
    const importantTopics = topicFrequency.length > 0
      ? topicFrequency.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([topic, frequency]) => ({ topic, frequency, priority: frequency >= 5 ? "HIGH" : frequency >= 3 ? "MEDIUM" : "LOW" }))
      : uniq(insights.flatMap((insight) => [ ...((insight.topics as string[]) ?? []), ...((insight.keywords as string[]) ?? []) ])).slice(0, 6).map((topic) => ({ topic, frequency: 1, priority: "MEDIUM" }));
    const results = await prisma.result.findMany({
      where: { enrollmentId: enrollment.id, subjectId, isPublished: true },
      orderBy: { createdAt: "asc" },
    });
    const averagePct = results.length
      ? Number((results.reduce((sum, item) => sum + ((item.marksObtained / item.maxMarks) * 100), 0) / results.length).toFixed(1))
      : null;
    return {
      subjectId,
      subjectCode: subject.code,
      subjectName: subject.name,
      analyzedAt: analysis?.analyzedAt ?? insights[0]?.updatedAt ?? null,
      averagePct,
      totalPYQsAnalyzed: pyqFiles.length,
      status: insights.length > 0 || analysis ? "ready" : pyqFiles.length > 0 ? "processing" : "empty",
      importantTopics,
      weakPoints: averagePct !== null && averagePct < 60
        ? importantTopics.slice(0, 4).map((item) => `${item.topic} needs practice because your current published average is ${averagePct}%.`)
        : importantTopics.slice(0, 3).map((item) => `${item.topic} is a high-value revision area.`),
      files: insights.map((insight) => ({
        pyqId: insight.pyqFile.id,
        year: insight.pyqFile.year,
        difficulty: insight.difficulty,
        topics: insight.topics,
        keywords: insight.keywords,
        questionTypes: insight.questionTypes,
        updatedAt: insight.updatedAt,
      })),
    };
  },

  async studentSmartNoteSummary(studentId: string, universityId: string, noteId: string) {
    const note = await this.studentNote(studentId, universityId, noteId);
    const insight = await prisma.noteInsight.findUnique({ where: { noteId } });
    if (!insight || insight.status === "failed") {
      const stored = await prisma.note.findUnique({ where: { id: noteId }, select: { fileKey: true } });
      const sourceUrl = storageEnabled && stored?.fileKey ? presignGetUrl(stored.fileKey, 60 * 60) : undefined;
      await bestEffortStudentAi(() => studentAiBridge.triggerNoteProcessing(noteId, sourceUrl));
      if (!note.aiSummary) {
        return { noteId, noteTitle: note.title, subjectCode: note.subjectCode, status: "processing", summary: null, flashcards: [] };
      }
      return { noteId, noteTitle: note.title, subjectCode: note.subjectCode, status: "fallback", summary: note.aiSummary, flashcards: note.flashcards ?? [] };
    }
    return {
      noteId,
      noteTitle: note.title,
      subjectCode: note.subjectCode,
      status: insight.status,
      summary: insight.shortSummary || note.aiSummary,
      detailedNotes: insight.detailedNotes,
      bulletNotes: insight.bulletNotes,
      importantDefinitions: insight.importantDefinitions,
      keyFormulae: insight.keyFormulae,
      importantQuestions: insight.importantQuestions,
      flashcards: note.flashcards ?? [],
      generatedAt: insight.lastGeneratedAt,
    };
  },

  async studentMarksPrediction(studentId: string) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, enrollmentNo: true, name: true },
    });
    if (!student) {
      throw new ApiError(404, "NOT_FOUND", "Student not found.");
    }

    const enrollments = await prisma.studentEnrollment.findMany({
      where: { studentId: student.id },
      select: {
        id: true,
        semester: { select: { number: true } },
      },
    });
    if (enrollments.length === 0) {
      throw new ApiError(404, "INSUFFICIENT_MARKS_DATA", "Not enough marks data to generate a prediction.");
    }

    const enrollmentSemesterById = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment.semester.number]));
    const results = await prisma.result.findMany({
      where: { enrollmentId: { in: enrollments.map((enrollment) => enrollment.id) }, isPublished: true },
      select: {
        enrollmentId: true,
        marksObtained: true,
        maxMarks: true,
        phase: { select: { label: true, number: true } },
        subject: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ enrollment: { semester: { number: "asc" } } }, { subject: { name: "asc" } }, { phase: { number: "asc" } }],
    });

    if (results.length === 0) {
      throw new ApiError(404, "INSUFFICIENT_MARKS_DATA", "Not enough marks data to generate a prediction.");
    }

    const grouped = new Map<string, Array<(typeof results)[number]>>();
    for (const result of results) {
      const key = `${result.enrollmentId}:${result.subject.id}`;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(result);
      else grouped.set(key, [result]);
    }

    const predictions: Array<{
      semester: number;
      academic_year: string;
      subject_id: string;
      subject_code: string;
      subject_name: string;
      test_id: null;
      test_type: string;
      predicted_final_score: number;
      predicted_marks: number;
      max_marks: number;
      predicted_percentage: number;
      trend: string;
      confidence_note: string;
    }> = [];

    for (const group of grouped.values()) {
      const first = group[0];
      const tests = new Map<string, number>();

      for (const row of group) {
        tests.set(normalizePhaseKey(row.phase.label, row.phase.number), Number(row.marksObtained));
      }

      if (tests.has("T4") || !["T1", "T2", "T3"].every((name) => tests.has(name))) {
        continue;
      }

      const t1 = tests.get("T1") ?? 0;
      const t2 = tests.get("T2") ?? 0;
      const t3 = tests.get("T3") ?? 0;
      const scoreStd = standardDeviation([t1, t2, t3]);
      const weightedAverage = (0.25 * t1) + (0.30 * t2) + (0.45 * t3);
      const predictedScore = clamp(Number((2.0 * weightedAverage).toFixed(2)), 0, 50);

      let confidenceNote = "Low - high variation; prediction may be less accurate.";
      if (scoreStd < 2) confidenceNote = "High - consistent performance across tests.";
      else if (scoreStd < 4.5) confidenceNote = "Medium - moderate variation across tests.";

      const actualObtained = group.reduce((sum, row) => sum + Number(row.marksObtained), 0);
      const actualMax = group.reduce((sum, row) => sum + Number(row.maxMarks), 0);
      const projectedPercentage = Number((((actualObtained + predictedScore) / (actualMax + 50)) * 100).toFixed(2));
      const baselineT4 = (average([t1, t2, t3]) / 25) * 50;
      let trend = "Stable";
      if (predictedScore > baselineT4 + 2) trend = "Improving";
      else if (predictedScore < baselineT4 - 2) trend = "Declining";

      predictions.push({
        semester: enrollmentSemesterById.get(first.enrollmentId) ?? 0,
        academic_year: String(first.enrollmentId),
        subject_id: String(first.subject.id),
        subject_code: first.subject.code,
        subject_name: first.subject.name,
        test_id: null,
        test_type: "T4",
        predicted_final_score: predictedScore,
        predicted_marks: predictedScore,
        max_marks: 50,
        predicted_percentage: projectedPercentage,
        trend,
        confidence_note: confidenceNote,
      });
    }

    if (predictions.length === 0) {
      throw new ApiError(404, "INSUFFICIENT_MARKS_DATA", "Not enough marks data to generate a prediction.");
    }

    const latestSemester = Math.max(...predictions.map((prediction) => prediction.semester));
    const latestPredictions = predictions.filter((prediction) => prediction.semester === latestSemester);
    const predictedPercentage = average(latestPredictions.map((prediction) => prediction.predicted_percentage));

    return {
      student_id: String(student.id),
      enrollment_no: student.enrollmentNo,
      name: student.name,
      semester: latestSemester,
      predicted_average: to30Scale(predictedPercentage),
      predicted_percentage: predictedPercentage,
      predicted_rank: null,
      predicted_badge: performanceLabel(predictedPercentage),
      prediction_confidence: latestPredictions.length >= 3 ? "High" : "Medium",
      model_name: "Main backend prediction",
      model_r2: null,
      model_mae: null,
      model_rmse: null,
      predictions: latestPredictions,
      subject_predictions: latestPredictions,
    };
  },

  // ── Faculty Dashboard / Profile ───────────────────────────

  async facultyDashboardSummary(facultyId: string, universityId: string, semesterId?: string) {
    const faculty = await getFacultyUser(facultyId);
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const enrollments = await getFacultyVisibleEnrollments(facultyId, universityId, semesterId);
    const attendancePcts = await overallAttendancePctBulkArr(enrollments);
    const unreadMenteeMessages = await prisma.chatMessage.count({ where: { mentorAssignment: { facultyId }, senderRole: "STUDENT", isRead: false } });
    const unreadAnnouncements = await prisma.announcement.count({ where: { universityId, deletedAt: null, facultyId: { not: facultyId }, OR: [{ scope: "ALL" }, { scope: "BATCH", scopeValue: { in: scope.assignedBatchIds } }] } });
    const pending = await this.facultyAttendancePending(facultyId, universityId, semesterId);
    return {
      faculty: { id: faculty.id, name: faculty.name, mentorCode: faculty.mentorCode, year: faculty.year },
      activeSemester: { id: scope.semester.id, label: scope.semester.label, number: scope.semester.number },
      stats: { totalStudents: enrollments.length, assignedBatches: scope.assignedBatchIds.length, assignedSubjects: scope.assignedSubjectIds.length, totalMentees: scope.mentorAssignments.length, avgAttendance: { value: average(attendancePcts), trend: "neutral", deltaLabel: "Current average" }, pendingAttendance: pending.count, unreadMenteeMessages, unreadAnnouncements },
    };
  },

  async facultyProfile(facultyId: string) {
    const f = await getFacultyUser(facultyId);
    return { id: f.id, employeeId: f.employeeId, name: f.name, email: f.email, phone: f.phone, year: f.year, isHod: f.isHod, mentorCode: f.mentorCode, profilePhotoUrl: f.profilePhotoUrl, isActive: f.isActive, createdAt: f.createdAt };
  },

  async updateFacultyProfile(facultyId: string, body: Record<string, string>) {
    if ("email" in body || "year" in body) throw new ApiError(400, "VALIDATION_ERROR", "email and year are read-only.");
    await prisma.faculty.update({ where: { id: facultyId }, data: { name: body.name, phone: body.phone ?? null } });
    return this.facultyProfile(facultyId);
  },

  async changeFacultyPassword(facultyId: string, currentPassword: string, newPassword: string, confirmPassword: string) {
    if (newPassword !== confirmPassword) throw new ApiError(400, "PASSWORDS_DO_NOT_MATCH", "Passwords do not match.");
    return this.changePassword(facultyId, currentPassword, newPassword);
  },

  async facultySessions(facultyId: string) {
    return this.securitySessions(facultyId);
  },

  async revokeFacultySession(facultyId: string, sessionId: string) {
    const token = await prisma.refreshToken.findFirst({ where: { id: sessionId, facultyId } });
    if (!token) throw new ApiError(404, "NOT_FOUND", "Session not found.");
    await this.revokeSession(sessionId);
  },

  async facultyActivityFeed(facultyId: string, page = 1, limit = 10) {
    const rows = await prisma.activityLog.findMany({ where: { facultyId }, orderBy: { createdAt: "desc" } });
    return paginate(rows.map((r) => ({ id: r.id, type: r.type, title: r.title, description: r.description, createdAt: r.createdAt })), page, limit);
  },

  async facultyMyScope(facultyId: string, universityId: string, semesterId?: string) {
    const faculty = await getFacultyUser(facultyId);
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const assignments = await Promise.all(scope.assignments.map(async (a) => {
      const subject = a.subjectId ? await subjectById(a.subjectId) : null;
      const batch = await batchById(a.batchId);
      const studentCount = await prisma.studentEnrollment.count({ where: { batchId: a.batchId, semesterId: scope.semester.id, isCurrent: true } });
      return { id: a.id, subject: subject ? { id: subject.id, code: subject.code, name: subject.name, type: subject.type } : null, batch: { id: batch.id, code: batch.code, yearLevel: batch.yearLevel }, studentCount };
    }));
    const enrollments = await getFacultyVisibleEnrollments(facultyId, universityId, semesterId);
    return {
      activeSemester: { id: scope.semester.id, label: scope.semester.label, number: scope.semester.number, yearLevel: scope.semester.yearLevel },
      assignments: assignments.filter((a) => a.subject !== null),
      uniqueBatches: await Promise.all(scope.assignedBatchIds.map(async (id) => ({ id, code: (await batchById(id)).code }))),
      uniqueSubjects: await Promise.all(scope.assignedSubjectIds.map(async (id) => ({ id, code: (await subjectById(id)).code }))),
      totalStudents: enrollments.length,
      mentorCode: faculty.mentorCode,
    };
  },

  // ── Faculty — Timetable ───────────────────────────────────

  async facultyTimetable(facultyId: string, universityId: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const slots = await prisma.timetableSlot.findMany({ where: { facultyId, semesterId: scope.semester.id }, orderBy: [{ dayOfWeek: "asc" }, { slotStart: "asc" }] });
    const mappedSlots = await Promise.all(slots.map(async (slot) => {
      const subject = await subjectById(slot.subjectId);
      const batch = await batchById(slot.batchId);
      return { id: slot.id, dayOfWeek: slot.dayOfWeek, dayLabel: DAY_LABELS[slot.dayOfWeek] ?? "", slotStart: slot.slotStart, slotEnd: slot.slotEnd, subject: { code: subject.code, name: subject.name }, batch: { code: batch.code }, room: slot.room };
    }));
    return { semesterLabel: scope.semester.label, slots: mappedSlots };
  },

  async facultyTodayTimetable(facultyId: string, universityId: string, semesterId?: string) {
    const dayStatus = await resolveDayStatus(universityId);
    const isoDate = dayStatus.date;
    // Non-working day → no lectures to teach or mark.
    if (!dayStatus.isWorkingDay) return { date: isoDate, dayLabel: dayStatus.dayLabel, dayStatus, slots: [] };
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const slots = await prisma.timetableSlot.findMany({ where: { facultyId, semesterId: scope.semester.id, dayOfWeek: dayStatus.dayOfWeek } });
    const mappedSlots = await Promise.all(slots.map(async (slot) => {
      const subject = await subjectById(slot.subjectId);
      const batch = await batchById(slot.batchId);
      const attendanceMarked = await prisma.attendanceRecord.findFirst({ where: { subjectId: slot.subjectId, enrollment: { batchId: slot.batchId }, lectureDate: new Date(isoDate), facultyId } });
      return { id: slot.id, slotStart: slot.slotStart, slotEnd: slot.slotEnd, subject: { code: subject.code }, batch: { code: batch.code }, attendanceMarked: Boolean(attendanceMarked) };
    }));
    return { date: isoDate, dayLabel: dayStatus.dayLabel, dayStatus, slots: mappedSlots };
  },

  // ── Faculty — Students ────────────────────────────────────

  async facultyStudents(facultyId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const scope = await getFacultyScopeData(facultyId, universityId, query.semesterId as string | undefined);
    const batchId = query.batchId as string | undefined;
    const subjectId = query.subjectId as string | undefined;
    if (batchId) await ensureFacultyAssignedBatch(facultyId, universityId, batchId, scope.semester.id);
    if (subjectId) await ensureFacultyAssignedSubject(facultyId, universityId, subjectId, scope.semester.id);
    const enrollments = await getFacultyVisibleEnrollments(facultyId, universityId, scope.semester.id);
    const rules = await getAttendanceRules(universityId);
    const rows = await Promise.all(
      enrollments.filter((e) => !batchId || e.batchId === batchId).map(async (e) => {
        const student = await prisma.student.findUnique({ where: { id: e.studentId } })!;
        const batch = await batchById(e.batchId);
        const attendancePct = await computeOverallAttendancePct(e.id);
        const results = await prisma.result.findMany({ where: { enrollmentId: e.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
        const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
        const status = !student?.isActive ? "INACTIVE" : attendancePct < rules.minThresholdPct || avgMarksPct < 40 ? "AT_RISK" : "ACTIVE";
        return { enrollmentNo: student?.enrollmentNo ?? "", name: student?.name ?? "", branch: student?.branch ?? "", currentBatch: { code: batch.code }, rollNo: e.rollNo, attendancePct, status };
      }),
    );
    const search = query.search as string | undefined;
    return paginate(rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.enrollmentNo.includes(search)).filter((r) => !query.status || r.status === query.status), Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  // Faculty exports reuse the scoped list queries above, so a faculty can only ever
  // export the batches/subjects they are assigned to.
  async facultyStudentsExport(facultyId: string, universityId: string, query: Record<string, string | number | undefined>): Promise<ExportTable> {
    const { data } = await this.facultyStudents(facultyId, universityId, { ...query, page: 1, limit: 5000 });
    return {
      title: "My Students",
      subtitle: `${data.length} student(s) · exported ${new Date().toLocaleString("en-IN")}`,
      headers: ["Enrollment No", "Name", "Branch", "Batch", "Roll No", "Attendance %", "Status"],
      rows: data.map((r: any) => [r.enrollmentNo, r.name, r.branch, r.currentBatch?.code ?? "", r.rollNo, Math.round(r.attendancePct), r.status]),
    };
  },

  async facultyResultsExport(facultyId: string, universityId: string, query: Record<string, string | number | undefined>): Promise<ExportTable> {
    const { data } = await this.facultyResults(facultyId, universityId, { ...query, page: 1, limit: 5000 });
    return {
      title: "Results",
      subtitle: `${data.length} record(s) · exported ${new Date().toLocaleString("en-IN")}`,
      headers: ["Enrollment No", "Student", "Batch", "Subject", "Phase", "Marks", "Max", "Grade", "Published"],
      rows: data.map((r: any) => [r.enrollmentNo, r.studentName, r.batchCode, r.subjectCode, r.phase, r.marksObtained, r.maxMarks, r.grade ?? "", r.isPublished ? "Yes" : "No"]),
    };
  },

  async facultyStudentProfile(facultyId: string, universityId: string, enrollmentNo: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const student = await studentByEnrollmentNo(enrollmentNo);
    const enrollment = await currentEnrollmentForStudent(student.id, scope.semester.id);
    if (!enrollment || !scope.assignedBatchIds.includes(enrollment.batchId)) throw new ApiError(403, "STUDENT_NOT_IN_ASSIGNED_BATCH", "Student is not in your assigned batch.");
    const batch = await batchById(enrollment.batchId);
    const attendancePct = await computeOverallAttendancePct(enrollment.id);
    const results = await prisma.result.findMany({ where: { enrollmentId: enrollment.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
    const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
    const rules = await getAttendanceRules(universityId);
    const status = !student.isActive ? "INACTIVE" : attendancePct < rules.minThresholdPct || avgMarksPct < 40 ? "AT_RISK" : "ACTIVE";
    return { enrollmentNo: student.enrollmentNo, name: student.name, branch: student.branch, rollNo: enrollment.rollNo, currentBatch: { code: batch.code }, currentSemester: { label: scope.semester.label }, phone: student.phone, attendancePct, status, isMentee: scope.mentorStudentIds.includes(student.id) };
  },

  async facultyStudentAttendance(facultyId: string, universityId: string, enrollmentNo: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const student = await studentByEnrollmentNo(enrollmentNo);
    const enrollment = await currentEnrollmentForStudent(student.id, scope.semester.id);
    if (!enrollment || !scope.assignedBatchIds.includes(enrollment.batchId)) throw new ApiError(403, "STUDENT_NOT_IN_ASSIGNED_BATCH", "Student is not in your assigned batch.");
    const rules = await getAttendanceRules(universityId);
    const subjects = await Promise.all(scope.assignedSubjectIds.map(async (subjectId) => {
      const subject = await subjectById(subjectId);
      const records = await prisma.attendanceRecord.findMany({ where: { subjectId, enrollmentId: enrollment.id }, select: { isPresent: true, lectureDate: true } });
      const total = records.length; const attended = records.filter((r) => r.isPresent).length;
      return { subjectCode: subject.code, totalLectures: total, attended, percentage: total === 0 ? 0 : Number(((attended / total) * 100).toFixed(2)), isBelowThreshold: total === 0 ? false : (attended / total) * 100 < rules.minThresholdPct, lectureLog: records.map((r) => ({ date: r.lectureDate.toISOString().slice(0, 10), isPresent: r.isPresent })) };
    }));
    return { enrollmentNo: student.enrollmentNo, name: student.name, subjects };
  },

  async facultyStudentResults(facultyId: string, universityId: string, enrollmentNo: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const student = await studentByEnrollmentNo(enrollmentNo);
    const enrollment = await currentEnrollmentForStudent(student.id, scope.semester.id);
    if (!enrollment || !scope.assignedBatchIds.includes(enrollment.batchId)) throw new ApiError(403, "STUDENT_NOT_IN_ASSIGNED_BATCH", "Student is not in your assigned batch.");
    const results = await prisma.result.findMany({ where: { enrollmentId: enrollment.id, subjectId: { in: scope.assignedSubjectIds } }, include: { phase: true, subject: true } });
    return { enrollmentNo: student.enrollmentNo, name: student.name, results: results.map((r) => ({ phase: r.phase.label, subjectCode: r.subject.code, marksObtained: r.marksObtained, maxMarks: r.maxMarks, grade: r.grade, isPublished: r.isPublished })) };
  },

  // ── Faculty — Attendance ──────────────────────────────────

  async facultyAttendancePending(facultyId: string, universityId: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const today = new Date().toISOString().slice(0, 10);
    const slots = await prisma.timetableSlot.findMany({ where: { facultyId, semesterId: scope.semester.id } });
    const pending = await Promise.all(slots.map(async (slot) => {
      const alreadyMarked = await prisma.attendanceRecord.findFirst({ where: { subjectId: slot.subjectId, enrollment: { batchId: slot.batchId }, lectureDate: new Date(today), facultyId } });
      if (alreadyMarked) return null;
      const subject = await subjectById(slot.subjectId);
      const batch = await batchById(slot.batchId);
      return { subjectCode: subject.code, batchCode: batch.code, lectureDateScheduled: today, slotStart: slot.slotStart, slotEnd: slot.slotEnd };
    }));
    const filtered = pending.filter(Boolean) as Array<{ subjectCode: string; batchCode: string; lectureDateScheduled: string; slotStart: string; slotEnd: string }>;
    return { pending: filtered, count: filtered.length };
  },

  async facultyAttendanceSession(facultyId: string, universityId: string, subjectId: string, batchId: string, date: string) {
    await ensureFacultyAssignedBatch(facultyId, universityId, batchId);
    await ensureFacultyAssignedSubject(facultyId, universityId, subjectId);
    const enrollments = await getFacultyVisibleEnrollments(facultyId, universityId);
    const batchEnrollments = enrollments.filter((e) => e.batchId === batchId);
    const lectureDate = new Date(date);
    const existing = await prisma.attendanceRecord.findMany({ where: { subjectId, enrollment: { batchId }, lectureDate } });
    const subject = await subjectById(subjectId);
    const batch = await batchById(batchId);
    return {
      subjectCode: subject.code, subjectName: subject.name, batchCode: batch.code, date, existingRecord: existing.length > 0,
      students: await Promise.all(batchEnrollments.map(async (e) => {
        const student = await prisma.student.findUnique({ where: { id: e.studentId }, select: { enrollmentNo: true, name: true } });
        const existingRow = existing.find((r) => r.enrollmentId === e.id);
        const attendancePct = await computeOverallAttendancePct(e.id);
        return { enrollmentId: e.id, enrollmentNo: student?.enrollmentNo ?? "", name: student?.name ?? "", rollNo: e.rollNo, isPresent: existingRow?.isPresent ?? null, attendancePctSoFar: attendancePct };
      })),
    };
  },

  async updateFacultyAttendance(body: { subjectId: string; batchId: string; lectureDate: string; corrections: Array<{ enrollmentId: string; isPresent: boolean; remarks?: string }> }, facultyId: string, universityId: string) {
    await ensureFacultyAssignedBatch(facultyId, universityId, body.batchId);
    await ensureFacultyAssignedSubject(facultyId, universityId, body.subjectId);
    const lectureDate = new Date(body.lectureDate);
    const existing = await prisma.attendanceRecord.findMany({ where: { subjectId: body.subjectId, enrollment: { batchId: body.batchId }, lectureDate } });
    if (existing.length === 0) throw new ApiError(404, "ATTENDANCE_NOT_YET_MARKED", "Attendance was not marked yet.");
    if (existing.some((r) => r.isLocked)) throw new ApiError(403, "ATTENDANCE_RECORD_LOCKED", "Attendance record is locked.");
    for (const correction of body.corrections) {
      const row = existing.find((r) => r.enrollmentId === correction.enrollmentId);
      if (row) await prisma.attendanceRecord.update({ where: { id: row.id }, data: { isPresent: correction.isPresent, remarks: correction.remarks, updatedAt: new Date() } });
    }
    const subject = await subjectById(body.subjectId);
    return { corrected: body.corrections.length, lectureDate: body.lectureDate, subjectCode: subject.code };
  },

  async deleteFacultyAttendance(facultyId: string, universityId: string, subjectId: string, batchId: string, date: string) {
    await ensureFacultyAssignedBatch(facultyId, universityId, batchId);
    await ensureFacultyAssignedSubject(facultyId, universityId, subjectId);
    const lectureDate = new Date(date);
    const rows = await prisma.attendanceRecord.findMany({ where: { subjectId, enrollment: { batchId }, lectureDate } });
    if (rows.some((r) => r.isLocked)) throw new ApiError(403, "ATTENDANCE_RECORD_LOCKED", "Attendance record is locked.");
    const { count } = await prisma.attendanceRecord.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return { deletedCount: count, lectureDate: date };
  },

  async facultyAttendanceSummary(facultyId: string, universityId: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const rules = await getAttendanceRules(universityId);
    // ponytail: full-access — summarise every attendance record THIS faculty marked, across ANY of
    // the HOD's batches (not just formally-assigned ones), so nothing they mark goes missing here.
    const allRecords = await prisma.attendanceRecord.findMany({
      where: { facultyId },
      select: { isPresent: true, lectureDate: true, subjectId: true, enrollmentId: true, enrollment: { select: { batchId: true } } },
    });
    // Subject × batch rollup, derived from what was actually marked.
    const groups = new Map<string, typeof allRecords>();
    for (const r of allRecords) { const k = `${r.subjectId}|${r.enrollment.batchId}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    const bySubjectAndBatch = await Promise.all([...groups.entries()].map(async ([key, rows]) => {
      const [subjectId, batchId] = key.split("|");
      const subject = await subjectById(subjectId);
      const batch = await batchById(batchId);
      const byStudent = new Map<string, { p: number; t: number }>();
      for (const r of rows) { const e = byStudent.get(r.enrollmentId) ?? { p: 0, t: 0 }; e.t++; if (r.isPresent) e.p++; byStudent.set(r.enrollmentId, e); }
      const pcts = [...byStudent.values()].map((v) => (v.t ? (v.p / v.t) * 100 : 0));
      return { subjectCode: subject.code, batchCode: batch.code, totalStudents: byStudent.size, avgAttendancePct: average(pcts), belowThresholdCount: pcts.filter((p) => p < rules.minThresholdPct).length, totalLecturesMarked: new Set(rows.map((r) => r.lectureDate.toISOString().slice(0, 10))).size };
    }));
    const pctOf = (rows: { isPresent: boolean }[]) => rows.length === 0 ? 0 : Number(((rows.filter((r) => r.isPresent).length / rows.length) * 100).toFixed(1));
    // daily — last 7 lecture days
    const dayGroups = new Map<string, { isPresent: boolean }[]>();
    for (const r of allRecords) { const k = r.lectureDate.toISOString().slice(0, 10); (dayGroups.get(k) ?? dayGroups.set(k, []).get(k)!).push(r); }
    const daily = [...dayGroups.entries()].sort().slice(-7).map(([date, rows]) => ({ date, pct: pctOf(rows), lectures: rows.length }));
    // weekly — last 8 ISO weeks (Mon-anchored)
    const weekKey = (d: Date) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow); return t.toISOString().slice(0, 10); };
    const weekGroups = new Map<string, { isPresent: boolean }[]>();
    for (const r of allRecords) { const k = weekKey(r.lectureDate); (weekGroups.get(k) ?? weekGroups.set(k, []).get(k)!).push(r); }
    const weekly = [...weekGroups.entries()].sort().slice(-8).map(([weekStart, rows]) => ({ weekStart, pct: pctOf(rows), lectures: rows.length }));
    const overall = { totalLectures: new Set(allRecords.map((r) => r.lectureDate.toISOString().slice(0, 10))).size, avgAttendancePct: pctOf(allRecords) };
    bySubjectAndBatch.sort((a, b) => a.batchCode.localeCompare(b.batchCode) || a.subjectCode.localeCompare(b.subjectCode));
    return { semesterLabel: scope.semester.label, bySubjectAndBatch, daily, weekly, overall };
  },

  async facultyAttendanceLectureLog(facultyId: string, universityId: string, subjectId: string, batchId: string, semesterId?: string) {
    await ensureFacultyAssignedBatch(facultyId, universityId, batchId, semesterId);
    await ensureFacultyAssignedSubject(facultyId, universityId, subjectId, semesterId);
    const records = await prisma.attendanceRecord.findMany({ where: { subjectId, enrollment: { batchId } }, orderBy: { lectureDate: "asc" } });
    const dateMap = new Map<string, typeof records>();
    for (const r of records) {
      const d = r.lectureDate.toISOString().slice(0, 10);
      if (!dateMap.has(d)) dateMap.set(d, []);
      dateMap.get(d)!.push(r);
    }
    const lectures = Array.from(dateMap.entries()).map(([date, rows]) => ({ date, presentCount: rows.filter((r) => r.isPresent).length, absentCount: rows.filter((r) => !r.isPresent).length, isLocked: rows.every((r) => r.isLocked) }));
    const subject = await subjectById(subjectId);
    const batch = await batchById(batchId);
    return { subjectCode: subject.code, batchCode: batch.code, lectures, totalLectures: lectures.length };
  },

  async facultyAttendanceBelowThreshold(facultyId: string, universityId: string, semesterId?: string, subjectId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const rules = await getAttendanceRules(universityId);
    if (subjectId) await ensureFacultyAssignedSubject(facultyId, universityId, subjectId, scope.semester.id);
    const filteredSubjectIds = subjectId ? [subjectId] : scope.assignedSubjectIds;
    const enrollments = await getFacultyVisibleEnrollments(facultyId, universityId, scope.semester.id);
    const data = (await Promise.all(enrollments.flatMap(async (e) =>
      Promise.all(filteredSubjectIds.map(async (sid) => {
        const student = await prisma.student.findUnique({ where: { id: e.studentId }, select: { enrollmentNo: true, name: true } });
        const batch = await batchById(e.batchId);
        const subject = await subjectById(sid);
        const pct = await computeAttendancePct(e.id, sid);
        return { enrollmentNo: student?.enrollmentNo ?? "", name: student?.name ?? "", batchCode: batch.code, subjectCode: subject.code, attendancePct: pct, isMentee: scope.mentorStudentIds.includes(e.studentId) };
      })),
    ))).flat().filter((r) => r.attendancePct < rules.minThresholdPct);
    return { threshold: rules.minThresholdPct, data, total: data.length };
  },

  // ── Faculty — Notes ───────────────────────────────────────

  async ensureNotePhaseFolders(universityId: string, subjectId: string) {
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, universityId, deletedAt: null }, select: { id: true } });
    if (!subject) throw new ApiError(404, "NOT_FOUND", "Subject not found.");
    const phases = ["T-1", "T-2", "T-3", "T-4"];
    for (const name of phases) {
      const exists = await prisma.noteFolder.findFirst({ where: { universityId, subjectId, parentId: null, name, deletedAt: null } });
      if (!exists) await prisma.noteFolder.create({ data: { universityId, subjectId, name, isSystem: true } });
    }
  },

  async facultyNoteDrive(facultyId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const subjectId = String(query.subjectId ?? "");
    if (!subjectId) throw new ApiError(400, "VALIDATION_ERROR", "subjectId is required.");
    const semester = await facultyActiveSemester(facultyId, universityId);
    await ensureFacultyAssignedSubject(facultyId, universityId, subjectId, semester.id);
    await this.ensureNotePhaseFolders(universityId, subjectId);
    const parentId = query.parentId ? String(query.parentId) : null;
    if (parentId) {
      const parent = await prisma.noteFolder.findFirst({ where: { id: parentId, universityId, subjectId, deletedAt: null } });
      if (!parent) throw new ApiError(404, "NOT_FOUND", "Folder not found.");
    }
    const [subject, folders, notes] = await Promise.all([
      prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, code: true, name: true } }),
      prisma.noteFolder.findMany({ where: { universityId, subjectId, parentId, deletedAt: null }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
      prisma.note.findMany({ where: { universityId, facultyId, subjectId, folderId: parentId, deletedAt: null }, include: { _count: { select: { flashcards: true } } }, orderBy: { createdAt: "desc" } }),
    ]);
    const breadcrumbs: Array<{ id: string | null; name: string }> = [{ id: null, name: subject?.code ?? "Subject" }];
    const chain: Array<{ id: string; name: string }> = [];
    let cursor = parentId;
    while (cursor) {
      const folder = await prisma.noteFolder.findFirst({ where: { id: cursor, universityId, subjectId, deletedAt: null }, select: { id: true, name: true, parentId: true } });
      if (!folder) break;
      chain.unshift({ id: folder.id, name: folder.name });
      cursor = folder.parentId;
    }
    breadcrumbs.push(...chain);
    return {
      subject,
      breadcrumbs,
      folders: folders.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId, isSystem: folder.isSystem, createdAt: folder.createdAt })),
      files: notes.map((note) => ({ id: note.id, title: note.title, description: note.description, originalFileName: note.originalFileName, mimeType: note.mimeType, fileSizeKb: note.fileSizeKb, fileUrl: note.fileUrl, folderId: note.folderId, status: note.status, releaseAt: note.releaseAt, hasFlashcards: note._count.flashcards > 0, hasAiSummary: Boolean(note.aiSummary), createdAt: note.createdAt })),
    };
  },

  async createFacultyNoteFolder(facultyId: string, universityId: string, body: { subjectId: string; parentId?: string | null; name: string }) {
    const semester = await facultyActiveSemester(facultyId, universityId);
    await ensureFacultyAssignedSubject(facultyId, universityId, body.subjectId, semester.id);
    const name = body.name.trim();
    if (!name || name.length > 80) throw new ApiError(400, "VALIDATION_ERROR", "Folder name must be 1–80 characters.");
    const parentId = body.parentId || null;
    if (parentId) {
      const parent = await prisma.noteFolder.findFirst({ where: { id: parentId, universityId, subjectId: body.subjectId, deletedAt: null } });
      if (!parent) throw new ApiError(404, "NOT_FOUND", "Parent folder not found.");
    }
    const duplicate = await prisma.noteFolder.findFirst({ where: { universityId, subjectId: body.subjectId, parentId, name, deletedAt: null } });
    if (duplicate) throw new ApiError(409, "DUPLICATE_FOLDER", "A folder with this name already exists here.");
    return prisma.noteFolder.create({ data: { universityId, subjectId: body.subjectId, parentId, name, isSystem: false }, select: { id: true, name: true, parentId: true, isSystem: true, createdAt: true } });
  },

  async renameFacultyNoteFolder(facultyId: string, universityId: string, folderId: string, name: string) {
    const folder = await prisma.noteFolder.findFirst({ where: { id: folderId, universityId, deletedAt: null } });
    if (!folder) throw new ApiError(404, "NOT_FOUND", "Folder not found.");
    const semester = await facultyActiveSemester(facultyId, universityId);
    await ensureFacultyAssignedSubject(facultyId, universityId, folder.subjectId, semester.id);
    if (folder.isSystem) throw new ApiError(400, "SYSTEM_FOLDER", "T-1 to T-4 folders cannot be renamed.");
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new ApiError(400, "VALIDATION_ERROR", "Folder name must be 1–80 characters.");
    return prisma.noteFolder.update({ where: { id: folderId }, data: { name: trimmed }, select: { id: true, name: true, parentId: true, isSystem: true } });
  },

  async deleteFacultyNoteFolder(facultyId: string, universityId: string, folderId: string) {
    const folder = await prisma.noteFolder.findFirst({ where: { id: folderId, universityId, deletedAt: null } });
    if (!folder) throw new ApiError(404, "NOT_FOUND", "Folder not found.");
    const semester = await facultyActiveSemester(facultyId, universityId);
    await ensureFacultyAssignedSubject(facultyId, universityId, folder.subjectId, semester.id);
    if (folder.isSystem) throw new ApiError(400, "SYSTEM_FOLDER", "T-1 to T-4 folders cannot be deleted.");
    const [children, notes] = await Promise.all([prisma.noteFolder.count({ where: { parentId: folderId, deletedAt: null } }), prisma.note.count({ where: { folderId, deletedAt: null } })]);
    if (children || notes) throw new ApiError(409, "FOLDER_NOT_EMPTY", "Move or delete the files and subfolders first.");
    await prisma.noteFolder.update({ where: { id: folderId }, data: { deletedAt: new Date() } });
  },

  async validateFacultyNoteFolder(facultyId: string, universityId: string, subjectId: string, folderId?: string | null) {
    if (!folderId) return null;
    const folder = await prisma.noteFolder.findFirst({ where: { id: folderId, universityId, subjectId, deletedAt: null }, select: { id: true } });
    if (!folder) throw new ApiError(400, "INVALID_FOLDER", "Folder does not belong to this subject.");
    const semester = await facultyActiveSemester(facultyId, universityId);
    await ensureFacultyAssignedSubject(facultyId, universityId, subjectId, semester.id);
    return folder.id;
  },

  async facultyNotes(facultyId: string, query: Record<string, string | number | undefined>) {
    const notes = await prisma.note.findMany({
      where: { facultyId, deletedAt: null, ...(query.subjectId ? { subjectId: query.subjectId as string } : {}) },
      include: { subject: { select: { code: true, name: true } }, targets: { include: { batch: { select: { code: true } } } }, _count: { select: { flashcards: true } } },
      orderBy: { createdAt: "desc" },
    });
    const rows = notes.map((n) => ({ id: n.id, subject: n.subject, title: n.title, description: n.description, fileUrl: n.fileUrl, mimeType: n.mimeType, fileSize: n.fileSizeKb, fileType: n.mimeType, folderId: n.folderId, batchCodes: n.targets.map((target) => target.batch.code), status: n.status, releaseAt: n.releaseAt, aiSummaryStatus: n.aiSummary ? "complete" : "pending", hasFlashcards: n._count.flashcards > 0, createdAt: n.createdAt }));
    return paginate(rows, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async getFacultyNote(facultyId: string, noteId: string) {
    const note = await prisma.note.findFirst({ where: { id: noteId, facultyId, deletedAt: null }, include: { subject: { select: { code: true } }, targets: { include: { batch: { select: { id: true, code: true } } } }, flashcards: { orderBy: { order: "asc" } } } });
    if (!note) throw new ApiError(404, "NOT_FOUND", "Note not found.");
    return { id: note.id, subjectCode: note.subject.code, title: note.title, description: note.description, fileUrl: note.fileUrl, mimeType: note.mimeType, fileSizeKb: note.fileSizeKb, batchIds: note.targets.map((target) => target.batch.id), batchCodes: note.targets.map((target) => target.batch.code), status: note.status, releaseAt: note.releaseAt, aiSummary: note.aiSummary, flashcards: note.flashcards, createdAt: note.createdAt };
  },

  // Browser posts the file (multipart) here; the backend uploads bytes to Supabase S3 and stores metadata.
  async createFacultyNote(facultyId: string, universityId: string, fileBuffer: Buffer | undefined, fileMeta: { originalname?: string; mimetype?: string; size?: number }, body: Record<string, string>) {
    if (!fileBuffer) throw new ApiError(400, "VALIDATION_ERROR", "File is required.");
    const subjectId = String(body.subjectId);
    const semester = await facultyActiveSemester(facultyId, universityId);
    await ensureFacultyAssignedSubject(facultyId, universityId, subjectId, semester.id);
    const batchIds = await validateFacultyContentTargets(facultyId, universityId, subjectId, semester.id, parseBatchIds(body.batchIds));
    const { status, releaseAt } = resolveRelease(body.releaseAt);
    const mimeType = fileMeta.mimetype ?? "application/octet-stream";
    const fileKey = `notes/${universityId}/${facultyId}/${Date.now()}-${(fileMeta.originalname ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await uploadObject(fileKey, fileBuffer, mimeType);
    const note = await prisma.note.create({
      data: {
        subjectId, facultyId, universityId, folderId: await this.validateFacultyNoteFolder(facultyId, universityId, subjectId, body.folderId), title: String(body.title), description: body.description ?? null,
        fileUrl: objectUrl(fileKey), fileKey, originalFileName: fileMeta.originalname ?? null,
        mimeType, fileSizeKb: Math.round((fileMeta.size ?? fileBuffer.length) / 1024),
        status, releaseAt, targets: { create: batchIds.map((batchId) => ({ batchId })) },
      },
    });
    await bestEffortStudentAi(() => studentAiBridge.triggerNoteProcessing(note.id, storageEnabled ? presignGetUrl(note.fileKey, 60 * 60) : undefined));
    if (status === "PUBLISHED") await this.notifyNotePublished(note.id);
    return { id: note.id, title: note.title, fileUrl: note.fileUrl, status, releaseAt, message: status === "SCHEDULED" ? "Note scheduled." : "Note published." };
  },

  // Browser posts the PYQ paper (multipart); backend stores it and hands it to the AI service for topic analysis.
  async facultyUploadPyq(facultyId: string, universityId: string, fileBuffer: Buffer | undefined, fileMeta: { originalname?: string; mimetype?: string; size?: number }, body: Record<string, string>) {
    if (!fileBuffer) throw new ApiError(400, "VALIDATION_ERROR", "File is required.");
    const subjectId = String(body.subjectId ?? "");
    const year = String(body.year ?? "").trim();
    if (!subjectId) throw new ApiError(400, "VALIDATION_ERROR", "Subject is required.");
    if (!year) throw new ApiError(400, "VALIDATION_ERROR", "Year is required.");
    const semester = await facultyActiveSemester(facultyId, universityId);
    await ensureFacultyAssignedSubject(facultyId, universityId, subjectId, semester.id);
    const mimeType = fileMeta.mimetype ?? "application/octet-stream";
    const fileKey = `pyqs/${universityId}/${facultyId}/${Date.now()}-${(fileMeta.originalname ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await uploadObject(fileKey, fileBuffer, mimeType);
    return this.uploadPyq(subjectId, facultyId, year, objectUrl(fileKey), fileKey);
  },

  async updateFacultyNote(facultyId: string, noteId: string, fileBuffer: Buffer | undefined, fileMeta: { originalname?: string; mimetype?: string; size?: number }, body: Record<string, string>) {
    const note = await prisma.note.findFirst({ where: { id: noteId, facultyId, deletedAt: null } });
    if (!note) throw new ApiError(404, "NOT_FOUND", "Note not found.");
    // Reschedule/replace only allowed while still SCHEDULED — a published note can't be un-published.
    const data: Record<string, unknown> = { title: body.title ?? note.title, description: body.description ?? note.description };
    if (body.folderId !== undefined) data.folderId = await this.validateFacultyNoteFolder(facultyId, note.universityId, note.subjectId, body.folderId);
    if (fileBuffer) {
      const mimeType = fileMeta.mimetype ?? note.mimeType;
      const fileKey = `notes/${note.universityId}/${facultyId}/${Date.now()}-${(fileMeta.originalname ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await uploadObject(fileKey, fileBuffer, mimeType);
      data.fileKey = fileKey; data.fileUrl = objectUrl(fileKey);
      data.originalFileName = fileMeta.originalname ?? note.originalFileName;
      data.mimeType = mimeType;
      data.fileSizeKb = Math.round((fileMeta.size ?? fileBuffer.length) / 1024);
    }
    if (body.releaseAt !== undefined) {
      if (note.status === "PUBLISHED") throw new ApiError(409, "ALREADY_PUBLISHED", "A published note can't be rescheduled.");
      const { status, releaseAt } = resolveRelease(body.releaseAt);
      data.status = status; data.releaseAt = releaseAt;
      // If rescheduled to now/past, publish immediately and notify.
      if (status === "PUBLISHED") { await prisma.note.update({ where: { id: noteId }, data }); await this.notifyNotePublished(noteId); return this.getFacultyNote(facultyId, noteId); }
    }
    const updated = await prisma.note.update({ where: { id: noteId }, data });
    if (fileBuffer) await bestEffortStudentAi(() => studentAiBridge.triggerNoteProcessing(noteId, storageEnabled ? presignGetUrl(updated.fileKey, 60 * 60) : undefined));
    return this.getFacultyNote(facultyId, noteId);
  },

  // Flip every note whose scheduled release has arrived. Race-safe & exactly-once:
  // the status-guarded updateMany means only one tick wins the flip and sends notifications.
  // ponytail: 30s poll granularity (set in server.ts); swap for pg_cron if sub-minute precision matters.
  async publishDueNotes() {
    const due = await prisma.note.findMany({ where: { status: "SCHEDULED", releaseAt: { lte: new Date() }, deletedAt: null }, select: { id: true } });
    for (const { id } of due) {
      const flip = await prisma.note.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "PUBLISHED" } });
      if (flip.count === 1) await this.notifyNotePublished(id);
    }
    return { published: due.length };
  },

  // Notify every student currently enrolled in the note's target batches (in-app; the bell polls this).
  // ponytail: web-push/FCM not configured — add a push provider here when a key exists in .env.
  async notifyNotePublished(noteId: string) {
    const note = await prisma.note.findUnique({
      where: { id: noteId },
      include: { subject: { select: { code: true, name: true } }, faculty: { select: { name: true } }, targets: { select: { batchId: true } } },
    });
    if (!note) return;
    const batchIds = note.targets.map((t) => t.batchId);
    if (batchIds.length === 0) return;
    const enrs = await prisma.studentEnrollment.findMany({ where: { batchId: { in: batchIds }, isCurrent: true }, select: { studentId: true } });
    const studentIds = [...new Set(enrs.map((e) => e.studentId))];
    return this.notifyMany(
      note.universityId,
      studentIds.map((studentId) => ({ studentId })),
      "NOTE_PUBLISHED",
      `New note: ${note.title}`,
      `${note.subject.code} · ${note.faculty.name}`,
      `/student/notes?open=${noteId}`,
    );
  },

  async deleteFacultyNote(facultyId: string, noteId: string) {
    const note = await prisma.note.findFirst({ where: { id: noteId, facultyId, deletedAt: null } });
    if (!note) throw new ApiError(404, "NOT_FOUND", "Note not found.");
    await prisma.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  },

  async facultyNoteAiStatus(facultyId: string, noteId: string) {
    const note = await prisma.note.findFirst({ where: { id: noteId, facultyId, deletedAt: null }, include: { _count: { select: { flashcards: true } } } });
    if (!note) throw new ApiError(404, "NOT_FOUND", "Note not found.");
    return { noteId, jobId: note.aiJobId, status: "QUEUED", aiSummary: note.aiSummary, flashcardCount: note._count.flashcards };
  },

  async addFacultyFlashcard(facultyId: string, noteId: string, question: string, answer: string) {
    await this.getFacultyNote(facultyId, noteId);
    const count = await prisma.flashcard.count({ where: { noteId } });
    return prisma.flashcard.create({ data: { noteId, question, answer, order: count + 1 } });
  },

  async deleteFacultyFlashcard(facultyId: string, noteId: string, flashcardId: string) {
    await this.getFacultyNote(facultyId, noteId);
    await prisma.flashcard.delete({ where: { id: flashcardId } });
  },

  // ── Faculty — Quizzes ─────────────────────────────────────

  async facultyQuizzes(facultyId: string, query: Record<string, string | number | undefined>) {
    const quizzes = await prisma.quiz.findMany({
      where: { facultyId, deletedAt: null, ...(query.subjectId ? { subjectId: query.subjectId as string } : {}), ...(query.isPublished !== undefined ? { isPublished: String(query.isPublished) === "true" } : {}) },
      include: { subject: { select: { code: true, name: true } }, targets: { include: { batch: { select: { code: true } } } }, _count: { select: { questions: true, attempts: true } }, attempts: { select: { score: true } } },
      orderBy: { createdAt: "desc" },
    });
    const rows = quizzes.map((q) => ({ id: q.id, title: q.title, description: q.description, subject: q.subject, batchCodes: q.targets.map((target) => target.batch.code), isAiGenerated: q.isAiGenerated, isPublished: q.isPublished, questionCount: q._count.questions, attemptCount: q._count.attempts, avgScore: average(q.attempts.map((a) => a.score)), dueDate: q.dueDate, createdAt: q.createdAt }));
    return paginate(rows, Number(query.page ?? 1), Number(query.limit ?? 20));
  },

  async getFacultyQuiz(facultyId: string, quizId: string) {
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, facultyId, deletedAt: null }, include: { questions: { orderBy: { order: "asc" } }, attempts: { select: { score: true } }, subject: { select: { code: true } }, semester: { select: { label: true } } } });
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    const scores = quiz.attempts.map((a) => a.score);
    return { id: quiz.id, title: quiz.title, description: quiz.description, subjectCode: quiz.subject.code, semesterLabel: quiz.semester.label, isAiGenerated: quiz.isAiGenerated, isPublished: quiz.isPublished, timeLimitMins: quiz.timeLimitMins, dueDate: quiz.dueDate, questions: quiz.questions, stats: { attemptCount: scores.length, avgScore: average(scores), highScore: scores.length === 0 ? 0 : Math.max(...scores), lowScore: scores.length === 0 ? 0 : Math.min(...scores) } };
  },

  async createFacultyQuiz(facultyId: string, universityId: string, body: { subjectId: string; semesterId: string; batchIds?: string[]; title: string; description?: string; timeLimitMins?: number; dueDate?: string; questions?: Array<{ text: string; options: any; correctOption: string; explanation?: string; order: number }> }) {
    await ensureFacultyAssignedSubject(facultyId, universityId, body.subjectId, body.semesterId);
    const batchIds = await validateFacultyContentTargets(facultyId, universityId, body.subjectId, body.semesterId, parseBatchIds(body.batchIds));
    const quiz = await prisma.quiz.create({ data: { facultyId, subjectId: body.subjectId, semesterId: body.semesterId, title: body.title, description: body.description ?? null, timeLimitMins: body.timeLimitMins ?? null, dueDate: body.dueDate ? new Date(body.dueDate) : null, isAiGenerated: false, isPublished: false, targets: { create: batchIds.map((batchId) => ({ batchId })) } } });
    for (const q of body.questions ?? []) {
      await prisma.question.create({ data: { quizId: quiz.id, text: q.text, options: q.options, correctOption: q.correctOption, explanation: q.explanation ?? null, order: q.order } });
    }
    return { id: quiz.id, title: quiz.title, isPublished: false, questionCount: body.questions?.length ?? 0, message: "Quiz created as draft. Publish when ready." };
  },

  async createAiQuizJob(facultyId: string, universityId: string, body: { subjectId: string; semesterId: string; topic: string; questionCount: number; difficulty: string }) {
    await ensureFacultyAssignedSubject(facultyId, universityId, body.subjectId, body.semesterId);
    const jobId = `ai_quiz_job_${Date.now()}`;
    return { jobId, status: "QUEUED", message: `AI is generating ${body.questionCount} questions. Poll /faculty/quizzes/ai-status/${jobId}` };
  },

  async getAiQuizStatus(jobId: string) {
    return { jobId, status: "COMPLETE", draftQuizId: null, questionCount: 0, message: "Quiz generation in progress." };
  },

  async updateFacultyQuiz(facultyId: string, quizId: string, body: Record<string, string | number>) {
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, facultyId, deletedAt: null } });
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    const updated = await prisma.quiz.update({ where: { id: quizId }, data: { title: body.title ? String(body.title) : quiz.title, timeLimitMins: body.timeLimitMins ? Number(body.timeLimitMins) : quiz.timeLimitMins, dueDate: body.dueDate ? new Date(String(body.dueDate)) : quiz.dueDate } });
    const subject = await subjectById(updated.subjectId);
    return { id: updated.id, title: updated.title, description: updated.description, subjectCode: subject.code, isPublished: updated.isPublished, timeLimitMins: updated.timeLimitMins, dueDate: updated.dueDate };
  },

  async replaceFacultyQuizQuestions(facultyId: string, quizId: string, questions: Array<{ text: string; options: any; correctOption: string; explanation?: string; order: number }>) {
    await this.getFacultyQuiz(facultyId, quizId);
    await prisma.question.deleteMany({ where: { quizId } });
    for (const q of questions) {
      await prisma.question.create({ data: { quizId, text: q.text, options: q.options, correctOption: q.correctOption, explanation: q.explanation ?? null, order: q.order } });
    }
    return { quizId, questionCount: questions.length };
  },

  async publishFacultyQuiz(facultyId: string, quizId: string) {
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, facultyId, deletedAt: null } });
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    const questionCount = await prisma.question.count({ where: { quizId } });
    if (questionCount === 0) throw new ApiError(400, "QUIZ_HAS_NO_QUESTIONS", "Quiz has no questions.");
    if (quiz.isPublished) throw new ApiError(409, "QUIZ_ALREADY_PUBLISHED", "Quiz already published.");
    const updated = await prisma.quiz.update({ where: { id: quizId }, data: { isPublished: true, updatedAt: new Date() } });
    return { quizId, isPublished: true, publishedAt: updated.updatedAt };
  },

  async unpublishFacultyQuiz(facultyId: string, quizId: string) {
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, facultyId, deletedAt: null } });
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    await prisma.quiz.update({ where: { id: quizId }, data: { isPublished: false } });
    return { quizId, isPublished: false };
  },

  async deleteFacultyQuiz(facultyId: string, quizId: string) {
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, facultyId, deletedAt: null } });
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    const hasAttempts = await prisma.quizAttempt.findFirst({ where: { quizId } });
    if (hasAttempts) throw new ApiError(409, "QUIZ_HAS_ATTEMPTS", "Quiz has attempts.");
    await prisma.quiz.update({ where: { id: quizId }, data: { deletedAt: new Date() } });
  },

  async facultyQuizAttempts(facultyId: string, quizId: string, query: Record<string, string | number | undefined>) {
    await this.getFacultyQuiz(facultyId, quizId);
    const attempts = await prisma.quizAttempt.findMany({ where: { quizId }, include: { student: { select: { name: true, enrollmentNo: true } } } });
    const rows = await Promise.all(attempts.map(async (a) => {
      const enrollment = await currentEnrollmentForStudent(a.studentId);
      const batch = enrollment ? await batchById(enrollment.batchId) : null;
      return { studentName: a.student.name, enrollmentNo: a.student.enrollmentNo, batchCode: batch?.code ?? "", score: a.score, submittedAt: a.submittedAt };
    }));
    const scores = rows.map((r) => r.score);
    const stats = { avgScore: average(scores), highScore: scores.length === 0 ? 0 : Math.max(...scores), lowScore: scores.length === 0 ? 0 : Math.min(...scores), attemptCount: scores.length };
    return { ...paginate(rows, Number(query.page ?? 1), Number(query.limit ?? 20)), stats };
  },

  async facultyQuizAttemptDetail(facultyId: string, quizId: string, attemptId: string) {
    await this.getFacultyQuiz(facultyId, quizId);
    const attempt = await prisma.quizAttempt.findFirst({ where: { id: attemptId, quizId }, include: { student: { select: { name: true, enrollmentNo: true } } } });
    if (!attempt) throw new ApiError(404, "NOT_FOUND", "Attempt not found.");
    const questions = await prisma.question.findMany({ where: { quizId }, orderBy: { order: "asc" } });
    const answers = attempt.answers as Record<string, string>;
    return {
      studentName: attempt.student.name, enrollmentNo: attempt.student.enrollmentNo, score: attempt.score, submittedAt: attempt.submittedAt,
      questions: questions.map((q) => ({ questionText: q.text, selectedOption: answers[q.id] ?? null, correctOption: q.correctOption, isCorrect: answers[q.id] === q.correctOption, explanation: q.explanation })),
    };
  },

  async facultyQuizPerformance(facultyId: string, quizId: string) {
    const quiz = await this.getFacultyQuiz(facultyId, quizId);
    const attempts = await prisma.quizAttempt.findMany({ where: { quizId } });
    const questions = await prisma.question.findMany({ where: { quizId } });
    return {
      quizId, title: quiz.title, publishedAt: quiz.isPublished ? new Date() : null, totalEligibleStudents: attempts.length, attemptCount: attempts.length, completionRate: attempts.length === 0 ? 0 : 100, avgScore: average(attempts.map((a) => a.score)),
      questionAnalysis: questions.map((q) => {
        const selected = attempts.map((a) => (a.answers as Record<string, string>)[q.id]).filter(Boolean);
        return { questionId: q.id, questionText: q.text, correctRate: selected.length === 0 ? 0 : Number(((selected.filter((s) => s === q.correctOption).length / selected.length) * 100).toFixed(1)), wrongOptionFrequency: (q.options as Array<{ id: string }>).filter((o) => o.id !== q.correctOption).map((o) => ({ optionId: o.id, count: selected.filter((s) => s === o.id).length })) };
      }),
    };
  },

  // ── Faculty — Announcements ───────────────────────────────

  async facultyAnnouncements(facultyId: string, universityId: string, page = 1, limit = 20) {
    const scope = await getFacultyScopeData(facultyId, universityId);
    const me = await prisma.faculty.findUnique({ where: { id: facultyId }, select: { hodId: true } });
    const rows = await prisma.announcement.findMany({
      where: {
        universityId, deletedAt: null,
        OR: [
          { scope: "ALL" },
          { scope: "BATCH", scopeValue: { in: scope.assignedBatchIds } },
          { scope: "YEAR_LEVEL" },
          // ponytail: FACULTY_ONLY — receive if I'm in this HOD's pool.
          ...(me?.hodId ? [{ scope: "FACULTY_ONLY" as any, facultyId: me.hodId }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      include: { faculty: { select: { name: true, isHod: true } } },
    });
    const data = await Promise.all(rows.map(async (a) => {
      const batch = a.scope === "BATCH" && a.scopeValue ? await prisma.batch.findUnique({ where: { id: a.scopeValue }, select: { code: true } }) : null;
      return { id: a.id, title: a.title, body: a.body, scope: a.scope, scopeValue: a.scopeValue, scopeLabel: a.scope === "BATCH" && batch ? `Batch ${batch.code}` : a.scopeValue, senderName: a.faculty.name, senderRole: a.faculty.isHod ? "HOD" : "FACULTY", createdAt: a.createdAt, isOwn: a.facultyId === facultyId };
    }));
    return paginate(data, page, limit);
  },

  async createFacultyAnnouncement(facultyId: string, universityId: string, body: { title: string; body: string; scope: "BATCH" | "YEAR_LEVEL" | "ALL"; scopeValue?: string }) {
    if (body.scope === "ALL") throw new ApiError(403, "SCOPE_NOT_ALLOWED", "Faculty cannot post ALL scope announcements.");
    if (!body.scopeValue) throw new ApiError(400, "VALIDATION_ERROR", "scopeValue is required for scoped announcements.");
    if (body.scope === "BATCH") await ensureFacultyAssignedBatch(facultyId, universityId, body.scopeValue);
    if (body.scope === "YEAR_LEVEL") {
      const scope = await getFacultyScopeData(facultyId, universityId);
      const allowedYearLevels = new Set(await Promise.all(scope.assignments.map(async (a) => (await batchById(a.batchId)).yearLevel)));
      if (!allowedYearLevels.has(body.scopeValue as YearLevel)) throw new ApiError(403, "SCOPE_NOT_ALLOWED", "Faculty can only post to year levels they are assigned to.");
    }
    const a = await prisma.announcement.create({ data: { universityId, facultyId, title: body.title, body: body.body, scope: body.scope as any, scopeValue: body.scopeValue } });
    const batch = body.scope === "BATCH" ? await prisma.batch.findUnique({ where: { id: body.scopeValue! }, select: { code: true } }) : null;
    // Fan-out notifications to matching students
    await this.fanOutAnnouncement(universityId, body.scope, body.scopeValue, body.title, facultyId);
    return { id: a.id, title: a.title, scope: a.scope, scopeLabel: a.scope === "BATCH" && batch ? `Batch ${batch.code}` : a.scopeValue, createdAt: a.createdAt };
  },

  async fanOutAnnouncement(universityId: string, scope: string, scopeValue: string | undefined, title: string, senderId?: string) {
    // FACULTY_ONLY targets the sender-HOD's pool of faculty, not students.
    if (scope === "FACULTY_ONLY") {
      if (!senderId) return;
      const pool = await prisma.faculty.findMany({ where: { universityId, hodId: senderId, deletedAt: null, isActive: true }, select: { id: true } });
      if (pool.length === 0) return;
      await this.notifyMany(
        universityId,
        pool.map((f) => ({ facultyId: f.id })),
        "ANNOUNCEMENT",
        `New announcement: ${title}`,
        "Tap to read.",
        "/faculty/announcements",
      );
      return;
    }
    let studentIds: string[] = [];
    if (scope === "BATCH" && scopeValue) {
      const enrs = await prisma.studentEnrollment.findMany({ where: { batchId: scopeValue, isCurrent: true }, select: { studentId: true } });
      studentIds = enrs.map((e) => e.studentId);
    } else if (scope === "YEAR_LEVEL" && scopeValue) {
      const enrs = await prisma.studentEnrollment.findMany({ where: { yearLevel: scopeValue as YearLevel, isCurrent: true }, select: { studentId: true } });
      studentIds = enrs.map((e) => e.studentId);
    } else {
      const students = await prisma.student.findMany({ where: { universityId, isActive: true, deletedAt: null }, select: { id: true } });
      studentIds = students.map((s) => s.id);
    }
    if (studentIds.length === 0) return;
    await this.notifyMany(
      universityId,
      studentIds.map((studentId) => ({ studentId })),
      "ANNOUNCEMENT",
      `New announcement: ${title}`,
      "Tap to read.",
      "/student/announcements",
    );
  },

  async updateFacultyAnnouncement(facultyId: string, announcementId: string, body: { title?: string; body?: string }) {
    const a = await prisma.announcement.findFirst({ where: { id: announcementId, facultyId, deletedAt: null } });
    if (!a) throw new ApiError(404, "NOT_FOUND", "Announcement not found.");
    return prisma.announcement.update({ where: { id: announcementId }, data: { title: body.title ?? a.title, body: body.body ?? a.body, updatedAt: new Date() } });
  },

  async deleteFacultyAnnouncement(facultyId: string, announcementId: string) {
    const a = await prisma.announcement.findFirst({ where: { id: announcementId, facultyId, deletedAt: null } });
    if (!a) throw new ApiError(404, "NOT_FOUND", "Announcement not found.");
    await prisma.announcement.update({ where: { id: announcementId }, data: { deletedAt: new Date() } });
  },

  // ── Faculty — Mentees / Chat ──────────────────────────────

  async facultyMentees(facultyId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const scope = await getFacultyScopeData(facultyId, universityId, query.semesterId as string | undefined);
    const rules = await getAttendanceRules(universityId);
    const rows = await Promise.all(scope.mentorAssignments.map(async (a) => {
      const student = await prisma.student.findUnique({ where: { id: a.studentId } });
      const enrollment = await currentEnrollmentForStudent(a.studentId, scope.semester.id);
      const batch = enrollment ? await batchById(enrollment.batchId) : null;
      const attendancePct = enrollment ? await computeOverallAttendancePct(enrollment.id) : 0;
      const results = enrollment ? await prisma.result.findMany({ where: { enrollmentId: enrollment.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } }) : [];
      const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
      const status = !student?.isActive ? "INACTIVE" : attendancePct < rules.minThresholdPct || avgMarksPct < 40 ? "AT_RISK" : "ACTIVE";
      const unreadMessages = await prisma.chatMessage.count({ where: { mentorAssignmentId: a.id, senderRole: "STUDENT", isRead: false } });
      const lastMsg = await prisma.chatMessage.findFirst({ where: { mentorAssignmentId: a.id }, orderBy: { sentAt: "desc" } });
      return { mentorAssignmentId: a.id, enrollmentNo: student?.enrollmentNo ?? "", name: student?.name ?? "", branch: student?.branch ?? "", batchCode: batch?.code ?? "", rollNo: enrollment?.rollNo ?? "", attendancePct, latestMarksPct: avgMarksPct, status, unreadMessages, lastMessageAt: lastMsg?.sentAt ?? null };
    }));
    const search = query.search as string | undefined;
    const faculty = await getFacultyUser(facultyId);
    return { mentorCode: faculty.mentorCode, semesterLabel: scope.semester.label, ...paginate(rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.enrollmentNo.includes(search)), Number(query.page ?? 1), Number(query.limit ?? 20)) };
  },

  async facultyMenteeProfile(facultyId: string, universityId: string, enrollmentNo: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const student = await studentByEnrollmentNo(enrollmentNo);
    const assignment = scope.mentorAssignments.find((a) => a.studentId === student.id);
    if (!assignment) throw new ApiError(403, "NOT_MENTOR_OF_STUDENT", "Student is not your mentee.");
    const enrollment = await currentEnrollmentForStudent(student.id, scope.semester.id);
    if (!enrollment) throw new ApiError(404, "NOT_FOUND", "Enrollment not found.");
    const batch = await batchById(enrollment.batchId);
    const attendanceSummary = await Promise.all(scope.assignedSubjectIds.map(async (subjectId) => {
      const subject = await subjectById(subjectId);
      const pct = await computeAttendancePct(enrollment.id, subjectId);
      return { subjectCode: subject.code, pct };
    }));
    const resultsSummary = await prisma.result.findMany({ where: { enrollmentId: enrollment.id }, include: { phase: { select: { label: true } }, subject: { select: { code: true } } } });
    const attendancePct = await computeOverallAttendancePct(enrollment.id);
    const results = await prisma.result.findMany({ where: { enrollmentId: enrollment.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
    const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
    const riskFlag = attendancePct < 75 && avgMarksPct < 40 ? "BOTH" : attendancePct < 75 ? "ATTENDANCE" : avgMarksPct < 40 ? "MARKS" : "NONE";
    const history = await prisma.studentEnrollment.findMany({ where: { studentId: student.id }, include: { semester: { select: { label: true } }, batch: { select: { yearLevel: true, code: true } } } });
    return { mentorAssignmentId: assignment.id, enrollmentNo: student.enrollmentNo, name: student.name, branch: student.branch, batchCode: batch.code, rollNo: enrollment.rollNo, phone: student.phone, admissionYear: student.admissionYear, attendanceSummary, resultsSummary: resultsSummary.map((r) => ({ phase: r.phase.label, subjectCode: r.subject.code, marks: r.marksObtained, grade: r.grade })), riskFlag, academicHistory: history.map((h) => ({ semesterLabel: h.semester.label, yearLevel: h.batch.yearLevel, batchCode: h.batch.code, rollNo: h.rollNo })) };
  },

  async facultyMenteeUnreadCounts(facultyId: string, universityId: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const perMentee = await Promise.all(scope.mentorAssignments.map(async (a) => {
      const student = await prisma.student.findUnique({ where: { id: a.studentId }, select: { name: true } });
      const unreadCount = await prisma.chatMessage.count({ where: { mentorAssignmentId: a.id, senderRole: "STUDENT", isRead: false } });
      return { mentorAssignmentId: a.id, studentName: student?.name ?? "", unreadCount };
    }));
    return { totalUnread: perMentee.reduce((s, r) => s + r.unreadCount, 0), perMentee };
  },

  async facultyMenteesAtRisk(facultyId: string, universityId: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const data = (await Promise.all(scope.mentorAssignments.map(async (a) => {
      const student = await prisma.student.findUnique({ where: { id: a.studentId } });
      const enrollment = await currentEnrollmentForStudent(a.studentId, scope.semester.id);
      if (!enrollment) return null;
      const attendancePct = await computeOverallAttendancePct(enrollment.id);
      const results = await prisma.result.findMany({ where: { enrollmentId: enrollment.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
      const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
      const batch = await batchById(enrollment.batchId);
      return { enrollmentNo: student?.enrollmentNo ?? "", name: student?.name ?? "", batchCode: batch.code, attendancePct, latestMarksPct: avgMarksPct, riskFactor: attendancePct < 75 && avgMarksPct < 40 ? "BOTH" : attendancePct < 75 ? "ATTENDANCE" : "MARKS" };
    }))).filter(Boolean) as Array<{ enrollmentNo: string; name: string; batchCode: string; attendancePct: number; latestMarksPct: number; riskFactor: string }>;
    return { data: data.filter((r) => r.attendancePct < 75 || r.latestMarksPct < 40), total: data.filter((r) => r.attendancePct < 75 || r.latestMarksPct < 40).length };
  },

  async facultyChatMessages(facultyId: string, universityId: string, mentorAssignmentId: string, page = 1, limit = 30) {
    const scope = await getFacultyScopeData(facultyId, universityId);
    const assignment = scope.mentorAssignments.find((a) => a.id === mentorAssignmentId);
    if (!assignment) throw new ApiError(403, "NOT_MENTOR_OF_STUDENT", "Mentor assignment does not belong to this faculty.");
    const student = await prisma.student.findUnique({ where: { id: assignment.studentId }, select: { name: true, enrollmentNo: true } });
    const rows = await prisma.chatMessage.findMany({ where: { mentorAssignmentId }, orderBy: { sentAt: "asc" } });
    return { mentorAssignmentId, student: { name: student?.name ?? "", enrollmentNo: student?.enrollmentNo ?? "" }, ...paginate(rows, page, limit) };
  },

  async facultySendChatMessage(facultyId: string, universityId: string, mentorAssignmentId: string, content: string) {
    const scope = await getFacultyScopeData(facultyId, universityId);
    if (!scope.mentorAssignments.find((a) => a.id === mentorAssignmentId)) throw new ApiError(403, "NOT_MENTOR_OF_STUDENT", "Mentor assignment does not belong to this faculty.");
    if (!content.trim()) throw new ApiError(400, "EMPTY_MESSAGE", "Message cannot be empty.");
    const msg = await prisma.chatMessage.create({ data: { mentorAssignmentId, senderRole: "FACULTY", facultyId, content: content.trim(), isRead: false } });
    return { id: msg.id, senderRole: msg.senderRole, content: msg.content, sentAt: msg.sentAt };
  },

  async facultyMarkChatRead(facultyId: string, universityId: string, mentorAssignmentId: string) {
    const scope = await getFacultyScopeData(facultyId, universityId);
    if (!scope.mentorAssignments.find((a) => a.id === mentorAssignmentId)) throw new ApiError(403, "NOT_MENTOR_OF_STUDENT", "Mentor assignment does not belong to this faculty.");
    const { count } = await prisma.chatMessage.updateMany({ where: { mentorAssignmentId, senderRole: "STUDENT", isRead: false }, data: { isRead: true } });
    return { markedRead: count };
  },

  // ── Faculty — Results ─────────────────────────────────────

  async facultyResultsSummary(facultyId: string, universityId: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const phases = await prisma.phase.findMany({ where: { semesterId: scope.semester.id }, orderBy: { number: "asc" } });
    const bySubject = await Promise.all(scope.assignedSubjectIds.map(async (subjectId) => {
      const subject = await subjectById(subjectId);
      return {
        subjectCode: subject.code,
        phases: await Promise.all(phases.map(async (phase) => {
          const rows = await prisma.result.findMany({ where: { subjectId, phaseId: phase.id } });
          return { phase: phase.label, isPublished: rows.length > 0 && rows.every((r) => r.isPublished), avgMarksPct: rows.length === 0 ? null : average(rows.map((r) => (r.marksObtained / r.maxMarks) * 100)) };
        })),
      };
    }));
    return { semesterLabel: scope.semester.label, bySubject };
  },

  async facultyResults(facultyId: string, universityId: string, query: Record<string, string | number | undefined>) {
    const scope = await getFacultyScopeData(facultyId, universityId, query.semesterId as string | undefined);
    const subjectId = query.subjectId as string | undefined;
    const batchId = query.batchId as string | undefined;
    const phaseId = query.phaseId as string | undefined;
    if (subjectId) await ensureFacultyAssignedSubject(facultyId, universityId, subjectId, scope.semester.id);
    if (batchId) await ensureFacultyAssignedBatch(facultyId, universityId, batchId, scope.semester.id);
    const results = await prisma.result.findMany({
      where: { subjectId: subjectId ? subjectId : { in: scope.assignedSubjectIds }, ...(phaseId ? { phaseId } : {}), enrollment: { batchId: batchId ? batchId : { in: scope.assignedBatchIds }, isCurrent: true } },
      include: { enrollment: { include: { student: true, batch: true } }, phase: true, subject: true },
    });
    const rows = results.map((r) => ({ enrollmentNo: r.enrollment.student.enrollmentNo, studentName: r.enrollment.student.name, batchCode: r.enrollment.batch.code, subjectCode: r.subject.code, phase: r.phase.label, marksObtained: r.marksObtained, maxMarks: r.maxMarks, grade: r.grade, isPublished: r.isPublished }));
    const stats = { avgMarksPct: average(rows.map((r) => (r.marksObtained / r.maxMarks) * 100)), passCount: rows.filter((r) => r.marksObtained >= 40).length, failCount: rows.filter((r) => r.marksObtained < 40).length };
    return { ...paginate(rows, Number(query.page ?? 1), Number(query.limit ?? 50)), stats };
  },

  async facultyResultsLeaderboard(facultyId: string, universityId: string, subjectId: string, phaseId: string, batchId?: string, limit = 10) {
    await ensureFacultyAssignedSubject(facultyId, universityId, subjectId);
    if (batchId) await ensureFacultyAssignedBatch(facultyId, universityId, batchId);
    const results = await prisma.result.findMany({
      where: { subjectId, phaseId, ...(batchId ? { enrollment: { batchId } } : {}) },
      include: { enrollment: { include: { student: true } } },
      orderBy: { marksObtained: "desc" },
      take: limit,
    });
    const data = results.map((r, i) => ({ rank: i + 1, enrollmentNo: r.enrollment.student.enrollmentNo, name: r.enrollment.student.name, marksObtained: r.marksObtained, grade: r.grade }));
    const phase = await phaseById(phaseId);
    const subject = await subjectById(subjectId);
    const batch = batchId ? await batchById(batchId) : null;
    return { phase: phase.label, subjectCode: subject.code, batchCode: batch?.code ?? null, data };
  },

  // ── Faculty — Calendar / Analytics ───────────────────────

  async facultyCalendarEvents(universityId: string, year: number, month: number) {
    return this.calendarEvents(universityId, { year, month });
  },

  async facultyUpcomingEvents(universityId: string, limit = 6) {
    return this.upcomingEvents(universityId, limit);
  },

  async facultyAnalyticsAttendance(facultyId: string, universityId: string, semesterId?: string, subjectId?: string, batchId?: string) {
    const full = await this.facultyAttendanceSummary(facultyId, universityId, semesterId);
    const subjCode = subjectId ? (await prisma.subject.findUnique({ where: { id: subjectId }, select: { code: true } }))?.code : undefined;
    const batchCode = batchId ? (await prisma.batch.findUnique({ where: { id: batchId }, select: { code: true } }))?.code : undefined;
    const summary = full.bySubjectAndBatch
      .filter((r) => !subjCode || r.subjectCode === subjCode)
      .filter((r) => !batchCode || r.batchCode === batchCode);
    // Real weekly attendance from the summary (was a flat, identical value per week).
    const weekly = full.weekly ?? [];
    return {
      overview: { avgAttendancePct: average(summary.map((s) => s.avgAttendancePct)), belowThresholdCount: summary.reduce((s, r) => s + r.belowThresholdCount, 0), totalLecturesDelivered: summary.reduce((s, r) => s + r.totalLecturesMarked, 0) },
      bySubjectBatch: summary,
      trend: {
        labels: weekly.length ? weekly.map((_w, i) => `Week ${i + 1}`) : ["Week 1"],
        data: weekly.length ? weekly.map((w) => w.pct) : [average(summary.map((s) => s.avgAttendancePct))],
      },
    };
  },

  async facultyAnalyticsMarks(facultyId: string, universityId: string, semesterId?: string, subjectId?: string, phaseId?: string) {
    const results = (await this.facultyResults(facultyId, universityId, { semesterId, subjectId, phaseId, page: 1, limit: 1000 })).data;
    const subject = subjectId ? await subjectById(subjectId) : null;
    const phase = phaseId ? await phaseById(phaseId) : null;
    return {
      subjectCode: subject?.code ?? null,
      phase: phase?.label ?? null,
      stats: { avgMarksPct: average(results.map((r) => (r.marksObtained / r.maxMarks) * 100)), passRate: results.length === 0 ? 0 : Number(((results.filter((r) => r.marksObtained >= 40).length / results.length) * 100).toFixed(1)), highestMarks: results.length === 0 ? 0 : Math.max(...results.map((r) => r.marksObtained)), lowestMarks: results.length === 0 ? 0 : Math.min(...results.map((r) => r.marksObtained)) },
      gradeDistribution: ["A+", "A", "B", "C", "D", "F"].map((g) => ({ grade: g, count: results.filter((r) => r.grade === g).length })),
      phaseComparison: phase ? [{ phase: phase.label, avgPct: average(results.map((r) => (r.marksObtained / r.maxMarks) * 100)) }] : [],
    };
  },

  async facultyAnalyticsMentees(facultyId: string, universityId: string, semesterId?: string) {
    const scope = await getFacultyScopeData(facultyId, universityId, semesterId);
    const data = (await Promise.all(scope.mentorAssignments.map(async (a) => {
      const student = await prisma.student.findUnique({ where: { id: a.studentId } });
      const enrollment = await currentEnrollmentForStudent(a.studentId, scope.semester.id);
      if (!enrollment) return null;
      const attendancePct = await computeOverallAttendancePct(enrollment.id);
      const results = await prisma.result.findMany({ where: { enrollmentId: enrollment.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } });
      const avgMarksPct = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
      const batch = await batchById(enrollment.batchId);
      const riskFactor = attendancePct < 75 && avgMarksPct < 40 ? "BOTH" : attendancePct < 75 ? "ATTENDANCE" : avgMarksPct < 40 ? "MARKS" : "NONE";
      const subjectBreakdown = await Promise.all(scope.assignedSubjectIds.map(async (subjectId) => {
        const subject = await subjectById(subjectId);
        const subjectPct = await computeAttendancePct(enrollment.id, subjectId);
        const lastResult = await prisma.result.findFirst({ where: { enrollmentId: enrollment.id, subjectId }, orderBy: { createdAt: "desc" } });
        return { subjectCode: subject.code, attendancePct: subjectPct, t2Marks: lastResult?.marksObtained ?? null };
      }));
      return { enrollmentNo: student?.enrollmentNo ?? "", name: student?.name ?? "", batchCode: batch.code, avgAttendancePct: attendancePct, avgMarksPct, riskFactor, subjectBreakdown };
    }))).filter(Boolean) as Array<any>;
    return { semesterLabel: scope.semester.label, totalMentees: data.length, atRiskCount: data.filter((r) => r.riskFactor !== "NONE").length, data };
  },

  // ─────────────────────────────────────────────────────────────
  // ponytail: HOD shims — routes referenced methods that were never
  // written. Minimal, correct implementations using existing helpers.
  // ─────────────────────────────────────────────────────────────

  // ── Students ──
  async getStudent(_scope: Scope, enrollmentNo: string) {
    const s = await studentByEnrollmentNo(enrollmentNo);
    const enrollment = await prisma.studentEnrollment.findFirst({ where: { studentId: s.id, isCurrent: true }, include: { batch: true, semester: true } });
    const attendancePct = enrollment ? await computeOverallAttendancePct(enrollment.id) : 0;
    const results = enrollment ? await prisma.result.findMany({ where: { enrollmentId: enrollment.id, isPublished: true }, select: { marksObtained: true, maxMarks: true } }) : [];
    const avgMarks = results.length === 0 ? 0 : average(results.map((r) => (r.marksObtained / r.maxMarks) * 100));
    const rules = await getAttendanceRules(s.universityId);
    const status = !s.isActive ? "INACTIVE" : (attendancePct < rules.minThresholdPct || avgMarks < 40) ? "AT_RISK" : "ACTIVE";
    return {
      enrollmentNo: s.enrollmentNo, name: s.name, email: s.email, phone: s.phone ?? undefined,
      branch: s.branch, admissionYear: s.admissionYear, status,
      currentEnrollment: enrollment ? {
        batchCode: enrollment.batch.code, semesterLabel: enrollment.semester.label,
        yearLevel: enrollment.yearLevel, rollNo: enrollment.rollNo, attendancePct,
      } : null,
    };
  },

  async getStudentHistory(_scope: Scope, enrollmentNo: string) {
    const s = await studentByEnrollmentNo(enrollmentNo);
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { studentId: s.id }, include: { batch: true, semester: { include: { academicYear: true } } },
      orderBy: { semester: { number: "asc" } },
    });
    return {
      enrollmentNo: s.enrollmentNo,
      journey: enrollments.map((e) => ({
        semesterNumber: e.semester.number, semesterLabel: e.semester.label, yearLevel: e.yearLevel,
        batchCode: e.batch.code, rollNo: e.rollNo, academicYear: e.semester.academicYear.label, isCurrent: e.isCurrent,
      })),
    };
  },

  async createStudent(body: { enrollmentNo: string; name: string; email: string; branch: string; phone?: string; admissionYear: number; universityId?: string }) {
    const existing = await prisma.student.findFirst({ where: { OR: [{ email: body.email }, { enrollmentNo: body.enrollmentNo }] }, select: { id: true } });
    if (existing) throw new ApiError(409, "ENROLLMENT_NO_ALREADY_EXISTS", "Student email or enrollment number already exists.");
    const universityId = body.universityId ?? (await prisma.university.findFirst({ select: { id: true } }))!.id;
    await assertBranchAllowed(universityId, body.branch);
    const temporaryPassword = `${body.enrollmentNo}@123`;
    const s = await prisma.student.create({
      data: {
        universityId, enrollmentNo: body.enrollmentNo, name: body.name, email: body.email,
        phone: body.phone ?? null, branch: body.branch, admissionYear: body.admissionYear,
        isActive: true, passwordHash: temporaryPassword,
      },
    });
    return { id: s.id, enrollmentNo: s.enrollmentNo, name: s.name, temporaryPassword };
  },

  async updateStudent(_scope: Scope, enrollmentNo: string, body: { name?: string; email?: string; phone?: string; branch?: string }) {
    const s = await studentByEnrollmentNo(enrollmentNo);
    if (body.branch) await assertBranchAllowed(s.universityId, body.branch);
    const updated = await prisma.student.update({
      where: { id: s.id },
      data: { name: body.name, email: body.email, phone: body.phone ?? undefined, branch: body.branch },
    });
    return { enrollmentNo: updated.enrollmentNo, name: updated.name, email: updated.email, phone: updated.phone, branch: updated.branch };
  },

  async updateStudentStatus(enrollmentNo: string, isActive: boolean) {
    const s = await studentByEnrollmentNo(enrollmentNo);
    await prisma.student.update({ where: { id: s.id }, data: { isActive } });
    return { enrollmentNo, isActive };
  },

  async deleteStudent(enrollmentNo: string) {
    const s = await studentByEnrollmentNo(enrollmentNo);
    const active = await prisma.studentEnrollment.count({ where: { studentId: s.id, isCurrent: true } });
    if (active > 0) throw new ApiError(409, "STUDENT_HAS_ACTIVE_ENROLLMENT", "Deactivate the student before deleting.");
    await prisma.student.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
  },

  async studentCsvUpload(scope: Scope, buffer: Buffer | undefined, opts: { semesterId?: string }) {
    // ponytail: upload allowed in any semester — HOD's own active (scoped) sem is the target.
    const semesterId = opts.semesterId || scope.hodSemesterIds?.[0] || (await scopeSemester(scope)).id;
    return this.uploadStudentCsv(buffer, scope.universityId, semesterId, scope.userId);
  },

  async studentCsvTemplate() {
    return "enrollment_no,name,branch,batch,roll_no\n24IT001,Aarav Patel,IT,C2,IT-25-001\n";
  },

  async studentExport(scope: Scope, query: Record<string, string | number | undefined> = {}): Promise<ExportTable> {
    const search = query.search ? String(query.search).toLowerCase() : "";
    const rows = await prisma.studentEnrollment.findMany({
      where: {
        isCurrent: true,
        batchId: query.batchId ? String(query.batchId) : { in: scope.hodBatchIds },
        ...(query.branch ? { student: { branch: String(query.branch) } } : {}),
      },
      include: { student: true, batch: true },
      orderBy: { rollNo: "asc" },
    });
    const filtered = search
      ? rows.filter((r) => r.student.name.toLowerCase().includes(search) || r.student.enrollmentNo.includes(search))
      : rows;
    return {
      title: "Students",
      subtitle: `${filtered.length} student(s) · exported ${new Date().toLocaleString("en-IN")}`,
      headers: ["Enrollment No", "Name", "Email", "Branch", "Batch", "Roll No"],
      rows: filtered.map((r) => [r.student.enrollmentNo, r.student.name, r.student.email, r.student.branch, r.batch.code, r.rollNo]),
    };
  },

  // ── Faculty ──
  async getFaculty(_scope: Scope, employeeId: string) {
    const f = await facultyByEmployeeId(employeeId);
    const assignments = await prisma.facultyBatchAssignment.findMany({
      where: { facultyId: f.id }, include: { subject: true, batch: true },
    });
    const bySubject = new Map<string, { code: string; name: string; batches: string[] }>();
    for (const a of assignments) {
      const key = a.subjectId;
      if (!bySubject.has(key)) bySubject.set(key, { code: a.subject.code, name: a.subject.name, batches: [] });
      bySubject.get(key)!.batches.push(a.batch.code);
    }
    const menteeCount = f.isHod ? 0 : await prisma.mentorAssignment.count({ where: { facultyId: f.id } });
    return {
      employeeId: f.employeeId, name: f.name, email: f.email, phone: f.phone ?? undefined,
      year: f.year, isHod: f.isHod, mentorCode: f.mentorCode,
      menteeCount, subjects: Array.from(bySubject.values()),
      status: f.isActive ? "ACTIVE" : "INACTIVE",
    };
  },

  async createFaculty(body: { employeeId: string; name: string; email: string; year: string; isHod?: boolean; phone?: string; universityId?: string }) {
    const existing = await prisma.faculty.findFirst({ where: { OR: [{ email: body.email }, { employeeId: body.employeeId }] }, select: { id: true } });
    if (existing) throw new ApiError(409, "CONFLICT", "Faculty email or employeeId already exists.");
    const universityId = body.universityId ?? (await prisma.university.findFirst({ select: { id: true } }))!.id;
    const temporaryPassword = `${body.employeeId}@123`;
    const f = await prisma.faculty.create({
      data: {
        universityId, employeeId: body.employeeId, name: body.name, email: body.email,
        year: body.year, isHod: !!body.isHod, isActive: true,
        phone: body.phone ?? null, passwordHash: temporaryPassword,
      },
    });
    return { id: f.id, employeeId: f.employeeId, name: f.name, temporaryPassword };
  },

  async updateFaculty(employeeId: string, body: { name?: string; email?: string; phone?: string; year?: string }) {
    const f = await facultyByEmployeeId(employeeId);
    const updated = await prisma.faculty.update({
      where: { id: f.id },
      data: { name: body.name, email: body.email, phone: body.phone ?? undefined, year: body.year },
    });
    return { employeeId: updated.employeeId, name: updated.name, email: updated.email };
  },

  async updateMentorCode(employeeId: string, mentorCode: string) {
    const f = await facultyByEmployeeId(employeeId);
    if (f.isHod) throw new ApiError(400, "CANNOT_SET_MENTOR_CODE_FOR_HOD", "HOD cannot have a mentor code.");
    const conflict = await prisma.faculty.findFirst({ where: { mentorCode, universityId: f.universityId, id: { not: f.id } } });
    if (conflict) throw new ApiError(409, "MENTOR_CODE_ALREADY_IN_USE", "Mentor code already in use.");
    await prisma.faculty.update({ where: { id: f.id }, data: { mentorCode } });
    return { employeeId, mentorCode };
  },

  async updateFacultyStatus(employeeId: string, isActive: boolean) {
    const f = await facultyByEmployeeId(employeeId);
    if (f.isHod && !isActive) throw new ApiError(403, "CANNOT_DEACTIVATE_HOD", "Cannot deactivate an HOD.");
    await prisma.faculty.update({ where: { id: f.id }, data: { isActive } });
    return { employeeId, status: isActive ? "ACTIVE" : "INACTIVE" };
  },

  async deleteFaculty(employeeId: string) {
    const f = await facultyByEmployeeId(employeeId);
    if (f.isHod) throw new ApiError(403, "CANNOT_DELETE_HOD", "Cannot delete an HOD.");
    const active = await prisma.facultyBatchAssignment.count({ where: { facultyId: f.id } });
    if (active > 0) throw new ApiError(409, "FACULTY_HAS_ACTIVE_ASSIGNMENTS", "Remove assignments first.");
    await prisma.faculty.update({ where: { id: f.id }, data: { deletedAt: new Date(), isActive: false } });
  },

  async facultyCsvUpload(buffer: Buffer | undefined, universityId: string) {
    return this.uploadFacultyCsv(buffer, universityId);
  },

  async createFacultyAssignment(body: { facultyId: string; subjectId: string; batchId: string; semesterId: string }) {
    const created = await this.assignFacultyBatch(body.facultyId, body.subjectId, body.batchId, body.semesterId);
    const faculty = await facultyById(body.facultyId);
    const subject = await prisma.subject.findUnique({ where: { id: body.subjectId } });
    const batch = await prisma.batch.findUnique({ where: { id: body.batchId } });
    return { id: created.id ?? "", faculty: { id: faculty.id, name: faculty.name }, subject: { code: subject?.code ?? "" }, batch: { code: batch?.code ?? "" } };
  },

  async deleteFacultyAssignment(assignmentId: string) {
    await prisma.facultyBatchAssignment.delete({ where: { id: assignmentId } });
  },

  async facultyExport(scope: Scope): Promise<ExportTable> {
    const faculty = await prisma.faculty.findMany({ where: { universityId: scope.universityId, deletedAt: null }, orderBy: { name: "asc" } });
    return {
      title: "Faculty",
      subtitle: `${faculty.length} member(s) · exported ${new Date().toLocaleString("en-IN")}`,
      headers: ["Employee ID", "Name", "Email", "Year", "Is HOD", "Mentor Code", "Status"],
      rows: faculty.map((f) => [f.employeeId, f.name, f.email, f.year ?? "", f.isHod ? "Yes" : "No", f.mentorCode ?? "", f.isActive ? "ACTIVE" : "INACTIVE"]),
    };
  },

  // ── Results ──
  async resultsUploadContext(scope: Scope, semesterId?: string) {
    const semester = semesterId
      ? await prisma.semester.findUnique({ where: { id: semesterId }, include: { academicYear: true } })
      : await prisma.semester.findFirst({ where: { universityId: scope.universityId, status: "ACTIVE" }, include: { academicYear: true } });
    if (!semester) return { academicYears: [], semesters: [], phases: [], subjects: [], batches: [] };
    const [years, semesters, phases, subjects, batches] = await Promise.all([
      prisma.academicYear.findMany({ where: { universityId: scope.universityId }, orderBy: { label: "desc" } }),
      prisma.semester.findMany({ where: { universityId: scope.universityId }, orderBy: { number: "asc" } }),
      prisma.phase.findMany({ where: { semesterId: semester.id }, orderBy: { number: "asc" } }),
      subjectsBySemester(semester.id),
      prisma.batch.findMany({ where: { id: { in: scope.hodBatchIds } } }),
    ]);
    return {
      academicYears: years.map((y) => ({ id: y.id, label: y.label })),
      semesters: semesters.map((s) => ({ id: s.id, label: s.label, number: s.number })),
      phases: phases.map((p, i, arr) => ({ id: p.id, label: p.label, number: p.number, isActive: !p.isComplete && arr.slice(0, i).every((q) => q.isComplete), isComplete: p.isComplete })),
      subjects: subjects.map((s) => ({ id: s.id, code: s.code, name: s.name })),
      batches: batches.map((b) => ({ id: b.id, code: b.code })),
    };
  },

  async resultsStudents(_scope: Scope, semesterId: string, batchId: string, subjectId: string) {
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { semesterId, batchId, isCurrent: true }, include: { student: true },
    });
    const data = await Promise.all(enrollments.map(async (e) => {
      const existing = await prisma.result.findFirst({ where: { enrollmentId: e.id, subjectId }, select: { marksObtained: true, maxMarks: true, grade: true } });
      return { enrollmentId: e.id, enrollmentNo: e.student.enrollmentNo, name: e.student.name, existingMarks: existing };
    }));
    return { data };
  },

  async resultsUpload(buffer: Buffer | undefined, body: { phaseId?: string; subjectId?: string; batchId?: string }) {
    if (!buffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    if (!body.phaseId || !body.subjectId || !body.batchId) throw new ApiError(400, "VALIDATION_ERROR", "phaseId, subjectId, and batchId are required.");
    const rows = parseCsvRecords(buffer, ["enrollment_no", "marks_obtained"]);
    const errors: { row: number; enrollmentNo?: string; reason: string }[] = [];
    let inserted = 0, updated = 0, totalMarks = 0, belowPass = 0, studentCount = 0;
    for (const { row, record } of rows) {
      const enrollmentNo = record.enrollment_no;
      const marksObtained = Number(record.marks_obtained);
      const maxMarks = Number(record.max_marks || 100);
      if (!Number.isFinite(marksObtained)) { errors.push({ row, enrollmentNo, reason: "Invalid marks" }); continue; }
      const student = await prisma.student.findFirst({ where: { enrollmentNo, deletedAt: null } });
      if (!student) { errors.push({ row, enrollmentNo, reason: "Student not found" }); continue; }
      const enrollment = await prisma.studentEnrollment.findFirst({ where: { studentId: student.id, batchId: body.batchId, isCurrent: true } });
      if (!enrollment) { errors.push({ row, enrollmentNo, reason: "Enrollment not in batch" }); continue; }
      const pct = (marksObtained / maxMarks) * 100;
      const grade = record.grade || gradeFromPct(pct);
      const existing = await prisma.result.findFirst({ where: { enrollmentId: enrollment.id, phaseId: body.phaseId, subjectId: body.subjectId } });
      if (existing) {
        await prisma.result.update({ where: { id: existing.id }, data: { marksObtained, maxMarks, grade } });
        updated++;
      } else {
        await prisma.result.create({ data: { enrollmentId: enrollment.id, phaseId: body.phaseId, subjectId: body.subjectId, marksObtained, maxMarks, grade, uploadedById: student.universityId } });
        inserted++;
      }
      totalMarks += pct; studentCount++;
      if (pct < 40) belowPass++;
    }
    return { totalRows: rows.length, inserted, updated, errors, summary: { avgMarks: studentCount === 0 ? 0 : totalMarks / studentCount, belowPassCount: belowPass, studentCount } };
  },

  async resultsManual(body: { phaseId: string; subjectId: string; batchId: string; results: { enrollmentId: string; marksObtained: number; maxMarks: number; grade?: string }[] }) {
    let inserted = 0, updated = 0, totalMarks = 0, belowPass = 0;
    for (const r of body.results) {
      const pct = (r.marksObtained / r.maxMarks) * 100;
      const grade = r.grade || gradeFromPct(pct);
      const existing = await prisma.result.findFirst({ where: { enrollmentId: r.enrollmentId, phaseId: body.phaseId, subjectId: body.subjectId } });
      if (existing) {
        await prisma.result.update({ where: { id: existing.id }, data: { marksObtained: r.marksObtained, maxMarks: r.maxMarks, grade } });
        updated++;
      } else {
        const enrollment = await enrollmentById(r.enrollmentId);
        await prisma.result.create({ data: { enrollmentId: r.enrollmentId, phaseId: body.phaseId, subjectId: body.subjectId, marksObtained: r.marksObtained, maxMarks: r.maxMarks, grade, uploadedById: enrollment.studentId } });
        inserted++;
      }
      totalMarks += pct;
      if (pct < 40) belowPass++;
    }
    return { inserted, updated, summary: { avgMarks: body.results.length === 0 ? 0 : totalMarks / body.results.length, belowPassCount: belowPass } };
  },

  async resultsPreview(phaseId: string, subjectId: string, batchId: string) {
    const enrollments = await prisma.studentEnrollment.findMany({ where: { batchId, isCurrent: true }, include: { student: true } });
    const results = await Promise.all(enrollments.map(async (e) => {
      const r = await prisma.result.findFirst({ where: { enrollmentId: e.id, phaseId, subjectId } });
      if (!r) return { resultId: null, enrollmentNo: e.student.enrollmentNo, name: e.student.name, marksObtained: null, maxMarks: null, grade: null, status: "Pending", isPublished: false };
      const pct = (r.marksObtained / r.maxMarks) * 100;
      return { resultId: r.id, enrollmentNo: e.student.enrollmentNo, name: e.student.name, marksObtained: r.marksObtained, maxMarks: r.maxMarks, grade: r.grade, status: pct < 40 ? "Fail" : "Pass", isPublished: r.isPublished };
    }));
    const filled = results.filter((r) => r.marksObtained != null);
    const avgMarks = filled.length === 0 ? 0 : average(filled.map((r) => ((r.marksObtained ?? 0) / (r.maxMarks ?? 100)) * 100));
    const belowPassCount = results.filter((r) => r.status === "Fail").length;
    return { studentCount: results.length, avgMarks, belowPassCount, isPublished: results.some((r) => r.isPublished), results };
  },

  async resultsPublish(phaseId: string, subjectId: string, batchId: string) {
    const enrollments = await prisma.studentEnrollment.findMany({ where: { batchId, isCurrent: true }, select: { id: true, studentId: true, semesterId: true } });
    const ids = enrollments.map((e) => e.id);
    const existing = await prisma.result.findMany({ where: { enrollmentId: { in: ids }, phaseId, subjectId } });
    if (existing.length < enrollments.length) throw new ApiError(400, "INCOMPLETE_RESULTS", "Not all students have marks entered.");
    if (existing.every((r) => r.isPublished)) throw new ApiError(409, "RESULTS_ALREADY_PUBLISHED", "Already published.");
    const publishedAt = new Date();
    await prisma.result.updateMany({ where: { id: { in: existing.map((r) => r.id) } }, data: { isPublished: true, publishedAt } });

    // Fan-out notification to affected students
    const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { code: true, name: true, universityId: true } });
    const phase = await prisma.phase.findUnique({ where: { id: phaseId }, select: { label: true } });
    if (subject && phase && enrollments.length > 0) {
      await this.notifyMany(
        subject.universityId,
        enrollments.map((e) => ({ studentId: e.studentId })),
        "RESULT_UPLOADED",
        `${phase.label} Result Out — ${subject.code}`,
        `Your ${phase.label} result for ${subject.name} has been published.`,
        "/student/results",
      );
    }

    return { published: true, publishedAt, studentCount: existing.length };
  },

  async resultsUploadHistory(scope: Scope, page = 1, limit = 10) {
    const results = await prisma.result.findMany({
      where: { enrollment: { batchId: { in: scope.hodBatchIds } } },
      include: { phase: true, subject: true, enrollment: { include: { batch: true } } },
      orderBy: { createdAt: "desc" },
    });
    // Group by (phase, subject, batch, createdAt-day) as one "upload"
    const grouped = new Map<string, { phase: string; subjectCode: string; batchCode: string; uploadedAt: Date; studentCount: number }>();
    for (const r of results) {
      const key = `${r.phaseId}-${r.subjectId}-${r.enrollment.batchId}-${r.createdAt.toISOString().slice(0, 10)}`;
      const cur = grouped.get(key);
      if (cur) cur.studentCount++;
      else grouped.set(key, { phase: r.phase.label, subjectCode: r.subject.code, batchCode: r.enrollment.batch.code, uploadedAt: r.createdAt, studentCount: 1 });
    }
    const rows = Array.from(grouped.values()).sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    return paginate(rows, page, limit);
  },

  async resultsPhaseStatus(scope: Scope, semesterId?: string) {
    const semester = semesterId
      ? await prisma.semester.findUnique({ where: { id: semesterId } })
      : await prisma.semester.findFirst({ where: { universityId: scope.universityId, status: "ACTIVE" } });
    if (!semester) return { phases: [] };
    const phases = await prisma.phase.findMany({ where: { semesterId: semester.id }, orderBy: { number: "asc" } });
    const subjectsTotal = await prisma.subject.count({ where: { universityId: semester.universityId, semesterNumber: semester.number, deletedAt: null } });
    const rows = await Promise.all(phases.map(async (p) => {
      const uploadedSubjects = await prisma.result.groupBy({
        by: ["subjectId"],
        where: { phaseId: p.id, enrollment: { batchId: { in: scope.hodBatchIds }, isCurrent: true } },
      });
      const subjectsUploaded = uploadedSubjects.length;
      const status = subjectsUploaded === 0 ? "Pending" : subjectsUploaded < subjectsTotal ? "In Progress" : "Complete";
      return { phase: p.label, subjectsTotal, subjectsUploaded, status };
    }));
    return { phases: rows };
  },

  async updateResult(resultId: string, marksObtained: number, grade: string) {
    const updated = await prisma.result.update({ where: { id: resultId }, data: { marksObtained, grade } });
    return { id: updated.id, marksObtained: updated.marksObtained, grade: updated.grade, updatedAt: updated.updatedAt };
  },

  async deleteResult(resultId: string) {
    await prisma.result.delete({ where: { id: resultId } });
  },

  async studentStudyPlanner(studentId: string, _universityId: string) {
    return formatStudyPlan(await getLatestStudyPlan(studentId));
  },
  async saveStudentStudyPlanner(studentId: string, _universityId: string, plan: unknown[]) {
    const latest = await getLatestStudyPlan(studentId);
    if (!latest) throw new ApiError(404, "PLAN_NOT_FOUND", "Generate a study plan first.");
    if (!Array.isArray(plan)) throw new ApiError(400, "VALIDATION_ERROR", "Plan payload must be an array.");
    const customItems = plan.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    for (const item of customItems) {
      const taskDate = item.date ? new Date(String(item.date)) : null;
      const description = String(item.description ?? "").trim();
      if (!taskDate || Number.isNaN(taskDate.getTime()) || !description) continue;
      await prisma.studyPlanTask.create({
        data: {
          studyPlanId: latest.id,
          subjectId: item.subjectId ? String(item.subjectId) : null,
          taskDate,
          description,
          estimatedDurationMinutes: Number(item.estimatedDurationMinutes ?? item.durationMins ?? 60),
          priority: String(item.priority ?? "medium"),
          isCompleted: Boolean(item.isCompleted),
          isCustom: true,
        },
      });
    }
    return formatStudyPlan(await getLatestStudyPlan(studentId));
  },
  async addStudentStudyPlannerTask(studentId: string, _universityId: string, body: Record<string, unknown>) {
    const latest = await getLatestStudyPlan(studentId);
    if (!latest) throw new ApiError(404, "PLAN_NOT_FOUND", "Generate a study plan first.");
    const description = String(body.description ?? "").trim();
    const taskDate = body.date ? new Date(String(body.date)) : null;
    const estimatedDurationMinutes = Number(body.estimatedDurationMinutes ?? 30);
    const priority = String(body.priority ?? "medium").toLowerCase();
    if (!description) throw new ApiError(400, "VALIDATION_ERROR", "Task description is required.");
    if (!taskDate || Number.isNaN(taskDate.getTime())) throw new ApiError(400, "VALIDATION_ERROR", "Task date is invalid.");
    if (!Number.isFinite(estimatedDurationMinutes) || estimatedDurationMinutes < 5 || estimatedDurationMinutes > 180) {
      throw new ApiError(400, "VALIDATION_ERROR", "Task duration must be between 5 and 180 minutes.");
    }
    if (!["low", "medium", "high"].includes(priority)) throw new ApiError(400, "VALIDATION_ERROR", "Task priority is invalid.");
    await prisma.studyPlanTask.create({
      data: {
        studyPlanId: latest.id,
        subjectId: body.subjectId ? String(body.subjectId) : null,
        taskDate,
        description,
        estimatedDurationMinutes,
        priority,
        isCustom: true,
      },
    });
    return formatStudyPlan(await getLatestStudyPlan(studentId));
  },
  async updateStudentStudyPlannerTask(studentId: string, _universityId: string, taskId: string, isCompleted: boolean) {
    const task = await prisma.studyPlanTask.findFirst({
      where: { id: taskId, studyPlan: { studentId } },
      include: { studyPlan: { include: { tasks: true } } },
    });
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Planner task not found.");
    await prisma.studyPlanTask.update({ where: { id: task.id }, data: { isCompleted } });
    const remaining = task.studyPlan.tasks.filter((item) => item.id !== task.id ? !item.isCompleted : !isCompleted).length;
    await prisma.studyPlan.update({
      where: { id: task.studyPlanId },
      data: { status: remaining === 0 ? "completed" : "active" },
    });
    if (isCompleted && remaining > 0) {
      await refreshStudyPlanAfterProgress(studentId, _universityId);
    }
    return formatStudyPlan(await getLatestStudyPlan(studentId));
  },
  async deleteStudentStudyPlannerTask(studentId: string, taskId: string) {
    const task = await prisma.studyPlanTask.findFirst({
      where: { id: taskId, isCustom: true, studyPlan: { studentId } },
    });
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Custom planner task not found.");
    await prisma.studyPlanTask.delete({ where: { id: task.id } });
    return formatStudyPlan(await getLatestStudyPlan(studentId));
  },
  async studentStudyPlannerAiSuggest(studentId: string, universityId: string, _body: Record<string, unknown>) {
    const created = await generateStudyPlanForStudent(studentId, universityId);
    return { planId: created.planId, status: "completed", startDate: created.startDate, endDate: created.endDate };
  },
  async studentStudyPlannerAiStatus(jobId: string) {
    const plan = await prisma.studyPlan.findUnique({ where: { id: jobId }, select: { id: true, status: true, updatedAt: true } });
    return plan ? { jobId: plan.id, status: plan.status, updatedAt: plan.updatedAt } : { jobId, status: "unknown" };
  },

  // ─── Notifications ────────────────────────────────────────
  async notifyMany(universityId: string, targets: { facultyId?: string; studentId?: string }[], type: string, title: string, body: string, linkPath?: string) {
    if (targets.length === 0) return { created: 0 };
    await prisma.notification.createMany({
      data: targets.map((t) => ({ universityId, facultyId: t.facultyId ?? null, studentId: t.studentId ?? null, type, title, body, linkPath: linkPath ?? null })),
    });
    return { created: targets.length };
  },

  async notifyStudentsInBatch(universityId: string, batchId: string, semesterId: string, type: string, title: string, body: string, linkPath?: string) {
    const enrs = await prisma.studentEnrollment.findMany({
      where: { batchId, semesterId, isCurrent: true },
      select: { studentId: true },
    });
    return this.notifyMany(universityId, enrs.map((e) => ({ studentId: e.studentId })), type, title, body, linkPath);
  },

  async notificationsList(who: { facultyId?: string; studentId?: string }, page = 1, limit = 20, unreadOnly = false) {
    const where = { ...(unreadOnly ? { isRead: false } : {}), ...(who.facultyId ? { facultyId: who.facultyId } : { studentId: who.studentId ?? undefined }) };
    const total = await prisma.notification.count({ where });
    const data = await prisma.notification.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit,
    });
    return { data, ...buildPagination(page, limit, total) };
  },

  async notificationsUnreadCount(who: { facultyId?: string; studentId?: string }) {
    const count = await prisma.notification.count({
      where: { isRead: false, ...(who.facultyId ? { facultyId: who.facultyId } : { studentId: who.studentId ?? undefined }) },
    });
    return { count };
  },

  async markNotificationRead(id: string, who: { facultyId?: string; studentId?: string }) {
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n) throw new ApiError(404, "NOT_FOUND", "Notification not found.");
    if ((who.facultyId && n.facultyId !== who.facultyId) || (who.studentId && n.studentId !== who.studentId)) {
      throw new ApiError(403, "FORBIDDEN", "Not your notification.");
    }
    await prisma.notification.update({ where: { id }, data: { isRead: true } });
    return { id, isRead: true };
  },

  async markAllNotificationsRead(who: { facultyId?: string; studentId?: string }) {
    const r = await prisma.notification.updateMany({
      where: { isRead: false, ...(who.facultyId ? { facultyId: who.facultyId } : { studentId: who.studentId ?? undefined }) },
      data: { isRead: true },
    });
    return { updated: r.count };
  },

  // ─── Exam coordination (paper checking + publish) ──────────
  // T1–T3 papers are out of 25. T4 is written out of 50 and stored ÷2 (max 25).
  async examCoordinators(scope: Scope) {
    const sem = await scopeSemester(scope);
    const rows = sem.id ? await prisma.examCoordinator.findMany({ where: { semesterId: sem.id } }) : [];
    const facIds = rows.map((r) => r.facultyId);
    const facs = facIds.length ? await prisma.faculty.findMany({ where: { id: { in: facIds } }, select: { id: true, name: true, employeeId: true } }) : [];
    const byId = new Map(facs.map((f) => [f.id, f]));
    const options = await prisma.faculty.findMany({
      where: { universityId: scope.universityId, isHod: false, isDean: false, isActive: true, deletedAt: null },
      select: { id: true, name: true, employeeId: true }, orderBy: { name: "asc" },
    });
    return {
      semesterId: sem.id,
      coordinators: [1, 2].map((slot) => {
        const row = rows.find((r) => r.slot === slot);
        const f = row ? byId.get(row.facultyId) : undefined;
        return { slot, facultyId: row?.facultyId ?? null, name: f?.name ?? null, employeeId: f?.employeeId ?? null };
      }),
      facultyOptions: options,
    };
  },

  async assignExamCoordinator(scope: Scope, slot: number, facultyId: string) {
    if (slot !== 1 && slot !== 2) throw new ApiError(400, "VALIDATION_ERROR", "Slot must be 1 or 2.");
    const sem = await scopeSemester(scope);
    if (!sem.id) throw new ApiError(400, "NO_ACTIVE_SEMESTER", "No active semester.");
    const fac = await prisma.faculty.findFirst({ where: { id: facultyId, universityId: scope.universityId, isHod: false, deletedAt: null } });
    if (!fac) throw new ApiError(404, "FACULTY_NOT_FOUND", "Faculty not found or is a HOD.");
    const other = await prisma.examCoordinator.findFirst({ where: { semesterId: sem.id, facultyId, NOT: { slot } } });
    if (other) throw new ApiError(409, "ALREADY_COORDINATOR", "This faculty already holds the other coordinator slot.");
    await prisma.examCoordinator.upsert({
      where: { semesterId_slot: { semesterId: sem.id, slot } },
      update: { facultyId, assignedById: scope.userId },
      create: { universityId: scope.universityId, semesterId: sem.id, slot, facultyId, assignedById: scope.userId },
    });
    await this.notifyMany(scope.universityId, [{ facultyId }], "EXAM_COORDINATOR_ASSIGNED",
      `You are Exam-Coordinator-${slot}`, `The HOD assigned you as Exam-Coordinator-${slot} for ${sem.label}.`, "/faculty/exams");
    return { slot, facultyId, name: fac.name };
  },

  async removeExamCoordinator(scope: Scope, slot: number) {
    const sem = await scopeSemester(scope);
    await prisma.examCoordinator.deleteMany({ where: { semesterId: sem.id, slot } });
    return { removed: true };
  },

  async facultyExamStatus(facultyId: string, universityId: string) {
    // ponytail: resolve THIS faculty's active semester (multi-active-sem era).
    const sem = await facultyActiveSemester(facultyId, universityId);
    const row = sem.id ? await prisma.examCoordinator.findFirst({ where: { semesterId: sem.id, facultyId } }) : null;
    return { isCoordinator: !!row, slot: row?.slot ?? null, semesterId: sem.id, semesterLabel: sem.label };
  },

  async examContext(universityId: string, facultyId?: string) {
    const sem = facultyId ? await facultyActiveSemester(facultyId, universityId) : await getActiveSemester(universityId);
    if (!sem.id) return { semesterId: "", activeYearLevel: null, phases: [], subjects: [], batches: [], faculty: [], subjectFaculty: {} };
    const [phases, subjects, batches, faculty, yearAssignments] = await Promise.all([
      prisma.phase.findMany({ where: { semesterId: sem.id }, orderBy: { number: "asc" } }),
      subjectsBySemester(sem.id),
      prisma.batch.findMany({ where: { academicYearId: sem.academicYearId }, orderBy: { code: "asc" } }),
      prisma.faculty.findMany({ where: { universityId, isHod: false, isDean: false, isActive: true, deletedAt: null }, select: { id: true, name: true, employeeId: true }, orderBy: { name: "asc" } }),
      // a faculty's year(s) come from the year levels of batches they teach, across all semesters
      prisma.facultyBatchAssignment.findMany({ where: { faculty: { universityId } }, select: { facultyId: true, batch: { select: { yearLevel: true } } } }),
    ]);
    const facultyBySubject = await subjectFacultyMap(sem.id);
    const activeYearLevel = sem.yearLevel;
    const yearsByFaculty = new Map<string, Set<string>>();
    for (const a of yearAssignments) {
      const s = yearsByFaculty.get(a.facultyId) ?? new Set<string>();
      s.add(a.batch.yearLevel);
      yearsByFaculty.set(a.facultyId, s);
    }
    // one year per faculty for grouping: prefer the active year if they teach it
    const facultyYear = (id: string): string | null => {
      const s = yearsByFaculty.get(id);
      if (!s || s.size === 0) return null;
      return s.has(activeYearLevel) ? activeYearLevel : [...s][0];
    };
    return {
      semesterId: sem.id,
      activeYearLevel,
      phases: phases.map((p) => ({ id: p.id, label: p.label, number: p.number, entryMax: p.number === 4 ? 50 : 25 })),
      subjects: subjects.map((s) => ({ id: s.id, code: s.code, name: s.name })),
      batches: batches.map((b) => ({ id: b.id, code: b.code })),
      faculty: faculty.map((f) => ({ ...f, yearLevel: facultyYear(f.id) })),
      // subjectId → [facultyId] so the checker dropdown can filter to that subject's teachers
      subjectFaculty: Object.fromEntries([...facultyBySubject.entries()].map(([sid, fs]) => [sid, fs.map((f) => f.id)])),
    };
  },

  async examAssignments(universityId: string, opts: { phaseId?: string; facultyId?: string } = {}) {
    const sem = await getActiveSemester(universityId);
    if (!sem.id) return { data: [] };
    const rows = await prisma.paperCheckAssignment.findMany({
      where: { semesterId: sem.id, ...(opts.phaseId ? { phaseId: opts.phaseId } : {}), ...(opts.facultyId ? { facultyId: opts.facultyId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    if (rows.length === 0) return { data: [] };
    const [phases, subjects, facs] = await Promise.all([
      prisma.phase.findMany({ where: { semesterId: sem.id } }),
      subjectsBySemester(sem.id),
      prisma.faculty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.facultyId))] } }, select: { id: true, name: true } }),
    ]);
    const phaseById2 = new Map(phases.map((p) => [p.id, p]));
    const subjById = new Map(subjects.map((s) => [s.id, s]));
    const facById = new Map(facs.map((f) => [f.id, f]));
    const data = await Promise.all(rows.map(async (r) => {
      const enrs = await examRangeEnrollments(sem.id, r.subjectId, r.fromEnrollmentNo, r.toEnrollmentNo);
      const ids = enrs.map((e) => e.id);
      const results = ids.length ? await prisma.result.findMany({ where: { enrollmentId: { in: ids }, phaseId: r.phaseId, subjectId: r.subjectId }, select: { isPublished: true } }) : [];
      const marked = results.length;
      const published = results.length > 0 && results.every((x) => x.isPublished);
      return {
        id: r.id, phaseId: r.phaseId, phaseLabel: phaseById2.get(r.phaseId)?.label ?? "?",
        subjectId: r.subjectId, subjectCode: subjById.get(r.subjectId)?.code ?? "?",
        facultyId: r.facultyId, facultyName: facById.get(r.facultyId)?.name ?? "?",
        fromEnrollmentNo: r.fromEnrollmentNo, toEnrollmentNo: r.toEnrollmentNo,
        totalStudents: ids.length, markedCount: marked,
        status: published ? "Published" : marked === 0 ? "Pending" : marked < ids.length ? "In Progress" : "Complete",
        createdAt: r.createdAt,
      };
    }));
    return { data };
  },

  async createExamAssignment(coordId: string, universityId: string, body: { phaseId: string; subjectId: string; facultyId: string; fromEnrollmentNo: string; toEnrollmentNo: string }) {
    const { semester } = await requireExamCoordinator(coordId, universityId);
    for (const k of ["phaseId", "subjectId", "facultyId", "fromEnrollmentNo", "toEnrollmentNo"] as const) {
      if (!body[k]) throw new ApiError(400, "VALIDATION_ERROR", `${k} is required.`);
    }
    const from = body.fromEnrollmentNo.trim().toUpperCase();
    const to = body.toEnrollmentNo.trim().toUpperCase();
    if (from > to) throw new ApiError(400, "VALIDATION_ERROR", "From-enrollment must not be greater than to-enrollment.");
    // Subject teachers are preferred in the desk UI, but an active faculty
    // member from another year may check papers when staffing is tight.
    const checker = await prisma.faculty.findFirst({
      where: { id: body.facultyId, universityId, isHod: false, isDean: false, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!checker) throw new ApiError(400, "INVALID_CHECKER", "Choose an active faculty member from this university.");
    const enrs = await examRangeEnrollments(semester.id, body.subjectId, from, to);
    if (enrs.length === 0) throw new ApiError(400, "EMPTY_RANGE", "No students found in that enrollment range for this subject.");
    // overlap is now per (phase, subject) — batch is no longer part of the key
    const siblings = await prisma.paperCheckAssignment.findMany({ where: { semesterId: semester.id, phaseId: body.phaseId, subjectId: body.subjectId } });
    if (siblings.some((s) => from <= s.toEnrollmentNo && to >= s.fromEnrollmentNo)) {
      throw new ApiError(409, "RANGE_OVERLAP", "This range overlaps an existing assignment for the same paper.");
    }
    const row = await prisma.paperCheckAssignment.create({
      data: { universityId, semesterId: semester.id, phaseId: body.phaseId, subjectId: body.subjectId, facultyId: body.facultyId, fromEnrollmentNo: from, toEnrollmentNo: to, assignedById: coordId },
    });
    const [subject, phase] = await Promise.all([subjectById(body.subjectId), phaseById(body.phaseId)]);
    await this.notifyMany(universityId, [{ facultyId: body.facultyId }], "PAPER_CHECK_ASSIGNED",
      `Papers to check — ${subject.code} ${phase.label}`,
      `You have ${enrs.length} papers to check (${from} to ${to}).`, "/faculty/exams");
    return { id: row.id, studentCount: enrs.length };
  },

  async deleteExamAssignment(coordId: string, universityId: string, id: string) {
    await requireExamCoordinator(coordId, universityId);
    await prisma.paperCheckAssignment.deleteMany({ where: { id, universityId } });
    return { deleted: true };
  },

  async examAssignmentStudents(facultyId: string, universityId: string, assignmentId: string) {
    const a = await prisma.paperCheckAssignment.findUnique({ where: { id: assignmentId } });
    if (!a || a.universityId !== universityId) throw new ApiError(404, "NOT_FOUND", "Assignment not found.");
    if (a.facultyId !== facultyId) {
      const coord = await prisma.examCoordinator.findFirst({ where: { semesterId: a.semesterId, facultyId } });
      if (!coord) throw new ApiError(403, "FORBIDDEN", "This paper set is not assigned to you.");
    }
    const [phase, subject] = await Promise.all([phaseById(a.phaseId), subjectById(a.subjectId)]);
    const entryMax = phase.number === 4 ? 50 : 25;
    const enrs = await examRangeEnrollments(a.semesterId, a.subjectId, a.fromEnrollmentNo, a.toEnrollmentNo);
    const results = await prisma.result.findMany({ where: { enrollmentId: { in: enrs.map((e) => e.id) }, phaseId: a.phaseId, subjectId: a.subjectId } });
    const resByEnr = new Map(results.map((r) => [r.enrollmentId, r]));
    return {
      assignment: {
        id: a.id, phaseLabel: phase.label, phaseNumber: phase.number, entryMax,
        subjectCode: subject.code, subjectName: subject.name,
        fromEnrollmentNo: a.fromEnrollmentNo, toEnrollmentNo: a.toEnrollmentNo,
        isPublished: results.length > 0 && results.every((r) => r.isPublished),
      },
      students: enrs.map((e) => {
        const r = resByEnr.get(e.id);
        return {
          enrollmentId: e.id, rollNo: e.rollNo, enrollmentNo: e.student.enrollmentNo, name: e.student.name,
          // stored marks are always /25; show the entry-scale value (T4 doubles back to /50)
          enteredMarks: r ? r.marksObtained * (entryMax === 50 ? 2 : 1) : null,
          grade: r?.grade ?? null, isPublished: r?.isPublished ?? false,
        };
      }),
    };
  },

  async saveExamAssignmentMarks(facultyId: string, universityId: string, assignmentId: string, marks: { enrollmentId: string; marks: number | null }[]) {
    const a = await prisma.paperCheckAssignment.findUnique({ where: { id: assignmentId } });
    if (!a || a.universityId !== universityId) throw new ApiError(404, "NOT_FOUND", "Assignment not found.");
    if (a.facultyId !== facultyId) {
      const coord = await prisma.examCoordinator.findFirst({ where: { semesterId: a.semesterId, facultyId } });
      if (!coord) throw new ApiError(403, "FORBIDDEN", "This paper set is not assigned to you.");
    }
    const phase = await phaseById(a.phaseId);
    const entryMax = phase.number === 4 ? 50 : 25;
    const allowedIds = new Set((await examRangeEnrollments(a.semesterId, a.subjectId, a.fromEnrollmentNo, a.toEnrollmentNo)).map((e) => e.id));
    let saved = 0;
    for (const m of marks) {
      if (m.marks == null) continue;
      if (!allowedIds.has(m.enrollmentId)) throw new ApiError(400, "OUT_OF_RANGE", "Student is outside your assigned range.");
      if (!Number.isFinite(m.marks) || m.marks < 0 || m.marks > entryMax) {
        throw new ApiError(400, "VALIDATION_ERROR", `Marks must be between 0 and ${entryMax}.`);
      }
      const stored = entryMax === 50 ? m.marks / 2 : m.marks; // T4: /50 entry → /25 stored
      const existing = await prisma.result.findUnique({
        where: { enrollmentId_phaseId_subjectId: { enrollmentId: m.enrollmentId, phaseId: a.phaseId, subjectId: a.subjectId } },
      });
      if (existing?.isPublished) throw new ApiError(409, "ALREADY_PUBLISHED", "Marks are live — they can no longer be edited.");
      const grade = gradeFromPct((stored / 25) * 100);
      if (existing) {
        await prisma.result.update({ where: { id: existing.id }, data: { marksObtained: stored, maxMarks: 25, grade, uploadedById: facultyId } });
      } else {
        await prisma.result.create({ data: { enrollmentId: m.enrollmentId, phaseId: a.phaseId, subjectId: a.subjectId, marksObtained: stored, maxMarks: 25, grade, uploadedById: facultyId } });
      }
      saved++;
    }
    return { saved };
  },

  // Publishing is a HOD action: checker saves stay draft (visible in HOD tracking) until the HOD pushes live.
  async examPublish(universityId: string, phaseId: string) {
    const semester = await getActiveSemester(universityId);
    if (!semester.id) throw new ApiError(400, "NO_ACTIVE_SEMESTER", "No active semester.");
    const assignments = await prisma.paperCheckAssignment.findMany({ where: { semesterId: semester.id, phaseId } });
    if (assignments.length === 0) throw new ApiError(400, "NO_ASSIGNMENTS", "No paper-check assignments exist for this phase.");
    const incomplete: string[] = [];
    const enrollmentIds = new Set<string>();
    for (const a of assignments) {
      const enrs = await examRangeEnrollments(semester.id, a.subjectId, a.fromEnrollmentNo, a.toEnrollmentNo);
      const marked = await prisma.result.count({ where: { enrollmentId: { in: enrs.map((e) => e.id) }, phaseId, subjectId: a.subjectId } });
      if (marked < enrs.length) incomplete.push(`${a.fromEnrollmentNo}–${a.toEnrollmentNo} (${marked}/${enrs.length})`);
      enrs.forEach((e) => enrollmentIds.add(e.id));
    }
    if (incomplete.length > 0) throw new ApiError(400, "INCOMPLETE_RESULTS", `Ranges still missing marks: ${incomplete.join(", ")}`);
    const publishedAt = new Date();
    await prisma.result.updateMany({
      where: { phaseId, enrollmentId: { in: [...enrollmentIds] }, isPublished: false },
      data: { isPublished: true, publishedAt },
    });
    const phase = await phaseById(phaseId);
    const students = await prisma.studentEnrollment.findMany({ where: { id: { in: [...enrollmentIds] } }, select: { studentId: true } });
    await this.notifyMany(universityId, [...new Set(students.map((s) => s.studentId))].map((studentId) => ({ studentId })),
      "RESULT_UPLOADED", `${phase.label} Results are Live`, `Your ${phase.label} results have been published. Tap to view.`, "/student/results");
    const coordinators = await prisma.examCoordinator.findMany({ where: { semesterId: semester.id }, select: { facultyId: true } });
    await this.notifyMany(universityId, coordinators.map((c) => ({ facultyId: c.facultyId })),
      "RESULT_UPLOADED", `${phase.label} Results pushed live`, `The HOD published ${phase.label} results for ${students.length} students.`, "/faculty/exams");
    return { published: true, publishedAt, studentCount: students.length };
  },

  // ─── University (Dean) portal ───────────────────────────────
  async uniOverview(universityId: string) {
    const uni = await getUniversity(universityId);
    const activeYear = await prisma.academicYear.findFirst({ where: { universityId, status: "ACTIVE" } });
    const activeSem = await prisma.semester.findFirst({ where: { universityId, status: "ACTIVE" } });
    const [students, faculty, hods, branches, batches, enrollments] = await Promise.all([
      prisma.student.count({ where: { universityId, deletedAt: null } }),
      prisma.faculty.count({ where: { universityId, deletedAt: null, isDean: false } }),
      prisma.faculty.count({ where: { universityId, deletedAt: null, isHod: true } }),
      prisma.student.groupBy({ by: ["branch"], where: { universityId, deletedAt: null }, _count: true }),
      activeYear ? prisma.batch.count({ where: { academicYearId: activeYear.id } }) : 0,
      activeSem ? prisma.studentEnrollment.count({ where: { semesterId: activeSem.id, isCurrent: true } }) : 0,
    ]);
    const activity = await prisma.activityLog.findMany({
      where: { universityId }, orderBy: { createdAt: "desc" }, take: 8,
      include: { faculty: { select: { name: true } } },
    });
    return {
      university: { name: uni.name, slug: uni.slug, plan: uni.plan },
      activeYear: activeYear ? { id: activeYear.id, label: activeYear.label } : null,
      activeSemester: activeSem ? { id: activeSem.id, label: activeSem.label, number: activeSem.number } : null,
      counts: { students, faculty, hods, batches, currentEnrollments: enrollments },
      branchBreakdown: branches.map((b) => ({ branch: b.branch, count: b._count })),
      recentActivity: activity.map((a) => ({ id: a.id, type: a.type, title: a.title, description: a.description, by: a.faculty.name, createdAt: a.createdAt })),
    };
  },

  async uniYears(universityId: string) {
    const years = await prisma.academicYear.findMany({
      where: { universityId }, orderBy: { label: "desc" },
      include: { semesters: { orderBy: { number: "asc" } }, batches: { orderBy: { code: "asc" } } },
    });
    return {
      data: await Promise.all(years.map(async (y) => ({
        id: y.id, label: y.label, status: y.status, startDate: y.startDate, endDate: y.endDate,
        semesters: y.semesters.map((s) => ({ id: s.id, number: s.number, label: s.label, yearLevel: s.yearLevel, status: s.status, startDate: s.startDate, endDate: s.endDate })),
        batches: await Promise.all(y.batches.map(async (b) => ({
          id: b.id, code: b.code, yearLevel: b.yearLevel,
          studentCount: await prisma.studentEnrollment.count({ where: { batchId: b.id, isCurrent: true } }),
        }))),
      }))),
    };
  },

  // An Academic Year is a 4-year admission BATCH (e.g. "2024-2028"): FY(1,2) SY(3,4) TY(5,6) FINAL(7,8).
  // On creation the batch is ACTIVE and starts at Semester 1 (only one semester active per batch).
  // Several batches run concurrently — one per year level (FY/SY/TY/FINAL).
  async uniCreateYear(universityId: string, body: { label: string; startDate?: string; endDate?: string; activeSemester?: number }) {
    if (!body.label) throw new ApiError(400, "VALIDATION_ERROR", "label is required.");
    const label = body.label.trim();
    const m = /^(\d{4})-(\d{4})$/.exec(label);
    if (!m) throw new ApiError(400, "VALIDATION_ERROR", "Label must be a 4-year batch, e.g. 2024-2028.");
    const y1 = Number(m[1]), y2 = Number(m[2]);
    if (y2 - y1 !== 4) throw new ApiError(400, "VALIDATION_ERROR", "A batch must span 4 years, e.g. 2024-2028.");
    const exists = await prisma.academicYear.findFirst({ where: { universityId, label } });
    if (exists) throw new ApiError(409, "CONFLICT", "This batch already exists.");
    const start = body.startDate ? new Date(body.startDate) : new Date(`${y1}-07-01`);
    const end = body.endDate ? new Date(body.endDate) : new Date(`${y2}-05-31`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new ApiError(400, "VALIDATION_ERROR", "The end date must be after the start date.");
    const activeNum = body.activeSemester && body.activeSemester >= 1 && body.activeSemester <= 8 ? body.activeSemester : 1;
    const university = await prisma.university.findUnique({ where: { id: universityId }, select: { id: true } });
    if (!university) throw new ApiError(409, "UNIVERSITY_CONTEXT_STALE", "Your session is connected to an old university record. Sign in again and retry.");
    // 8 semesters, 4 phases each. The transaction prevents a partial year if
    // any semester/phase insert fails.
    const y = await prisma.$transaction(async (tx) => {
      const year = await tx.academicYear.create({ data: { universityId, label, status: "ACTIVE", startDate: start, endDate: end } });
      const perSem = (end.getTime() - start.getTime()) / 8;
      const YL = ["FY", "FY", "SY", "SY", "TY", "TY", "FINAL", "FINAL"];
      for (let i = 1; i <= 8; i++) {
        const semStart = new Date(start.getTime() + perSem * (i - 1));
        const semEnd = new Date(start.getTime() + perSem * i);
        const status = i === activeNum ? "ACTIVE" : i < activeNum ? "COMPLETE" : "UPCOMING";
        const sem = await tx.semester.create({ data: { universityId, academicYearId: year.id, number: i, label: `Semester ${i}`, yearLevel: YL[i - 1] as any, status: status as any, startDate: semStart, endDate: semEnd } });
        const phaseSpan = (semEnd.getTime() - semStart.getTime()) / 4;
        await tx.phase.createMany({ data: [1, 2, 3, 4].map((p) => ({ semesterId: sem.id, label: `T${p}`, number: p, startDate: new Date(semStart.getTime() + phaseSpan * (p - 1)), endDate: new Date(semStart.getTime() + phaseSpan * p) })) });
      }
      return year;
    });
    return { id: y.id, label: y.label, status: y.status, semestersCreated: 8 };
  },

  // ponytail: multiple batches active at once — just flip this one ACTIVE, don't archive siblings.
  async uniActivateYear(universityId: string, yearId: string) {
    const y = await prisma.academicYear.findFirst({ where: { id: yearId, universityId } });
    if (!y) throw new ApiError(404, "NOT_FOUND", "Academic year not found.");
    await prisma.academicYear.update({ where: { id: yearId }, data: { status: "ACTIVE" } });
    return { id: yearId, status: "ACTIVE" };
  },

  async uniCreateSemester(universityId: string, body: { academicYearId: string; number: number; startDate: string; endDate: string }) {
    const n = Number(body.number);
    if (!body.academicYearId || !n || n < 1 || n > 8 || !body.startDate || !body.endDate) {
      throw new ApiError(400, "VALIDATION_ERROR", "academicYearId, number (1–8), startDate, endDate required.");
    }
    const yearLevel = n <= 2 ? "FY" : n <= 4 ? "SY" : n <= 6 ? "TY" : "FINAL";
    const year = await prisma.academicYear.findFirst({ where: { id: body.academicYearId, universityId }, select: { id: true } });
    if (!year) throw new ApiError(400, "INVALID_ACADEMIC_YEAR", "Academic year does not belong to this university.");
    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new ApiError(400, "VALIDATION_ERROR", "The end date must be after the start date.");
    const duplicate = await prisma.semester.findFirst({ where: { academicYearId: body.academicYearId, number: n } });
    if (duplicate) throw new ApiError(409, "CONFLICT", `Semester ${n} already exists for this academic year.`);
    // 4 phases (T1–T4) split evenly across the semester — created with the semester in one
    // transaction so a phase-insert failure can't leave a phaseless semester behind.
    const span = (end.getTime() - start.getTime()) / 4;
    const sem = await prisma.$transaction(async (tx) => {
      const sem = await tx.semester.create({
        data: { universityId, academicYearId: body.academicYearId, number: n, label: `Semester ${n}`, yearLevel, status: "UPCOMING", startDate: start, endDate: end },
      });
      await tx.phase.createMany({
        data: [1, 2, 3, 4].map((i) => ({
          semesterId: sem.id, label: `T${i}`, number: i,
          startDate: new Date(start.getTime() + span * (i - 1)),
          endDate: new Date(start.getTime() + span * i),
        })),
      });
      return sem;
    });
    return { id: sem.id, label: sem.label, yearLevel };
  },

  // Only one semester active PER batch/year. Earlier sems → COMPLETE, later → UPCOMING, this one → ACTIVE.
  async uniActivateSemester(universityId: string, semesterId: string) {
    const s = await prisma.semester.findFirst({ where: { id: semesterId, universityId } });
    if (!s) throw new ApiError(404, "NOT_FOUND", "Semester not found.");
    // Atomic: sibling status shifts + scope migration must all land together, or none — a partial
    // failure would leave the year with no ACTIVE semester or with scopes on the wrong semester.
    await prisma.$transaction(async (tx) => {
      await tx.semester.updateMany({ where: { academicYearId: s.academicYearId, number: { lt: s.number } }, data: { status: "COMPLETE" } });
      await tx.semester.updateMany({ where: { academicYearId: s.academicYearId, number: { gt: s.number } }, data: { status: "UPCOMING" } });
      await tx.semester.update({ where: { id: semesterId }, data: { status: "ACTIVE" } });
      // ponytail: HodBatchScope.batchId is @unique (one row per batch). Move every scope in this
      // year onto the newly active semester so the HOD keeps ownership when advancing (Sem 3 → 4)
      // and can upload the new roster there.
      const yearBatchIds = (await tx.batch.findMany({ where: { academicYearId: s.academicYearId }, select: { id: true } })).map((b) => b.id);
      if (yearBatchIds.length) {
        await tx.hodBatchScope.updateMany({ where: { batchId: { in: yearBatchIds } }, data: { semesterId } });
      }
    });
    return { id: semesterId, status: "ACTIVE" };
  },

  async uniCreateBatch(universityId: string, body: { academicYearId: string; code: string; yearLevel: string }) {
    if (!body.academicYearId || !body.code || !body.yearLevel) throw new ApiError(400, "VALIDATION_ERROR", "academicYearId, code, yearLevel required.");
    const year = await prisma.academicYear.findFirst({ where: { id: body.academicYearId, universityId }, select: { id: true } });
    if (!year) throw new ApiError(400, "INVALID_ACADEMIC_YEAR", "Academic year does not belong to this university.");
    const exists = await prisma.batch.findFirst({ where: { academicYearId: body.academicYearId, code: body.code } });
    if (exists) throw new ApiError(409, "CONFLICT", "Batch code already exists in this year.");
    const b = await prisma.batch.create({
      data: { universityId, academicYearId: body.academicYearId, code: body.code, yearLevel: body.yearLevel as any },
    });
    return { id: b.id, code: b.code };
  },

  // Batch initial-letter workflow: HOD picks initial + count → auto-creates {initial}1..{initial}N.
  // First-semester restriction: can only bulk-create during Semester 1 of the year level.
  async uniBulkCreateBatches(universityId: string, body: { academicYearId: string; hodId: string; initial: string; count: number; yearLevel: string }) {
    for (const k of ["academicYearId", "hodId", "initial", "count", "yearLevel"] as const) {
      if (!body[k]) throw new ApiError(400, "VALIDATION_ERROR", `${k} is required.`);
    }
    if (!/^[A-Z]$/.test(body.initial.toUpperCase())) throw new ApiError(400, "VALIDATION_ERROR", "initial must be a single letter A–Z.");
    if (body.count < 1 || body.count > 20) throw new ApiError(400, "VALIDATION_ERROR", "count must be 1–20.");
    const hod = await prisma.faculty.findFirst({ where: { id: body.hodId, universityId, isHod: true, deletedAt: null } });
    if (!hod) throw new ApiError(404, "HOD_NOT_FOUND", "HOD not found.");
    // Only allow bulk creation when the first semester of the year level is UPCOMING/ACTIVE.
    const firstSemNum = body.yearLevel === "FY" ? 1 : body.yearLevel === "SY" ? 3 : body.yearLevel === "TY" ? 5 : 7;
    const firstSem = await prisma.semester.findFirst({ where: { academicYearId: body.academicYearId, number: firstSemNum } });
    if (!firstSem) throw new ApiError(400, "NO_FIRST_SEMESTER", `Semester ${firstSemNum} (first of ${body.yearLevel}) doesn't exist.`);
    if (firstSem.status === "COMPLETE") throw new ApiError(400, "FIRST_SEMESTER_COMPLETE", "Batches can only be created during the first semester of the year level.");
    const initial = body.initial.toUpperCase();
    // Atomic: each batch and its HOD scope are created together, and the whole bulk either lands
    // or rolls back — no half-created batch runs (batch with no scope, or partial N-of-M).
    const { created, skipped } = await prisma.$transaction(async (tx) => {
      const created: { id: string; code: string }[] = [];
      let skipped = 0;
      for (let i = 1; i <= body.count; i++) {
        const code = `${initial}${i}`;
        const dup = await tx.batch.findFirst({ where: { academicYearId: body.academicYearId, code } });
        if (dup) { skipped++; continue; }
        const batch = await tx.batch.create({
          data: { universityId, academicYearId: body.academicYearId, code, yearLevel: body.yearLevel as any },
        });
        await tx.hodBatchScope.create({ data: { facultyId: body.hodId, batchId: batch.id, semesterId: firstSem.id, academicYearId: body.academicYearId } });
        created.push({ id: batch.id, code });
      }
      return { created, skipped };
    });
    return { created, initial, count: created.length, skipped };
  },

  // Promotion Dashboard (Dean): per-HOD promotion status for the current year-end transition,
  // grouped by year level, with a per-level `allComplete` gate. Status is DERIVED from enrollment
  // state (no separate flag to drift): at the HOD's active semester, isCurrent=true → still to
  // promote (pending); isCurrent=false → already moved forward (promoted).
  async promotionDashboard(universityId: string) {
    const hods = await prisma.faculty.findMany({
      where: { universityId, isHod: true, isDean: false, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, year: true, employeeId: true },
    });
    const rows = await Promise.all(hods.map(async (hod) => {
      const scopes = await prisma.hodBatchScope.findMany({ where: { facultyId: hod.id }, select: { batchId: true } });
      const batchIds = scopes.map((s) => s.batchId);
      // the HOD's active semester = the ACTIVE semester at their year level
      const activeSem = hod.year
        ? await prisma.semester.findFirst({ where: { universityId, status: "ACTIVE", yearLevel: hod.year as any } })
        : null;
      let total = 0, promoted = 0, pending = 0;
      if (activeSem && batchIds.length) {
        const enrs = await prisma.studentEnrollment.findMany({ where: { semesterId: activeSem.id, batchId: { in: batchIds } }, select: { isCurrent: true } });
        total = enrs.length;
        promoted = enrs.filter((e) => !e.isCurrent).length;
        pending = enrs.filter((e) => e.isCurrent).length;
      }
      const promotionDue = !!activeSem && activeSem.number % 2 === 0; // year-end semesters
      let status: string;
      if (total === 0) status = "NO_DATA";
      else if (pending === 0) status = "COMPLETE";
      else if (promoted > 0) status = "IN_PROGRESS";
      else status = "PENDING";
      return {
        hodId: hod.id, name: hod.name, employeeId: hod.employeeId, yearLevel: hod.year,
        activeSemester: activeSem ? { label: activeSem.label, number: activeSem.number } : null,
        promotionDue, totalStudents: total, promoted, pending, status,
        progressPct: total ? Math.round((promoted / total) * 100) : 0,
      };
    }));
    // group by year level with a completion gate (only HODs with students count toward the gate)
    const byYear: Record<string, { hods: typeof rows; allComplete: boolean; pendingHods: number }> = {};
    for (const yl of ["FY", "SY", "TY", "FINAL"]) {
      const group = rows.filter((r) => r.yearLevel === yl);
      const withStudents = group.filter((r) => r.totalStudents > 0);
      const pendingHods = withStudents.filter((r) => r.status !== "COMPLETE").length;
      byYear[yl] = { hods: group, allComplete: withStudents.length > 0 && pendingHods === 0, pendingHods };
    }
    return { byYear, hods: rows };
  },

  async uniHods(universityId: string) {
    const activeSem = await prisma.semester.findFirst({ where: { universityId, status: "ACTIVE" } });
    const hods = await prisma.faculty.findMany({
      where: { universityId, isHod: true, deletedAt: null }, orderBy: { name: "asc" },
      include: { hodBatchScopes: { include: { batch: { select: { id: true, code: true } }, semester: { select: { id: true, label: true } } } } },
    });
    const batches = activeSem
      ? await prisma.batch.findMany({ where: { academicYearId: activeSem.academicYearId }, orderBy: { code: "asc" }, include: { hodScope: true } })
      : [];
    const options = await prisma.faculty.findMany({
      where: { universityId, isHod: false, isDean: false, isActive: true, deletedAt: null },
      select: { id: true, name: true, employeeId: true, year: true }, orderBy: { name: "asc" },
    });
    return {
      activeSemester: activeSem ? { id: activeSem.id, label: activeSem.label } : null,
      hods: hods.map((h) => {
        // A HOD owns one initial-group of batches — tag from the year level + that initial.
        const firstBatch = h.hodBatchScopes[0]?.batch.code ?? null;
        return {
          id: h.id, name: h.name, email: h.email, employeeId: h.employeeId, year: h.year, isActive: h.isActive,
          sectionTag: sectionTag(h.year, firstBatch),
          scopes: h.hodBatchScopes.map((s) => ({ batchId: s.batch.id, batchCode: s.batch.code, semesterLabel: s.semester.label })),
        };
      }),
      batches: batches.map((b) => ({ id: b.id, code: b.code, yearLevel: b.yearLevel, ownedBy: b.hodScope?.facultyId ?? null })),
      facultyOptions: options,
    };
  },

  async uniSetHod(universityId: string, facultyId: string, isHod: boolean) {
    const f = await prisma.faculty.findFirst({ where: { id: facultyId, universityId, deletedAt: null } });
    if (!f) throw new ApiError(404, "NOT_FOUND", "Faculty not found.");
    if (!isHod) {
      const scopes = await prisma.hodBatchScope.count({ where: { facultyId } });
      if (scopes > 0) throw new ApiError(409, "HAS_SCOPES", "Remove this HOD's batch assignments first.");
    }
    await prisma.faculty.update({ where: { id: facultyId }, data: { isHod } });
    return { id: facultyId, isHod };
  },

  async uniAssignHodScope(universityId: string, facultyId: string, batchId: string) {
    const activeSem = await prisma.semester.findFirst({ where: { universityId, status: "ACTIVE" } });
    if (!activeSem) throw new ApiError(400, "NO_ACTIVE_SEMESTER", "No active semester.");
    const hod = await prisma.faculty.findFirst({ where: { id: facultyId, universityId, isHod: true, deletedAt: null } });
    if (!hod) throw new ApiError(404, "HOD_NOT_FOUND", "Faculty is not a HOD.");
    const batch = await batchById(batchId);
    if (batch.universityId !== universityId) throw new ApiError(400, "INVALID_BATCH", "Batch does not belong to this university.");
    // batchId is @unique on HodBatchScope — one owner per batch
    await prisma.hodBatchScope.upsert({
      where: { batchId },
      update: { facultyId, semesterId: activeSem.id, academicYearId: batch.academicYearId },
      create: { facultyId, batchId, semesterId: activeSem.id, academicYearId: batch.academicYearId },
    });
    return { batchId, facultyId, batchCode: batch.code };
  },

  async uniRemoveHodScope(universityId: string, batchId: string) {
    // Ownership: never let a Dean drop a scope for a batch in another university.
    const batch = await batchById(batchId);
    if (batch.universityId !== universityId) throw new ApiError(400, "INVALID_BATCH", "Batch does not belong to this university.");
    await prisma.hodBatchScope.deleteMany({ where: { batchId } });
    return { removed: true };
  },

  async uniFaculty(universityId: string, search?: string, page = 1, limit = 20) {
    const where = {
      universityId, deletedAt: null, isDean: false,
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }, { employeeId: { contains: search, mode: "insensitive" as const } }] } : {}),
    };
    const total = await prisma.faculty.count({ where });
    const rows = await prisma.faculty.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * limit, take: limit });
    // year comes from batch assignments (any semester's batches → yearLevel)
    const assignments = rows.length ? await prisma.facultyBatchAssignment.findMany({
      where: { facultyId: { in: rows.map((r) => r.id) } },
      select: { facultyId: true, batch: { select: { yearLevel: true } } },
    }) : [];
    const yearsByFac = new Map<string, Set<string>>();
    for (const a of assignments) {
      const s = yearsByFac.get(a.facultyId) ?? new Set<string>();
      s.add(a.batch.yearLevel);
      yearsByFac.set(a.facultyId, s);
    }
    return {
      data: rows.map((f) => ({
        id: f.id, name: f.name, email: f.email, employeeId: f.employeeId, year: f.year,
        isHod: f.isHod, mentorCode: f.mentorCode, isActive: f.isActive,
        yearLevels: [...(yearsByFac.get(f.id) ?? [])],
      })),
      ...buildPagination(page, limit, total),
    };
  },

  async uniSetFacultyActive(universityId: string, facultyId: string, isActive: boolean) {
    const f = await prisma.faculty.findFirst({ where: { id: facultyId, universityId } });
    if (!f) throw new ApiError(404, "NOT_FOUND", "Faculty not found.");
    await prisma.faculty.update({ where: { id: facultyId }, data: { isActive } });
    return { id: facultyId, isActive };
  },

  async uniUpdateFaculty(universityId: string, facultyId: string, body: { name?: string; email?: string; employeeId?: string; year?: string; mentorCode?: string | null }) {
    const f = await prisma.faculty.findFirst({ where: { id: facultyId, universityId } });
    if (!f) throw new ApiError(404, "NOT_FOUND", "Faculty not found.");
    await prisma.faculty.update({ where: { id: facultyId }, data: body });
    return { id: facultyId };
  },

  async uniDeleteFaculty(universityId: string, facultyId: string) {
    const f = await prisma.faculty.findFirst({ where: { id: facultyId, universityId } });
    if (!f) throw new ApiError(404, "NOT_FOUND", "Faculty not found.");
    if (f.isDean) throw new ApiError(403, "CANNOT_DELETE_DEAN", "Cannot delete the Dean.");
    const scopes = await prisma.hodBatchScope.count({ where: { facultyId } });
    if (scopes > 0) throw new ApiError(409, "HAS_SCOPES", "Remove this HOD's batch assignments first.");
    await prisma.faculty.update({ where: { id: facultyId }, data: { deletedAt: new Date() } });
    return { deleted: true };
  },

  async uniPromoteToHod(universityId: string, facultyId: string) {
    const f = await prisma.faculty.findFirst({ where: { id: facultyId, universityId, deletedAt: null } });
    if (!f) throw new ApiError(404, "NOT_FOUND", "Faculty not found.");
    if (f.isDean) throw new ApiError(400, "IS_DEAN", "Dean cannot be promoted to HOD.");
    if (f.isHod) return { id: facultyId, isHod: true, alreadyHod: true };
    await prisma.faculty.update({ where: { id: facultyId }, data: { isHod: true, mentorCode: null } });
    return { id: facultyId, isHod: true };
  },

  // CSV format: employee_id, name, email(optional), year, mentor_code
  // Auto-email = {name.toLowerCase().replace(/ /g,'.')}@mail.ljku.edu.in
  uniFacultyCsvTemplate() {
    return "employee_id,name,email,year,mentor_code\nEMP210,Rahul Patel,,SY,RPT\n";
  },

  async uniUploadFacultyCsv(universityId: string, buffer: Buffer | undefined) {
    if (!buffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    const rows = parseCsvRecords(buffer, ["employee_id", "name", "year", "mentor_code"]);
    let created = 0, updated = 0;
    const errors: { row: number; enrollmentNo: string; reason: string }[] = [];
    const conflicts: { row: number; enrollmentNo: string; reason: string }[] = [];
    const seen = new Set<string>();
    for (const { row, record } of rows) {
      const employeeId = String(record.employee_id ?? "").trim();
      const ref = employeeId || `row:${row}`;
      try {
        const name = String(record.name ?? "").trim();
        const year = String(record.year ?? "").trim().toUpperCase();
        const mentorCode = String(record.mentor_code ?? "").trim().toUpperCase() || null;
        if (!employeeId || !name || !year) { errors.push({ row, enrollmentNo: ref, reason: "Missing employee_id/name/year." }); continue; }
        if (!["FY", "SY", "TY", "FINAL"].includes(year)) { errors.push({ row, enrollmentNo: ref, reason: `Invalid year "${year}" (use FY/SY/TY/FINAL).` }); continue; }
        const email = String(record.email ?? "").trim() || `${name.toLowerCase().replace(/\s+/g, ".")}@mail.ljku.edu.in`;
        // In-file duplicate: same employee_id/email appears twice in THIS upload — flag the later row
        // as a conflict instead of silently overwriting the first via the update branch below.
        const keys = [`emp:${employeeId.toUpperCase()}`, `email:${email.toLowerCase()}`];
        if (keys.some((k) => seen.has(k))) { conflicts.push({ row, enrollmentNo: ref, reason: "Duplicate employee_id/email within the file." }); continue; }
        keys.forEach((k) => seen.add(k));
        const existing = await prisma.faculty.findFirst({ where: { OR: [{ employeeId }, { email }], universityId } });
        if (existing) {
          await prisma.faculty.update({ where: { id: existing.id }, data: { name, mentorCode, year: existing.year || year } });
          updated++;
        } else {
          await prisma.faculty.create({
            data: { universityId, employeeId, name, email, year: year, isHod: false, isActive: true, passwordHash: `${employeeId}@123`, mentorCode },
          });
          created++;
        }
      } catch (e) {
        errors.push({ row, enrollmentNo: ref, reason: e instanceof Error ? e.message : "Failed to import row." });
      }
    }
    return { totalRows: rows.length, created, updated, skipped: errors.length + conflicts.length, conflicts, errors, warnings: [] as string[] };
  },

  async uniStudents(universityId: string, opts: { search?: string; branch?: string; page?: number; limit?: number }) {
    const page = opts.page ?? 1, limit = opts.limit ?? 20;
    const where = {
      universityId, deletedAt: null,
      ...(opts.branch ? { branch: opts.branch } : {}),
      ...(opts.search ? { OR: [{ name: { contains: opts.search, mode: "insensitive" as const } }, { enrollmentNo: { contains: opts.search } }, { email: { contains: opts.search, mode: "insensitive" as const } }] } : {}),
    };
    const total = await prisma.student.count({ where });
    const rows = await prisma.student.findMany({
      where, orderBy: { enrollmentNo: "asc" }, skip: (page - 1) * limit, take: limit,
      include: {
        enrollments: {
          where: { isCurrent: true },
          include: {
            batch: { select: { code: true } },
            semester: { select: { label: true, number: true, yearLevel: true, academicYear: { select: { label: true } } } },
          },
          take: 1,
        },
      },
    });
    return {
      data: rows.map((s) => {
        const e = s.enrollments[0];
        return {
          id: s.id, enrollmentNo: s.enrollmentNo, name: s.name, email: s.email, branch: s.branch, admissionYear: s.admissionYear, isActive: s.isActive,
          batchCode: e?.batch.code ?? null,
          semesterLabel: e?.semester.label ?? null,
          semesterNumber: e?.semester.number ?? null,
          yearLevel: e?.semester.yearLevel ?? null,
          academicYearLabel: e?.semester.academicYear.label ?? null,
          rollNo: e?.rollNo ?? null,
          sectionTag: sectionTag(e?.semester.yearLevel, e?.batch.code),
        };
      }),
      ...buildPagination(page, limit, total),
    };
  },

  async uniSetStudentActive(universityId: string, studentId: string, isActive: boolean) {
    const s = await prisma.student.findFirst({ where: { id: studentId, universityId } });
    if (!s) throw new ApiError(404, "NOT_FOUND", "Student not found.");
    await prisma.student.update({ where: { id: studentId }, data: { isActive } });
    return { id: studentId, isActive };
  },

  async uniSettings(universityId: string) {
    const u = await getUniversity(universityId);
    return { id: u.id, name: u.name, slug: u.slug, logoUrl: u.logoUrl, website: u.website, contactEmail: u.contactEmail, address: u.address, plan: u.plan };
  },

  async uniBranches(universityId: string) {
    const branches = await prisma.universityBranch.findMany({ where: { universityId }, orderBy: { code: "asc" } });
    const counts = await prisma.student.groupBy({ by: ["branch"], where: { universityId, deletedAt: null }, _count: true });
    const countByCode = new Map(counts.map((c) => [c.branch, c._count]));
    return {
      data: branches.map((b) => ({ id: b.id, code: b.code, name: b.name, studentCount: countByCode.get(b.code) ?? 0 })),
      // students whose branch code has no UniversityBranch row (pre-rule data)
      orphanBranches: counts.filter((c) => !branches.some((b) => b.code === c.branch)).map((c) => ({ branch: c.branch, count: c._count })),
    };
  },

  async uniDeleteBranch(universityId: string, id: string) {
    const b = await prisma.universityBranch.findFirst({ where: { id, universityId } });
    if (!b) throw new ApiError(404, "NOT_FOUND", "Branch not found.");
    const inUse = await prisma.student.count({ where: { universityId, branch: b.code, deletedAt: null } });
    if (inUse > 0) throw new ApiError(409, "BRANCH_IN_USE", `${inUse} students belong to ${b.code} — it cannot be deleted.`);
    await prisma.universityBranch.delete({ where: { id } });
    return { deleted: true };
  },

  async uniUpdateSettings(universityId: string, body: { name?: string; logoUrl?: string; website?: string; contactEmail?: string; address?: string }) {
    const u = await prisma.university.update({
      where: { id: universityId },
      data: {
        ...(body.name ? { name: body.name } : {}),
        logoUrl: body.logoUrl ?? undefined, website: body.website ?? undefined,
        contactEmail: body.contactEmail ?? undefined, address: body.address ?? undefined,
      },
    });
    return { id: u.id, name: u.name };
  },

  // ─── HOD announcements ────────────────────────────────────
  async hodAnnouncements(universityId: string, page = 1, limit = 30) {
    const where = { universityId, deletedAt: null };
    const total = await prisma.announcement.count({ where });
    const rows = await prisma.announcement.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit,
      include: { faculty: { select: { name: true, isHod: true } } },
    });
    const batchCodeMap = new Map<string, string>();
    for (const r of rows) {
      if (r.scope === "BATCH" && r.scopeValue && !batchCodeMap.has(r.scopeValue)) {
        const b = await prisma.batch.findUnique({ where: { id: r.scopeValue }, select: { code: true } });
        batchCodeMap.set(r.scopeValue, b?.code ?? r.scopeValue);
      }
    }
    return {
      data: rows.map((r) => ({
        id: r.id, title: r.title, body: r.body, scope: r.scope,
        scopeLabel: r.scope === "BATCH" && r.scopeValue ? `Batch ${batchCodeMap.get(r.scopeValue)}` : r.scope === "YEAR_LEVEL" ? r.scopeValue : "All",
        senderName: r.faculty.name, senderRole: r.faculty.isHod ? "HOD" : "FACULTY",
        createdAt: r.createdAt,
      })),
      ...buildPagination(page, limit, total),
    };
  },

  async createHodAnnouncement(facultyId: string, universityId: string, body: { title: string; body: string; scope: "BATCH" | "YEAR_LEVEL" | "ALL" | "FACULTY_ONLY"; scopeValue?: string }) {
    if (!body.title || !body.body) throw new ApiError(400, "VALIDATION_ERROR", "Title and body required.");
    // FACULTY_ONLY targets the HOD's pool (no scopeValue needed — pool is derived from Faculty.hodId).
    if (body.scope !== "ALL" && body.scope !== "FACULTY_ONLY" && !body.scopeValue) throw new ApiError(400, "VALIDATION_ERROR", "scopeValue required for scoped announcements.");
    const a = await prisma.announcement.create({
      data: { universityId, facultyId, title: body.title, body: body.body, scope: body.scope as any, scopeValue: body.scopeValue ?? null },
    });
    await this.fanOutAnnouncement(universityId, body.scope, body.scopeValue, body.title, facultyId);
    return { id: a.id, title: a.title, scope: a.scope, createdAt: a.createdAt };
  },

  // ─── HOD: Timetable CRUD ───────────────────────────────────
  async listTimetable(scope: Scope, batchId?: string, semesterId?: string) {
    const semId = semesterId || (await scopeSemester(scope)).id;
    const slots = await prisma.timetableSlot.findMany({
      where: { semesterId: semId, ...(batchId ? { batchId } : { batchId: { in: scope.hodBatchIds } }) },
      include: { subject: { select: { id: true, code: true, name: true } }, batch: { select: { id: true, code: true } } },
      orderBy: [{ dayOfWeek: "asc" }, { slotStart: "asc" }],
    });
    const facultyIds = [...new Set(slots.map((s) => s.facultyId).filter(Boolean) as string[])];
    const faculties = facultyIds.length
      ? await prisma.faculty.findMany({ where: { id: { in: facultyIds } }, select: { id: true, name: true, employeeId: true } })
      : [];
    const facById = new Map(faculties.map((f) => [f.id, f]));
    return {
      semesterId: semId,
      slots: slots.map((s) => ({
        id: s.id, dayOfWeek: s.dayOfWeek, slotStart: s.slotStart, slotEnd: s.slotEnd, room: s.room,
        batchId: s.batchId, batchCode: s.batch.code,
        subjectId: s.subjectId, subjectCode: s.subject.code, subjectName: s.subject.name,
        facultyId: s.facultyId, facultyName: s.facultyId ? facById.get(s.facultyId)?.name ?? null : null,
      })),
    };
  },

  async createTimetableSlot(scope: Scope, body: { batchId: string; subjectId: string; facultyId?: string | null; dayOfWeek: number; slotStart: string; slotEnd: string; room?: string; semesterId?: string }) {
    const semId = body.semesterId || (await scopeSemester(scope)).id;
    if (!scope.hodBatchIds.includes(body.batchId)) throw new ApiError(403, "BATCH_NOT_IN_SCOPE", "Batch not in your scope.");
    const slot = await prisma.timetableSlot.create({
      data: {
        semesterId: semId, batchId: body.batchId, subjectId: body.subjectId,
        facultyId: body.facultyId ?? null,
        dayOfWeek: body.dayOfWeek, slotStart: body.slotStart, slotEnd: body.slotEnd,
        room: body.room ?? null,
      },
    });
    return { id: slot.id };
  },

  async updateTimetableSlot(id: string, body: Partial<{ subjectId: string; facultyId: string | null; dayOfWeek: number; slotStart: string; slotEnd: string; room: string | null }>) {
    await prisma.timetableSlot.update({
      where: { id },
      data: {
        subjectId: body.subjectId, facultyId: body.facultyId,
        dayOfWeek: body.dayOfWeek, slotStart: body.slotStart, slotEnd: body.slotEnd,
        room: body.room,
      },
    });
    return { id };
  },

  async deleteTimetableSlot(id: string) {
    await prisma.timetableSlot.delete({ where: { id } });
  },

  timetableCsvTemplate() {
    return "batch,day,start,end,subject,room,mentor_code\nC2,Mon,09:00,10:00,TOC,L3,VKB\n";
  },

  // CSV columns: batch, day, start, end, subject, room?, mentor_code?
  // If opts.replaceExisting → wipe every existing slot in the CSV's batches (in this semester) first.
  async uploadTimetableCsv(scope: Scope, buffer: Buffer | undefined, opts: { semesterId?: string; replaceExisting?: boolean }) {
    if (!buffer) throw new ApiError(400, "VALIDATION_ERROR", "CSV file is required.");
    const rows = parseCsvRecords(buffer, ["batch", "day", "start", "end", "subject"]);
    const semId = opts.semesterId || (await scopeSemester(scope)).id;
    const [batches, subjects, faculty] = await Promise.all([
      prisma.batch.findMany({ where: { id: { in: scope.hodBatchIds } } }),
      subjectsBySemester(semId),
      prisma.faculty.findMany({ where: { universityId: scope.universityId, deletedAt: null }, select: { id: true, employeeId: true, mentorCode: true } }),
    ]);
    const batchByCode = new Map(batches.map((b) => [b.code.toUpperCase(), b]));
    const subjByCode = new Map(subjects.map((s) => [s.code.toUpperCase(), s]));
    const facByMentor = new Map(faculty.filter((f) => f.mentorCode).map((f) => [f.mentorCode!.toUpperCase(), f.id]));
    const DAYS: Record<string, number> = { MON: 1, MONDAY: 1, TUE: 2, TUESDAY: 2, WED: 3, WEDNESDAY: 3, THU: 4, THURSDAY: 4, FRI: 5, FRIDAY: 5, SAT: 6, SATURDAY: 6 };

    // If replacing, wipe existing slots in every batch touched by this CSV (respecting HOD scope).
    if (opts.replaceExisting) {
      const csvBatchIds = new Set<string>();
      for (const { record } of rows) {
        const b = batchByCode.get(String(record.batch ?? "").trim().toUpperCase());
        if (b) csvBatchIds.add(b.id);
      }
      if (csvBatchIds.size > 0) {
        await prisma.timetableSlot.deleteMany({ where: { semesterId: semId, batchId: { in: [...csvBatchIds] } } });
      }
    }

    let created = 0, skipped = 0;
    const errors: { row: number; enrollmentNo: string; reason: string }[] = [];
    for (const { row, record } of rows) {
      const ref = `${record.batch}/${record.day}/${record.start}`;
      try {
        const batch = batchByCode.get(String(record.batch ?? "").trim().toUpperCase());
        if (!batch) { errors.push({ row, enrollmentNo: ref, reason: `Batch "${record.batch}" not in your scope.` }); continue; }
        const subject = subjByCode.get(String(record.subject ?? "").trim().toUpperCase());
        if (!subject) { errors.push({ row, enrollmentNo: ref, reason: `Subject "${record.subject}" not found.` }); continue; }
        const dayRaw = String(record.day ?? "").trim().toUpperCase();
        const dayOfWeek = /^[1-6]$/.test(dayRaw) ? Number(dayRaw) : DAYS[dayRaw];
        if (!dayOfWeek) { errors.push({ row, enrollmentNo: ref, reason: `Invalid day "${record.day}" (use Mon–Sat or 1–6).` }); continue; }
        const start = String(record.start ?? "").trim();
        const end = String(record.end ?? "").trim();
        if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) { errors.push({ row, enrollmentNo: ref, reason: "start/end must be HH:MM." }); continue; }
        let facultyId: string | null = null;
        if (record.mentor_code) {
          facultyId = facByMentor.get(String(record.mentor_code).trim().toUpperCase()) ?? null;
          if (!facultyId) { errors.push({ row, enrollmentNo: ref, reason: `Mentor code "${record.mentor_code}" not found.` }); continue; }
        }

        // Append mode: skip duplicates (same batch/day/start/subject).
        if (!opts.replaceExisting) {
          const dup = await prisma.timetableSlot.findFirst({ where: { semesterId: semId, batchId: batch.id, dayOfWeek, slotStart: start, subjectId: subject.id } });
          if (dup) { skipped++; continue; }
        }
        await prisma.timetableSlot.create({
          data: { semesterId: semId, batchId: batch.id, subjectId: subject.id, facultyId, dayOfWeek, slotStart: start, slotEnd: end, room: record.room ? String(record.room).trim() : null },
        });
        // ponytail: auto-assign — a timetable slot IS the faculty↔subject↔batch assignment
        // that drives attendance/results. Upsert it (dedup) so we don't rely on a separate step.
        if (facultyId) {
          const existing = await prisma.facultyBatchAssignment.findFirst({ where: { facultyId, subjectId: subject.id, batchId: batch.id, semesterId: semId } });
          if (!existing) {
            await prisma.facultyBatchAssignment.create({ data: { facultyId, subjectId: subject.id, batchId: batch.id, semesterId: semId } });
          }
        }
        created++;
      } catch {
        errors.push({ row, enrollmentNo: ref, reason: "Failed to import row." });
      }
    }
    return { created, skipped, errors, totalRows: rows.length, replaced: !!opts.replaceExisting };
  },

  // ─── Attendance-only: batches under the faculty's HOD ──────
  // The faculty's HOD = whichever HOD(s) own the batches this faculty is assigned to teach
  // (derived from FacultyBatchAssignment → HodBatchScope). Return every batch those HODs own.
  // Fallback: if the faculty has no assignments yet, keep the year-level view so onboarding
  // isn't blocked. This scope applies ONLY to the Attendance module.
  async facultyHodBatches(universityId: string, facultyId: string) {
    const me = await facultyById(facultyId);
    const activeSem = await facultyActiveSemester(facultyId, universityId);
    // 1. Which batches is this faculty assigned to (any subject/semester)?
    const myAsg = await prisma.facultyBatchAssignment.findMany({
      where: { facultyId }, select: { batchId: true },
    });
    const myBatchIds = [...new Set(myAsg.map((a) => a.batchId))];
    // 2. Whoever HODs those batches → those are this faculty's HODs.
    const hodScopes = myBatchIds.length
      ? await prisma.hodBatchScope.findMany({ where: { batchId: { in: myBatchIds } }, select: { facultyId: true } })
      : [];
    const hodIds = [...new Set(hodScopes.map((s) => s.facultyId))];
    // 3. Every batch under those HODs (in the active academic year).
    let batches;
    if (hodIds.length > 0) {
      const allScopes = await prisma.hodBatchScope.findMany({
        where: { facultyId: { in: hodIds } },
        include: { batch: true },
      });
      const uniq = new Map<string, typeof allScopes[number]["batch"]>();
      for (const s of allScopes) {
        if (activeSem.academicYearId && s.batch.academicYearId !== activeSem.academicYearId) continue;
        uniq.set(s.batch.id, s.batch);
      }
      batches = [...uniq.values()].sort((a, b) => a.code.localeCompare(b.code));
    } else {
      // No assignments yet → fall back to year-level so the selector isn't empty pre-onboarding.
      batches = await prisma.batch.findMany({
        where: {
          universityId,
          academicYearId: activeSem.academicYearId || undefined,
          ...(me.year ? { yearLevel: me.year as any } : {}),
        },
        orderBy: { code: "asc" },
      });
    }
    return {
      activeSemester: { id: activeSem.id, label: activeSem.label },
      data: batches.map((b) => ({ id: b.id, code: b.code, yearLevel: b.yearLevel })),
    };
  },

  // ─── Faculty: daily attendance matrix ──────────────────────
  async facultyAttendanceDay(universityId: string, facultyId: string, batchId: string, dateStr: string) {
    if (!batchId || !dateStr) throw new ApiError(400, "VALIDATION_ERROR", "batchId and date are required.");
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) throw new ApiError(400, "VALIDATION_ERROR", "Invalid date.");
    // ponytail: use DB `Date` (day-only) — align to UTC midnight
    const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayOfWeek = day.getUTCDay(); // 0=Sun..6=Sat
    // ponytail: resolve the batch's OWN active semester (several year levels active at once).
    const batch = await batchById(batchId);
    const activeSem = (await prisma.semester.findFirst({ where: { academicYearId: batch.academicYearId, status: "ACTIVE" } })) ?? await getActiveSemester(universityId);

    const slots = await prisma.timetableSlot.findMany({
      where: { batchId, semesterId: activeSem.id, dayOfWeek },
      include: { subject: { select: { id: true, code: true, name: true } } },
      orderBy: { slotStart: "asc" },
    });

    const enrollments = await prisma.studentEnrollment.findMany({
      where: { batchId, semesterId: activeSem.id, isCurrent: true },
      include: { student: { select: { id: true, name: true, enrollmentNo: true } } },
      orderBy: { rollNo: "asc" },
    });

    // Existing marks for THIS batch on THIS date, keyed by slot so paired lectures stay separate.
    const enrollmentIds = enrollments.map((e) => e.id);
    const slotIds = slots.map((s) => s.id);
    const existing = slotIds.length && enrollmentIds.length
      ? await prisma.attendanceRecord.findMany({
        where: { enrollmentId: { in: enrollmentIds }, lectureDate: day, slotId: { in: slotIds } },
      })
      : [];
    // key: `${enrollmentId}:${slotId}` — frontend reads by slot
    const markMap: Record<string, boolean> = {};
    for (const r of existing) if (r.slotId) markMap[`${r.enrollmentId}:${r.slotId}`] = r.isPresent;

    // 7-day edit window (past only). Future dates blocked here too.
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysDelta = Math.round((today.getTime() - day.getTime()) / 86400000);
    // Calendar gate: attendance is only allowed on working days (overrides the edit window).
    const dayStatus = await resolveDayStatus(universityId, dateStr);
    const isEditable = dayStatus.isWorkingDay && daysDelta >= 0 && daysDelta <= 7;

    // Subject-swap suggestions: any subject in the same semester, in case of proxy
    const allSubjects = (await subjectsBySemester(activeSem.id)).map((s) => ({ id: s.id, code: s.code, name: s.name }));

    void facultyId;
    return {
      date: day.toISOString().slice(0, 10),
      dayOfWeek,
      isEditable,
      dayStatus,
      daysDelta,
      lectures: slots.map((s) => ({
        slotId: s.id,
        subjectId: s.subjectId,
        subjectCode: s.subject.code,
        subjectName: s.subject.name,
        slotStart: s.slotStart,
        slotEnd: s.slotEnd,
        room: s.room,
      })),
      students: enrollments.map((e) => ({
        enrollmentId: e.id,
        rollNo: e.rollNo,
        name: e.student.name,
        enrollmentNo: e.student.enrollmentNo,
      })),
      marks: markMap,
      subjects: allSubjects,
    };
  },

  async facultyAttendanceDaySave(universityId: string, facultyId: string, body: {
    batchId: string;
    date: string;
    lectures: { slotId?: string; subjectId: string; marks: Record<string, boolean> }[];
  }) {
    if (!body.batchId || !body.date || !Array.isArray(body.lectures)) throw new ApiError(400, "VALIDATION_ERROR", "batchId, date, lectures required.");
    const d = new Date(body.date);
    const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysDelta = Math.round((today.getTime() - day.getTime()) / 86400000);
    if (daysDelta < 0) throw new ApiError(400, "FUTURE_DATE", "Cannot mark future attendance.");
    if (daysDelta > 7) throw new ApiError(403, "EDIT_WINDOW_EXPIRED", "Attendance older than 7 days cannot be edited.");
    // Calendar gate: no attendance on holidays, reading holidays, semester breaks or Sundays.
    const dayStatus = await resolveDayStatus(universityId, body.date);
    if (!dayStatus.isWorkingDay) throw new ApiError(409, "NON_WORKING_DAY", `Attendance is disabled — ${dayStatus.reason ?? dayStatus.status}.`);

    // resolve the batch's own active semester (multiple year levels active at once)
    const batch = await batchById(body.batchId);
    const activeSem = (await prisma.semester.findFirst({ where: { academicYearId: batch.academicYearId, status: "ACTIVE" } })) ?? await getActiveSemester(universityId);
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { batchId: body.batchId, semesterId: activeSem.id, isCurrent: true },
      select: { id: true },
    });
    const enrIds = new Set(enrollments.map((e) => e.id));

    let inserted = 0, updated = 0;
    const affectedEnrIds = new Set<string>();
    for (const lec of body.lectures) {
      if (!lec.slotId) continue; // ponytail: require slotId so paired lectures don't collide
      for (const [enrollmentId, isPresent] of Object.entries(lec.marks)) {
        if (!enrIds.has(enrollmentId)) continue;
        affectedEnrIds.add(enrollmentId);
        const existing = await prisma.attendanceRecord.findFirst({
          where: { enrollmentId, lectureDate: day, slotId: lec.slotId },
        });
        if (existing) {
          if (existing.isLocked) continue;
          await prisma.attendanceRecord.update({
            where: { id: existing.id },
            data: { isPresent, facultyId, subjectId: lec.subjectId },
          });
          updated++;
        } else {
          await prisma.attendanceRecord.create({
            data: { enrollmentId, subjectId: lec.subjectId, slotId: lec.slotId, facultyId, lectureDate: day, isPresent },
          });
          inserted++;
        }
      }
    }

    // Fan-out: one "Today's attendance marked" notification per affected student
    if (affectedEnrIds.size > 0) {
      const affected = await prisma.studentEnrollment.findMany({
        where: { id: { in: [...affectedEnrIds] } },
        select: { studentId: true },
      });
      const faculty = await prisma.faculty.findUnique({ where: { id: facultyId }, select: { name: true } });
      const dateLabel = day.toISOString().slice(0, 10);
      await this.notifyMany(
        universityId,
        affected.map((e) => ({ studentId: e.studentId })),
        "FACULTY_ATTENDANCE_LOG",
        `Attendance marked (${dateLabel})`,
        `${faculty?.name ?? "Your faculty"} marked attendance for your batch on ${dateLabel}.`,
        "/student/attendance",
      );
    }
    return { inserted, updated };
  },
};
