import type { Request, Response } from "express";
import { Router } from "express";
import multer from "multer";

import { portalService } from "../services/portal.service.js";
import { parseFormat, sendExport } from "../utils/export.js";
import { asyncHandler } from "../utils/http.js";

const upload = multer({ storage: multer.memoryStorage() });

function scopeFrom(req: Request) {
  return {
    universityId: req.user!.universityId,
    hodBatchIds: req.hodBatchIds ?? [],
    hodSemesterIds: req.hodSemesterIds ?? [],
    userId: req.user!.id,
  };
}

function sendCsv(res: Response, filename: string, body: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(body);
}


function str(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export const hodRouter = Router();

hodRouter.get("/my-scope", asyncHandler(async (req, res) => res.json(await portalService.myScope(scopeFrom(req)))));
hodRouter.post("/onboarding/complete", asyncHandler(async (req, res) => res.json(await portalService.hodOnboardingComplete(scopeFrom(req), req.body))));
hodRouter.get("/onboarding/branches", asyncHandler(async (req, res) => res.json(await portalService.uniBranches(req.user!.universityId))));
hodRouter.get("/onboarding/faculty", asyncHandler(async (req, res) => res.json(await portalService.hodOnboardingFaculty(scopeFrom(req)))));
hodRouter.post("/faculty/pool", asyncHandler(async (req, res) => res.json(await portalService.hodSaveFacultyPool(scopeFrom(req), req.body))));
hodRouter.get("/faculty/pool", asyncHandler(async (req, res) => res.json(await portalService.hodFacultyPool(scopeFrom(req)))));
hodRouter.get("/batches/history", asyncHandler(async (req, res) => res.json(await portalService.hodBatchHistory(scopeFrom(req)))));
hodRouter.get("/history/semesters", asyncHandler(async (req, res) => res.json(await portalService.hodHistorySemesters(scopeFrom(req)))));
hodRouter.post("/reset-semester", asyncHandler(async (req, res) => res.json(await portalService.hodResetSemester(scopeFrom(req)))));
hodRouter.post("/graduate", asyncHandler(async (req, res) => res.json(await portalService.graduateFinalYear(scopeFrom(req), req.body ?? {}))));

hodRouter.get("/dashboard/summary", asyncHandler(async (req, res) => res.json(await portalService.dashboardSummary(scopeFrom(req)))));
hodRouter.get("/dashboard/attendance-trend", asyncHandler(async (req, res) => res.json(await portalService.dashboardAttendanceTrend(scopeFrom(req), Number(req.query.months ?? 6)))));
hodRouter.get("/dashboard/results-overview", asyncHandler(async (req, res) => res.json(await portalService.dashboardResultsOverview(scopeFrom(req), req.query.semesterId as string | undefined))));
hodRouter.get("/dashboard/at-risk", asyncHandler(async (req, res) => res.json(await portalService.dashboardAtRisk(scopeFrom(req)))));
hodRouter.get("/dashboard/activity-feed", asyncHandler(async (req, res) => res.json(await portalService.dashboardActivityFeed(scopeFrom(req), Number(req.query.page ?? 1), Number(req.query.limit ?? 10)))));

// ponytail: literal paths MUST come before /:param routes or Express matches
// e.g. `/students/export` against `/students/:enrollmentNo` first.
hodRouter.get("/students", asyncHandler(async (req, res) => res.json(await portalService.listStudents(scopeFrom(req), req.query as Record<string, string | number | undefined>))));
hodRouter.post("/students", asyncHandler(async (req, res) => res.status(201).json(await portalService.createStudent(req.body))));
hodRouter.get("/students/csv/template", asyncHandler(async (_req, res) => sendCsv(res, "students-template.csv", await portalService.studentCsvTemplate())));
hodRouter.get("/students/export", asyncHandler(async (req, res) => sendExport(res, "students", parseFormat(req.query.format), await portalService.studentExport(scopeFrom(req), req.query as Record<string, string | number | undefined>))));
hodRouter.post("/students/csv", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(
    await portalService.studentCsvUpload(scopeFrom(req), req.file?.buffer, {
      semesterId: str(req.body.semesterId),
    }),
  );
}));
hodRouter.get("/students/:enrollmentNo/history", asyncHandler(async (req, res) => res.json(await portalService.getStudentHistory(scopeFrom(req), str(req.params.enrollmentNo)))));
hodRouter.get("/students/:enrollmentNo", asyncHandler(async (req, res) => res.json(await portalService.getStudent(scopeFrom(req), str(req.params.enrollmentNo)))));
hodRouter.put("/students/:enrollmentNo", asyncHandler(async (req, res) => res.json(await portalService.updateStudent(scopeFrom(req), str(req.params.enrollmentNo), req.body))));
hodRouter.patch("/students/:enrollmentNo/status", asyncHandler(async (req, res) => res.json(await portalService.updateStudentStatus(str(req.params.enrollmentNo), Boolean(req.body.isActive)))));
hodRouter.delete("/students/:enrollmentNo", asyncHandler(async (req, res) => {
  await portalService.deleteStudent(str(req.params.enrollmentNo));
  res.status(204).send();
}));

hodRouter.get("/faculty", asyncHandler(async (req, res) => res.json(await portalService.listFaculty(scopeFrom(req), req.query as Record<string, string | number | undefined>))));
hodRouter.post("/faculty", asyncHandler(async (req, res) => res.status(201).json(await portalService.createFaculty(req.body))));
hodRouter.get("/faculty/export", asyncHandler(async (req, res) => sendExport(res, "faculty", parseFormat(req.query.format), await portalService.facultyExport(scopeFrom(req)))));
hodRouter.post("/faculty/csv", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(await portalService.facultyCsvUpload(req.file?.buffer, req.user!.universityId));
}));
hodRouter.post("/faculty/assignments", asyncHandler(async (req, res) => res.status(201).json(await portalService.createFacultyAssignment(req.body))));
hodRouter.delete("/faculty/assignments/:assignmentId", asyncHandler(async (req, res) => {
  await portalService.deleteFacultyAssignment(str(req.params.assignmentId));
  res.status(204).send();
}));
hodRouter.get("/faculty/:employeeId", asyncHandler(async (req, res) => res.json(await portalService.getFaculty(scopeFrom(req), str(req.params.employeeId)))));
hodRouter.put("/faculty/:employeeId", asyncHandler(async (req, res) => res.json(await portalService.updateFaculty(str(req.params.employeeId), req.body))));
hodRouter.patch("/faculty/:employeeId/mentor-code", asyncHandler(async (req, res) => res.json(await portalService.updateMentorCode(str(req.params.employeeId), req.body.mentorCode))));
hodRouter.patch("/faculty/:employeeId/status", asyncHandler(async (req, res) => res.json(await portalService.updateFacultyStatus(str(req.params.employeeId), Boolean(req.body.isActive)))));
hodRouter.delete("/faculty/:employeeId", asyncHandler(async (req, res) => {
  await portalService.deleteFaculty(str(req.params.employeeId));
  res.status(204).send();
}));

// ── Exam coordination (overwatcher view + coordinator appointment) ──
hodRouter.get("/exam/coordinators", asyncHandler(async (req, res) => res.json(await portalService.examCoordinators(scopeFrom(req)))));
hodRouter.post("/exam/coordinators", asyncHandler(async (req, res) => res.json(await portalService.assignExamCoordinator(scopeFrom(req), Number(req.body.slot), String(req.body.facultyId)))));
hodRouter.delete("/exam/coordinators/:slot", asyncHandler(async (req, res) => res.json(await portalService.removeExamCoordinator(scopeFrom(req), Number(req.params.slot)))));
hodRouter.get("/exam/context", asyncHandler(async (req, res) => res.json(await portalService.examContext(req.user!.universityId))));
hodRouter.get("/exam/assignments", asyncHandler(async (req, res) => res.json(await portalService.examAssignments(req.user!.universityId, { phaseId: req.query.phaseId as string | undefined }))));
hodRouter.post("/exam/publish", asyncHandler(async (req, res) => res.json(await portalService.examPublish(req.user!.universityId, String(req.body.phaseId)))));

hodRouter.get("/results/upload-context", asyncHandler(async (req, res) => res.json(await portalService.resultsUploadContext(scopeFrom(req), req.query.semesterId as string | undefined))));
hodRouter.get("/results/students", asyncHandler(async (req, res) => res.json(await portalService.resultsStudents(scopeFrom(req), String(req.query.semesterId), String(req.query.batchId), String(req.query.subjectId)))));
hodRouter.post("/results/upload", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(await portalService.resultsUpload(req.file?.buffer, req.body));
}));
hodRouter.post("/results/manual", asyncHandler(async (req, res) => res.json(await portalService.resultsManual(req.body))));
hodRouter.get("/results/preview", asyncHandler(async (req, res) => res.json(await portalService.resultsPreview(String(req.query.phaseId), String(req.query.subjectId), String(req.query.batchId)))));
hodRouter.post("/results/publish", asyncHandler(async (req, res) => res.json(await portalService.resultsPublish(String(req.body.phaseId), String(req.body.subjectId), String(req.body.batchId)))));
hodRouter.get("/results/upload-history", asyncHandler(async (req, res) => res.json(await portalService.resultsUploadHistory(scopeFrom(req), Number(req.query.page ?? 1), Number(req.query.limit ?? 10)))));
hodRouter.get("/results/phase-status", asyncHandler(async (req, res) => res.json(await portalService.resultsPhaseStatus(scopeFrom(req), req.query.semesterId as string | undefined))));
hodRouter.patch("/results/:resultId", asyncHandler(async (req, res) => res.json(await portalService.updateResult(str(req.params.resultId), Number(req.body.marksObtained), String(req.body.grade)))));
hodRouter.delete("/results/:resultId", asyncHandler(async (req, res) => {
  await portalService.deleteResult(str(req.params.resultId));
  res.status(204).send();
}));

hodRouter.get("/attendance/summary", asyncHandler(async (req, res) => res.json(await portalService.attendanceSummary(scopeFrom(req), req.query.semesterId as string | undefined))));
hodRouter.get("/attendance/heatmap", asyncHandler(async (req, res) => res.json(await portalService.attendanceHeatmap(scopeFrom(req), String(req.query.batchId), String(req.query.semesterId)))));
hodRouter.get("/attendance/table", asyncHandler(async (req, res) => res.json(await portalService.attendanceTable(scopeFrom(req), String(req.query.batchId), String(req.query.semesterId), req.query.search as string | undefined, Number(req.query.page ?? 1), Number(req.query.limit ?? 20)))));
hodRouter.get("/attendance/by-subject", asyncHandler(async (req, res) => res.json(await portalService.attendanceBySubject(scopeFrom(req), String(req.query.batchId), String(req.query.semesterId)))));
hodRouter.patch("/attendance/lock", asyncHandler(async (req, res) => res.json(await portalService.lockAttendance(String(req.body.subjectId), String(req.body.batchId), String(req.body.semesterId)))));
hodRouter.patch("/attendance/unlock", asyncHandler(async (req, res) => res.json(await portalService.unlockAttendance(String(req.body.enrollmentId), String(req.body.subjectId)))));
hodRouter.patch("/attendance/lock-all", asyncHandler(async (req, res) => res.json(await portalService.lockAllAttendance(String(req.body.batchId), String(req.body.semesterId)))));
hodRouter.get("/attendance/export", asyncHandler(async (req, res) => sendExport(res, "attendance", parseFormat(req.query.format), await portalService.attendanceExport(scopeFrom(req), String(req.query.batchId), String(req.query.semesterId)))));

hodRouter.get("/subjects", asyncHandler(async (req, res) => res.json(await portalService.listSubjects(scopeFrom(req), req.query.semesterId as string | undefined, req.query.search as string | undefined, req.query.type as string | undefined))));
hodRouter.get("/subjects/:subjectId/config", asyncHandler(async (req, res) => res.json(await portalService.getSubjectConfig(str(req.params.subjectId)))));
hodRouter.put("/subjects/:subjectId/config", asyncHandler(async (req, res) => res.json(await portalService.saveSubjectConfig(str(req.params.subjectId), req.body))));
hodRouter.get("/subjects/:subjectId", asyncHandler(async (req, res) => res.json(await portalService.getSubject(str(req.params.subjectId)))));
hodRouter.post("/subjects", asyncHandler(async (req, res) => res.status(201).json(await portalService.createSubject({ ...req.body, universityId: req.user!.universityId }))));
hodRouter.put("/subjects/:subjectId", asyncHandler(async (req, res) => res.json(await portalService.updateSubject(str(req.params.subjectId), req.body))));
hodRouter.delete("/subjects/:subjectId", asyncHandler(async (req, res) => {
  await portalService.deleteSubject(str(req.params.subjectId));
  res.status(204).send();
}));

hodRouter.get("/mentorship/summary", asyncHandler(async (req, res) => res.json(await portalService.mentorshipSummary(scopeFrom(req), req.query.semesterId as string | undefined))));
hodRouter.get("/mentorship/mentors", asyncHandler(async (req, res) => res.json(await portalService.mentorshipMentors(scopeFrom(req), req.query.semesterId as string | undefined))));
hodRouter.get("/mentorship/assignments", asyncHandler(async (req, res) => res.json(await portalService.mentorshipAssignments(scopeFrom(req), req.query as Record<string, string | number | undefined>))));
hodRouter.get("/mentorship/unassigned", asyncHandler(async (req, res) => res.json(await portalService.mentorshipUnassigned(scopeFrom(req), req.query.semesterId as string | undefined))));
hodRouter.post("/mentorship/assign", asyncHandler(async (req, res) => res.status(201).json(await portalService.assignMentor(String(req.body.studentEnrollmentNo), String(req.body.facultyId), String(req.body.semesterId)))));
hodRouter.post("/mentorship/assign/csv", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(await portalService.assignMentorCsv(req.file?.buffer, str(req.body.semesterId)));
}));
hodRouter.patch("/mentorship/reassign", asyncHandler(async (req, res) => res.json(await portalService.reassignMentor(String(req.body.studentEnrollmentNo), String(req.body.newFacultyId), String(req.body.semesterId)))));
hodRouter.post("/mentorship/auto-assign", asyncHandler(async (req, res) => res.json(await portalService.autoAssignMentors(scopeFrom(req), String(req.body.semesterId)))));
hodRouter.delete("/mentorship/assignments/:assignmentId", asyncHandler(async (req, res) => {
  await portalService.deleteMentorAssignment(str(req.params.assignmentId));
  res.status(204).send();
}));

hodRouter.get("/analytics/kpi", asyncHandler(async (req, res) => res.json(await portalService.analyticsKpi(scopeFrom(req), req.query.batchId as string | undefined))));
hodRouter.get("/analytics/attendance/trend", asyncHandler(async (req, res) => res.json(await portalService.analyticsAttendanceTrend(scopeFrom(req), Number(req.query.months ?? 6)))));
hodRouter.get("/analytics/attendance/by-subject", asyncHandler(async (req, res) => res.json(await portalService.analyticsAttendanceBySubject(scopeFrom(req), req.query.semesterId as string | undefined, req.query.batchId as string | undefined))));
hodRouter.get("/analytics/attendance/distribution", asyncHandler(async (req, res) => res.json(await portalService.analyticsAttendanceDistribution(scopeFrom(req), req.query.batchId as string | undefined))));
hodRouter.get("/analytics/marks/by-phase", asyncHandler(async (req, res) => res.json(await portalService.analyticsMarksByPhase(scopeFrom(req)))));
hodRouter.get("/analytics/marks/by-subject", asyncHandler(async (req, res) => res.json(await portalService.analyticsMarksBySubject(scopeFrom(req), String(req.query.phaseId), req.query.batchId as string | undefined))));
hodRouter.get("/analytics/marks/grade-distribution", asyncHandler(async (req, res) => res.json(await portalService.analyticsGradeDistribution(scopeFrom(req), String(req.query.phaseId), req.query.batchId as string | undefined))));
hodRouter.get("/analytics/leaderboard", asyncHandler(async (req, res) => res.json(await portalService.analyticsLeaderboard(scopeFrom(req), String(req.query.phaseId), req.query.batchId as string | undefined, Number(req.query.limit ?? 10)))));
hodRouter.get("/analytics/performance-radar", asyncHandler(async (req, res) => res.json(await portalService.analyticsPerformanceRadar(scopeFrom(req), String(req.query.phaseId)))));
hodRouter.get("/analytics/at-risk", asyncHandler(async (req, res) => res.json(await portalService.analyticsAtRisk(scopeFrom(req), req.query as Record<string, string | number | undefined>))));
hodRouter.post("/analytics/at-risk/notify-mentor", asyncHandler(async (req, res) => res.json(await portalService.notifyAtRiskMentor(String(req.body.enrollmentNo)))));
hodRouter.get("/analytics/year-comparison", asyncHandler(async (req, res) => res.json(await portalService.analyticsYearComparison(req.user!.universityId))));
hodRouter.get("/analytics/export", asyncHandler(async (req, res) => sendExport(res, "analytics-at-risk", parseFormat(req.query.format), await portalService.analyticsExport(scopeFrom(req), req.query as Record<string, string | number | undefined>))));

// Promotion v2 — result-based
hodRouter.get("/promotion/context", asyncHandler(async (req, res) => res.json(await portalService.promotionContext(scopeFrom(req)))));
hodRouter.get("/promotion/leaderboard", asyncHandler(async (req, res) => res.json(await portalService.promotionLeaderboard(scopeFrom(req), req.query.branch as string | undefined))));
hodRouter.post("/promotion/year-preview", asyncHandler(async (req, res) => res.json(await portalService.promotionYearPreview(scopeFrom(req), req.body))));
hodRouter.post("/promotion/execute-semester", asyncHandler(async (req, res) => res.json(await portalService.promotionExecuteSemester(scopeFrom(req), req.body ?? {}))));
hodRouter.post("/promotion/execute-year", asyncHandler(async (req, res) => res.json(await portalService.promotionExecuteYear(scopeFrom(req), req.body))));

hodRouter.get("/promotion/years", asyncHandler(async (req, res) => res.json(await portalService.promotionYears(req.user!.universityId))));
hodRouter.get("/promotion/preview", asyncHandler(async (req, res) => res.json(await portalService.promotionPreview(String(req.query.fromAcademicYearId), String(req.query.toAcademicYearId)))));
hodRouter.post("/promotion/mapping/csv", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(await portalService.promotionMappingCsv(req.file?.buffer, str(req.body.toAcademicYearId)));
}));
hodRouter.put("/promotion/mapping", asyncHandler(async (req, res) => res.json(await portalService.savePromotionMapping(req.user!.id, String(req.body.fromAcademicYearId), String(req.body.toAcademicYearId), req.body.mappings))));
hodRouter.get("/promotion/roll-numbers/suggest", asyncHandler(async (req, res) => res.json(await portalService.suggestRollNumbers(String(req.query.draftId)))));
hodRouter.post("/promotion/roll-numbers/csv", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(await portalService.promotionRollCsv(req.file?.buffer, str(req.body.draftId)));
}));
hodRouter.get("/promotion/preview-summary", asyncHandler(async (req, res) => res.json(await portalService.promotionPreviewSummary(String(req.query.draftId)))));
hodRouter.post("/promotion/execute", asyncHandler(async (req, res) => res.json(await portalService.executePromotion(String(req.body.draftId), req.body.mappings))));
hodRouter.get("/promotion/history", asyncHandler(async (req, res) => res.json(await portalService.promotionHistory(Number(req.query.page ?? 1), Number(req.query.limit ?? 10)))));

hodRouter.get("/calendar/events", asyncHandler(async (req, res) => res.json(await portalService.calendarEvents(req.user!.universityId, req.query as Record<string, string | number | undefined>))));
hodRouter.get("/calendar/events/upcoming", asyncHandler(async (req, res) => res.json(await portalService.upcomingEvents(req.user!.universityId, Number(req.query.limit ?? 6)))));
hodRouter.get("/calendar/events/:eventId", asyncHandler(async (req, res) => res.json(await portalService.getEvent(str(req.params.eventId)))));
hodRouter.post("/calendar/events", asyncHandler(async (req, res) => res.status(201).json(await portalService.createEvent(req.user!.universityId, req.user!.id, req.body))));
hodRouter.put("/calendar/events/:eventId", asyncHandler(async (req, res) => res.json(await portalService.updateEvent(str(req.params.eventId), req.body))));
hodRouter.delete("/calendar/events/:eventId", asyncHandler(async (req, res) => {
  await portalService.deleteEvent(str(req.params.eventId));
  res.status(204).send();
}));
hodRouter.get("/calendar/phase-timeline", asyncHandler(async (req, res) => res.json(await portalService.phaseTimeline(scopeFrom(req), req.query.semesterId as string | undefined))));
hodRouter.get("/calendar/export", asyncHandler(async (req, res) => sendExport(res, "calendar", parseFormat(req.query.format), await portalService.calendarExport(req.user!.universityId, req.query as Record<string, string | number | undefined>))));

hodRouter.get("/settings/profile", asyncHandler(async (req, res) => res.json(await portalService.settingsProfile(req.user!.id))));
hodRouter.put("/settings/profile", asyncHandler(async (req, res) => res.json(await portalService.updateSettingsProfile(req.user!.id, req.body))));
hodRouter.post("/settings/profile/photo", upload.single("file"), asyncHandler(async (req, res) => res.json(await portalService.uploadProfilePhoto(req.user!.id, ""))));
hodRouter.get("/settings/university", asyncHandler(async (req, res) => res.json(await portalService.universitySettings(req.user!.universityId))));
hodRouter.put("/settings/university", asyncHandler(async (req, res) => res.json(await portalService.updateUniversity(req.user!.universityId, req.body))));
hodRouter.post("/settings/university/branches", asyncHandler(async (req, res) => res.status(201).json(await portalService.addUniversityBranch(req.user!.universityId, String(req.body.code), String(req.body.name)))));
hodRouter.get("/settings/academic-years", asyncHandler(async (req, res) => res.json(await portalService.academicYears(req.user!.universityId))));
hodRouter.post("/settings/academic-years", asyncHandler(async (req, res) => res.status(201).json(await portalService.createAcademicYear(req.user!.universityId, req.body))));
hodRouter.patch("/settings/academic-years/:yearId/activate", asyncHandler(async (req, res) => res.json(await portalService.activateAcademicYear(str(req.params.yearId), req.user!.universityId))));
hodRouter.post("/settings/academic-years/:yearId/semesters", asyncHandler(async (req, res) => res.status(201).json(await portalService.createSemester(str(req.params.yearId), req.user!.universityId, req.body))));
hodRouter.get("/settings/notifications", asyncHandler(async (req, res) => res.json(await portalService.notifications(req.user!.id))));
hodRouter.put("/settings/notifications", asyncHandler(async (req, res) => res.json(await portalService.updateNotifications(req.user!.id, req.user!.universityId, req.body.preferences))));
hodRouter.patch("/settings/security/password", asyncHandler(async (req, res) => res.json(await portalService.changePassword(req.user!.id, String(req.body.currentPassword), String(req.body.newPassword)))));
hodRouter.get("/settings/security/sessions", asyncHandler(async (req, res) => res.json(await portalService.securitySessions(req.user!.id))));
hodRouter.delete("/settings/security/sessions/:sessionId", asyncHandler(async (req, res) => {
  await portalService.revokeSession(str(req.params.sessionId));
  res.status(204).send();
}));
hodRouter.get("/settings/attendance-rules", asyncHandler(async (req, res) => res.json(await portalService.attendanceRules(req.user!.universityId))));
hodRouter.put("/settings/attendance-rules", asyncHandler(async (req, res) => res.json(await portalService.updateAttendanceRules(req.user!.universityId, req.body))));
hodRouter.post("/settings/danger/reset-mentor-assignments", asyncHandler(async (req, res) => res.json(await portalService.resetMentorAssignments(String(req.body.semesterId), Boolean(req.body.confirm)))));
hodRouter.delete("/settings/danger/attendance-records", asyncHandler(async (req, res) => res.json(await portalService.deleteAttendanceRecords(req.user!.universityId, String(req.body.semesterId), Boolean(req.body.confirm)))));
hodRouter.post("/settings/danger/archive-year", asyncHandler(async (req, res) => res.status(202).json(await portalService.archiveYear(req.user!.universityId, String(req.body.academicYearId), req.user!.id))));
hodRouter.get("/settings/danger/archive-status/:jobId", asyncHandler(async (req, res) => res.json(await portalService.archiveStatus(str(req.params.jobId)))));

// ── Timetable CRUD (HOD) ────────────────────────────────
hodRouter.get("/timetable", asyncHandler(async (req, res) => res.json(await portalService.listTimetable(scopeFrom(req), req.query.batchId as string | undefined, req.query.semesterId as string | undefined))));
hodRouter.get("/timetable/csv/template", asyncHandler(async (_req, res) => sendCsv(res, "timetable-template.csv", portalService.timetableCsvTemplate())));
hodRouter.post("/timetable/csv", upload.single("file"), asyncHandler(async (req, res) => res.json(await portalService.uploadTimetableCsv(scopeFrom(req), req.file?.buffer, { semesterId: str(req.body.semesterId) || undefined, replaceExisting: req.body.replaceExisting === "1" || req.body.replaceExisting === "true" }))));
hodRouter.post("/timetable", asyncHandler(async (req, res) => res.status(201).json(await portalService.createTimetableSlot(scopeFrom(req), req.body))));
hodRouter.put("/timetable/:slotId", asyncHandler(async (req, res) => res.json(await portalService.updateTimetableSlot(str(req.params.slotId), req.body))));
hodRouter.delete("/timetable/:slotId", asyncHandler(async (req, res) => {
  await portalService.deleteTimetableSlot(str(req.params.slotId));
  res.status(204).send();
}));

// ── Announcements (HOD can post to ALL, YEAR_LEVEL, or BATCH) ──
hodRouter.get("/announcements", asyncHandler(async (req, res) =>
  res.json(await portalService.hodAnnouncements(req.user!.universityId, Number(req.query.page ?? 1), Number(req.query.limit ?? 30)))));
hodRouter.post("/announcements", asyncHandler(async (req, res) =>
  res.status(201).json(await portalService.createHodAnnouncement(req.user!.id, req.user!.universityId, req.body))));
hodRouter.put("/announcements/:id", asyncHandler(async (req, res) =>
  res.json(await portalService.updateFacultyAnnouncement(req.user!.id, str(req.params.id), req.body))));
hodRouter.delete("/announcements/:id", asyncHandler(async (req, res) => {
  await portalService.deleteFacultyAnnouncement(req.user!.id, str(req.params.id));
  res.status(204).send();
}));

// ── Notifications ──
hodRouter.get("/notifications", asyncHandler(async (req, res) =>
  res.json(await portalService.notificationsList({ facultyId: req.user!.id }, Number(req.query.page ?? 1), Number(req.query.limit ?? 20), req.query.unreadOnly === "true"))));
hodRouter.get("/notifications/unread-count", asyncHandler(async (req, res) =>
  res.json(await portalService.notificationsUnreadCount({ facultyId: req.user!.id }))));
hodRouter.patch("/notifications/:id/read", asyncHandler(async (req, res) =>
  res.json(await portalService.markNotificationRead(str(req.params.id), { facultyId: req.user!.id }))));
hodRouter.patch("/notifications/mark-all-read", asyncHandler(async (req, res) =>
  res.json(await portalService.markAllNotificationsRead({ facultyId: req.user!.id }))));
