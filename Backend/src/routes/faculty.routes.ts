import type { Request } from "express";
import { Router } from "express";
import multer from "multer";

import { requireAuth, requireFacultyPortal } from "../middleware/auth.js";
import { facultyScope } from "../middleware/facultyScope.js";
import { portalService } from "../services/portal.service.js";
import { parseFormat, sendExport } from "../utils/export.js";
import { asyncHandler } from "../utils/http.js";

const upload = multer({ storage: multer.memoryStorage() });

function str(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function facultyPhaseScope(req: Request) {
  return {
    universityId: req.user!.universityId,
    hodBatchIds: req.assignedBatchIds ?? [],
    hodSemesterIds: req.facultySemesterId ? [req.facultySemesterId] : [],
    userId: req.user!.id,
  };
}

export const facultyRouter = Router();

facultyRouter.use(requireAuth);
facultyRouter.use(requireFacultyPortal);
facultyRouter.use(facultyScope);

facultyRouter.get("/dashboard/summary", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyDashboardSummary(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

facultyRouter.get("/profile", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyProfile(req.user!.id));
}));

facultyRouter.put("/profile", asyncHandler(async (req, res) => {
  res.json(await portalService.updateFacultyProfile(req.user!.id, req.body));
}));

facultyRouter.post("/profile/photo", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(await portalService.uploadProfilePhoto(req.user!.id, ""));
}));

facultyRouter.patch("/profile/password", asyncHandler(async (req, res) => {
  res.json(
    await portalService.changeFacultyPassword(
      req.user!.id,
      String(req.body.currentPassword),
      String(req.body.newPassword),
      String(req.body.confirmPassword),
    ),
  );
}));

facultyRouter.get("/sessions", asyncHandler(async (req, res) => {
  res.json(await portalService.facultySessions(req.user!.id));
}));

facultyRouter.delete("/sessions/:sessionId", asyncHandler(async (req, res) => {
  await portalService.revokeFacultySession(req.user!.id, str(req.params.sessionId));
  res.status(204).send();
}));

facultyRouter.get("/activity-feed", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyActivityFeed(req.user!.id, Number(req.query.page ?? 1), Number(req.query.limit ?? 10)));
}));

facultyRouter.get("/my-scope", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyMyScope(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

facultyRouter.get("/timetable/today", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyTodayTimetable(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

facultyRouter.get("/timetable", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyTimetable(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

// Literal export paths MUST be declared before "/students/:enrollmentNo", or Express
// matches "export" as the enrollmentNo and returns STUDENT_NOT_FOUND.
facultyRouter.get("/students/export", asyncHandler(async (req, res) =>
  sendExport(res, "my-students", parseFormat(req.query.format),
    await portalService.facultyStudentsExport(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>))));

facultyRouter.get("/results/export", asyncHandler(async (req, res) =>
  sendExport(res, "results", parseFormat(req.query.format),
    await portalService.facultyResultsExport(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>))));

facultyRouter.get("/students/:enrollmentNo/history", asyncHandler(async (req, res) => {
  res.json(await portalService.getStudentHistory({ universityId: req.user!.universityId, userId: req.user!.id, role: req.user!.role, isHod: false, hodBatchIds: [] } as any, str(req.params.enrollmentNo)));
}));

facultyRouter.get("/students/:enrollmentNo/attendance", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyStudentAttendance(
      req.user!.id,
      req.user!.universityId,
      str(req.params.enrollmentNo),
      req.query.semesterId as string | undefined,
    ),
  );
}));

facultyRouter.get("/students/:enrollmentNo/results", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyStudentResults(
      req.user!.id,
      req.user!.universityId,
      str(req.params.enrollmentNo),
      req.query.semesterId as string | undefined,
    ),
  );
}));

facultyRouter.get("/students/:enrollmentNo", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyStudentProfile(
      req.user!.id,
      req.user!.universityId,
      str(req.params.enrollmentNo),
      req.query.semesterId as string | undefined,
    ),
  );
}));

facultyRouter.get("/students", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyStudents(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

facultyRouter.get("/attendance/pending", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyAttendancePending(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

// Batches visible to faculty for daily attendance (all batches in tenant/dept).
facultyRouter.get("/hod-batches", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyHodBatches(req.user!.universityId, req.user!.id));
}));

// Daily attendance MATRIX (students x lectures) for a batch on a date.
facultyRouter.get("/attendance/day", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyAttendanceDay(req.user!.universityId, req.user!.id, str(req.query.batchId), str(req.query.date)));
}));
facultyRouter.post("/attendance/day", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyAttendanceDaySave(req.user!.universityId, req.user!.id, req.body));
}));

facultyRouter.get("/attendance/session", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyAttendanceSession(
      req.user!.id,
      req.user!.universityId,
      String(req.query.subjectId),
      String(req.query.batchId),
      String(req.query.date),
    ),
  );
}));

facultyRouter.post("/attendance", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.facultyAttendance(req.body, req.user!.id, req.user!.universityId));
}));

facultyRouter.patch("/attendance", asyncHandler(async (req, res) => {
  res.json(await portalService.updateFacultyAttendance(req.body, req.user!.id, req.user!.universityId));
}));

facultyRouter.delete("/attendance", asyncHandler(async (req, res) => {
  res.json(
    await portalService.deleteFacultyAttendance(
      req.user!.id,
      req.user!.universityId,
      String(req.query.subjectId),
      String(req.query.batchId),
      String(req.query.date),
    ),
  );
}));

facultyRouter.get("/attendance/summary", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyAttendanceSummary(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

facultyRouter.get("/attendance/lecture-log", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyAttendanceLectureLog(
      req.user!.id,
      req.user!.universityId,
      String(req.query.subjectId),
      String(req.query.batchId),
      req.query.semesterId as string | undefined,
    ),
  );
}));

facultyRouter.get("/attendance/students-below-threshold", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyAttendanceBelowThreshold(
      req.user!.id,
      req.user!.universityId,
      req.query.semesterId as string | undefined,
      req.query.subjectId as string | undefined,
    ),
  );
}));

// ── Attendance coordinator: status + report PDFs ──
facultyRouter.get("/attendance/coordinator/status", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyAttendanceCoordinatorStatus(req.user!.id, req.user!.universityId));
}));
facultyRouter.get("/attendance/coordinator/daily-pdf", asyncHandler(async (req, res) => {
  const pdf = await portalService.dailyAttendancePdf(req.user!.id, req.user!.universityId, String(req.query.date ?? ""));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="daily-attendance-${String(req.query.date ?? "")}.pdf"`);
  res.status(200).send(pdf);
}));
facultyRouter.get("/attendance/coordinator/weekly-pdf", asyncHandler(async (req, res) => {
  const pdf = await portalService.weeklyAttendancePdf(req.user!.id, req.user!.universityId, String(req.query.upto ?? ""));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="weekly-attendance-${String(req.query.upto ?? "")}.pdf"`);
  res.status(200).send(pdf);
}));

facultyRouter.get("/notes/:noteId/ai-status", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyNoteAiStatus(req.user!.id, str(req.params.noteId)));
}));

facultyRouter.post("/notes/:noteId/flashcards", asyncHandler(async (req, res) => {
  res.status(201).json(
    await portalService.addFacultyFlashcard(
      req.user!.id,
      str(req.params.noteId),
      String(req.body.question),
      String(req.body.answer),
    ),
  );
}));

facultyRouter.delete("/notes/:noteId/flashcards/:flashcardId", asyncHandler(async (req, res) => {
  await portalService.deleteFacultyFlashcard(req.user!.id, str(req.params.noteId), str(req.params.flashcardId));
  res.status(204).send();
}));

facultyRouter.get("/notes/folders", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyNoteDrive(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

facultyRouter.get("/notes/:noteId", asyncHandler(async (req, res) => {
  res.json(await portalService.getFacultyNote(req.user!.id, str(req.params.noteId)));
}));

facultyRouter.get("/notes", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyNotes(req.user!.id, req.query as Record<string, string | number | undefined>));
}));

facultyRouter.post("/notes/folders", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.createFacultyNoteFolder(req.user!.id, req.user!.universityId, req.body));
}));

facultyRouter.patch("/notes/folders/:folderId", asyncHandler(async (req, res) => {
  res.json(await portalService.renameFacultyNoteFolder(req.user!.id, req.user!.universityId, str(req.params.folderId), String(req.body.name ?? "")));
}));

facultyRouter.delete("/notes/folders/:folderId", asyncHandler(async (req, res) => {
  await portalService.deleteFacultyNoteFolder(req.user!.id, req.user!.universityId, str(req.params.folderId));
  res.status(204).send();
}));

// Browser posts the file (multipart); backend uploads bytes to Supabase S3 and stores metadata.
facultyRouter.post("/notes", upload.single("file"), asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.createFacultyNote(
    req.user!.id, req.user!.universityId, req.file?.buffer,
    { originalname: req.file?.originalname, mimetype: req.file?.mimetype, size: req.file?.size },
    req.body,
  ));
}));

// Optional file replace via multipart; JSON body (no file) also accepted for title/desc/reschedule.
facultyRouter.put("/notes/:noteId", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(await portalService.updateFacultyNote(
    req.user!.id, str(req.params.noteId), req.file?.buffer,
    { originalname: req.file?.originalname, mimetype: req.file?.mimetype, size: req.file?.size },
    req.body,
  ));
}));

facultyRouter.delete("/notes/:noteId", asyncHandler(async (req, res) => {
  await portalService.deleteFacultyNote(req.user!.id, str(req.params.noteId));
  res.status(204).send();
}));

// PYQ paper upload (multipart): backend stores the file and hands it to the AI service for topic analysis.
facultyRouter.post("/pyq", upload.single("file"), asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.facultyUploadPyq(
    req.user!.id, req.user!.universityId, req.file?.buffer,
    { originalname: req.file?.originalname, mimetype: req.file?.mimetype, size: req.file?.size },
    req.body,
  ));
}));

facultyRouter.post("/quizzes/ai-generate", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.createAiQuizJob(req.user!.id, req.user!.universityId, req.body));
}));

facultyRouter.get("/quizzes/ai-status/:jobId", asyncHandler(async (req, res) => {
  res.json(await portalService.getAiQuizStatus(str(req.params.jobId)));
}));

facultyRouter.get("/quizzes/:quizId/attempts/:attemptId", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyQuizAttemptDetail(req.user!.id, str(req.params.quizId), str(req.params.attemptId)));
}));

facultyRouter.get("/quizzes/:quizId/attempts", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyQuizAttempts(req.user!.id, str(req.params.quizId), req.query as Record<string, string | number | undefined>));
}));

facultyRouter.patch("/quizzes/:quizId/publish", asyncHandler(async (req, res) => {
  res.json(await portalService.publishFacultyQuiz(req.user!.id, str(req.params.quizId)));
}));

facultyRouter.patch("/quizzes/:quizId/unpublish", asyncHandler(async (req, res) => {
  res.json(await portalService.unpublishFacultyQuiz(req.user!.id, str(req.params.quizId)));
}));

facultyRouter.put("/quizzes/:quizId/questions", asyncHandler(async (req, res) => {
  res.json(await portalService.replaceFacultyQuizQuestions(req.user!.id, str(req.params.quizId), req.body.questions));
}));

facultyRouter.get("/quizzes/:quizId", asyncHandler(async (req, res) => {
  res.json(await portalService.getFacultyQuiz(req.user!.id, str(req.params.quizId)));
}));

facultyRouter.get("/quizzes", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyQuizzes(req.user!.id, req.query as Record<string, string | number | undefined>));
}));

facultyRouter.post("/quizzes", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.createFacultyQuiz(req.user!.id, req.user!.universityId, req.body));
}));

facultyRouter.put("/quizzes/:quizId", asyncHandler(async (req, res) => {
  res.json(await portalService.updateFacultyQuiz(req.user!.id, str(req.params.quizId), req.body));
}));

facultyRouter.delete("/quizzes/:quizId", asyncHandler(async (req, res) => {
  await portalService.deleteFacultyQuiz(req.user!.id, str(req.params.quizId));
  res.status(204).send();
}));

facultyRouter.get("/announcements", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyAnnouncements(req.user!.id, req.user!.universityId, Number(req.query.page ?? 1), Number(req.query.limit ?? 20)));
}));

facultyRouter.post("/announcements", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.createFacultyAnnouncement(req.user!.id, req.user!.universityId, req.body));
}));

facultyRouter.put("/announcements/:announcementId", asyncHandler(async (req, res) => {
  res.json(await portalService.updateFacultyAnnouncement(req.user!.id, str(req.params.announcementId), req.body));
}));

facultyRouter.delete("/announcements/:announcementId", asyncHandler(async (req, res) => {
  await portalService.deleteFacultyAnnouncement(req.user!.id, str(req.params.announcementId));
  res.status(204).send();
}));

facultyRouter.get("/mentees/unread-counts", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyMenteeUnreadCounts(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

facultyRouter.get("/mentees/at-risk", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyMenteesAtRisk(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

facultyRouter.get("/mentees/:enrollmentNo/profile", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyMenteeProfile(
      req.user!.id,
      req.user!.universityId,
      str(req.params.enrollmentNo),
      req.query.semesterId as string | undefined,
    ),
  );
}));

facultyRouter.get("/mentees", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyMentees(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

facultyRouter.get("/chat/:mentorAssignmentId/messages", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyChatMessages(
      req.user!.id,
      req.user!.universityId,
      str(req.params.mentorAssignmentId),
      Number(req.query.page ?? 1),
      Number(req.query.limit ?? 30),
    ),
  );
}));

facultyRouter.post("/chat/:mentorAssignmentId/messages", asyncHandler(async (req, res) => {
  res.status(201).json(
    await portalService.facultySendChatMessage(
      req.user!.id,
      req.user!.universityId,
      str(req.params.mentorAssignmentId),
      String(req.body.content),
    ),
  );
}));

facultyRouter.patch("/chat/:mentorAssignmentId/mark-read", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyMarkChatRead(req.user!.id, req.user!.universityId, str(req.params.mentorAssignmentId)));
}));

// ── Exam paper checking (coordinator + checker) ──
facultyRouter.get("/exam/status", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyExamStatus(req.user!.id, req.user!.universityId));
}));

facultyRouter.get("/exam/context", asyncHandler(async (req, res) => {
  res.json(await portalService.examContext(req.user!.universityId, req.user!.id));
}));

facultyRouter.get("/exam/assignments", asyncHandler(async (req, res) => {
  // ?all=1 → coordinator sees every assignment; otherwise only your own paper sets
  const all = req.query.all === "1";
  if (all) {
    const status = await portalService.facultyExamStatus(req.user!.id, req.user!.universityId);
    if (!status.isCoordinator) return res.status(403).json({ code: "NOT_EXAM_COORDINATOR", message: "Only an exam coordinator can view all assignments." });
  }
  res.json(await portalService.examAssignments(req.user!.universityId, {
    phaseId: req.query.phaseId as string | undefined,
    facultyId: all ? undefined : req.user!.id,
  }));
}));

facultyRouter.post("/exam/assignments", asyncHandler(async (req, res) => {
  res.json(await portalService.createExamAssignment(req.user!.id, req.user!.universityId, req.body));
}));

facultyRouter.delete("/exam/assignments/:id", asyncHandler(async (req, res) => {
  res.json(await portalService.deleteExamAssignment(req.user!.id, req.user!.universityId, str(req.params.id)));
}));

facultyRouter.get("/exam/assignments/:id/students", asyncHandler(async (req, res) => {
  res.json(await portalService.examAssignmentStudents(req.user!.id, req.user!.universityId, str(req.params.id)));
}));

facultyRouter.post("/exam/assignments/:id/marks", asyncHandler(async (req, res) => {
  res.json(await portalService.saveExamAssignmentMarks(req.user!.id, req.user!.universityId, str(req.params.id), req.body.marks ?? []));
}));

facultyRouter.get("/results/summary", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyResultsSummary(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

facultyRouter.get("/results/leaderboard", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyResultsLeaderboard(
      req.user!.id,
      req.user!.universityId,
      String(req.query.subjectId),
      String(req.query.phaseId),
      req.query.batchId as string | undefined,
      Number(req.query.limit ?? 10),
    ),
  );
}));

facultyRouter.get("/results", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyResults(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

facultyRouter.get("/calendar/today", asyncHandler(async (req, res) => {
  res.json(await portalService.calendarDayStatus(req.user!.universityId, req.query.date as string | undefined));
}));

facultyRouter.get("/calendar/events/upcoming", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyUpcomingEvents(String(req.user!.universityId), Number(req.query.limit ?? 6)));
}));

facultyRouter.get("/calendar/events", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyCalendarEvents(req.user!.universityId, Number(req.query.year), Number(req.query.month)));
}));

facultyRouter.get("/calendar/phase-timeline", asyncHandler(async (req, res) => {
  res.json(await portalService.phaseTimeline(facultyPhaseScope(req), req.query.semesterId as string | undefined));
}));

facultyRouter.get("/analytics/attendance", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyAnalyticsAttendance(
      req.user!.id,
      req.user!.universityId,
      req.query.semesterId as string | undefined,
      req.query.subjectId as string | undefined,
      req.query.batchId as string | undefined,
    ),
  );
}));

facultyRouter.get("/analytics/marks", asyncHandler(async (req, res) => {
  res.json(
    await portalService.facultyAnalyticsMarks(
      req.user!.id,
      req.user!.universityId,
      req.query.semesterId as string | undefined,
      req.query.subjectId as string | undefined,
      req.query.phaseId as string | undefined,
    ),
  );
}));

facultyRouter.get("/analytics/mentees", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyAnalyticsMentees(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

facultyRouter.get("/analytics/quiz-performance", asyncHandler(async (req, res) => {
  res.json(await portalService.facultyQuizPerformance(req.user!.id, String(req.query.quizId)));
}));

// ── Notifications ──
facultyRouter.get("/notifications", asyncHandler(async (req, res) =>
  res.json(await portalService.notificationsList({ facultyId: req.user!.id }, Number(req.query.page ?? 1), Number(req.query.limit ?? 20), req.query.unreadOnly === "true"))));
facultyRouter.get("/notifications/unread-count", asyncHandler(async (req, res) =>
  res.json(await portalService.notificationsUnreadCount({ facultyId: req.user!.id }))));
facultyRouter.patch("/notifications/:id/read", asyncHandler(async (req, res) =>
  res.json(await portalService.markNotificationRead(str(req.params.id), { facultyId: req.user!.id }))));
facultyRouter.patch("/notifications/mark-all-read", asyncHandler(async (req, res) =>
  res.json(await portalService.markAllNotificationsRead({ facultyId: req.user!.id }))));
