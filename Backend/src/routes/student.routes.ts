import { Router } from "express";
import multer from "multer";

import { requireAuth, requireUserRole } from "../middleware/auth.js";
import { studentScope } from "../middleware/studentScope.js";
import { portalService } from "../services/portal.service.js";
import { asyncHandler } from "../utils/http.js";

const upload = multer({ storage: multer.memoryStorage() });

function str(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export const studentRouter = Router();

studentRouter.use(requireAuth);
studentRouter.use(requireUserRole("STUDENT"));
studentRouter.use(studentScope);

studentRouter.get("/dashboard", asyncHandler(async (req, res) => {
  res.json(await portalService.studentDashboard(req.user!.id, req.user!.universityId));
}));

studentRouter.get("/profile", asyncHandler(async (req, res) => {
  res.json(await portalService.studentProfile(req.user!.id, req.user!.universityId));
}));

studentRouter.patch("/profile", asyncHandler(async (req, res) => {
  res.json(await portalService.updateStudentProfile(req.user!.id, req.user!.universityId, req.body));
}));

studentRouter.post("/profile/photo", upload.single("file"), asyncHandler(async (req, res) => {
  res.json(await portalService.uploadProfilePhoto(req.user!.id, ""));
}));

studentRouter.patch("/profile/password", asyncHandler(async (req, res) => {
  res.json(
    await portalService.changeStudentPassword(
      req.user!.id,
      String(req.body.currentPassword),
      String(req.body.newPassword),
      String(req.body.confirmPassword),
    ),
  );
}));

studentRouter.get("/sessions", asyncHandler(async (req, res) => {
  res.json(await portalService.securitySessions(req.user!.id));
}));

studentRouter.delete("/sessions/:sessionId", asyncHandler(async (req, res) => {
  const sessions = (await portalService.securitySessions(req.user!.id)).data;
  const session = sessions.find((item) => item.id === str(req.params.sessionId));
  if (!session) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Session not found.", details: [] } });
    return;
  }
  await portalService.revokeSession(session.id);
  res.status(204).send();
}));

studentRouter.get("/enrollment/current", asyncHandler(async (req, res) => {
  res.json(await portalService.studentCurrentEnrollment(req.user!.id, req.user!.universityId));
}));

studentRouter.get("/enrollment/history", asyncHandler(async (req, res) => {
  res.json(await portalService.studentEnrollmentHistory(req.user!.id));
}));

studentRouter.get("/subjects", asyncHandler(async (req, res) => {
  res.json(await portalService.studentSubjects(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

studentRouter.get("/timetable/today", asyncHandler(async (req, res) => {
  res.json(await portalService.studentTodayTimetable(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

studentRouter.get("/timetable", asyncHandler(async (req, res) => {
  res.json(await portalService.studentTimetable(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

studentRouter.get("/results/summary", asyncHandler(async (req, res) => {
  res.json(await portalService.studentResultsSummary(req.user!.id));
}));

studentRouter.get("/results/semester/:semesterId", asyncHandler(async (req, res) => {
  res.json(await portalService.studentResultsSemester(req.user!.id, str(req.params.semesterId)));
}));

studentRouter.get("/results/phase-progress", asyncHandler(async (req, res) => {
  res.json(await portalService.studentPhaseProgress(req.user!.id, req.user!.universityId));
}));

studentRouter.get("/results", asyncHandler(async (req, res) => {
  res.json(await portalService.studentResults(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

studentRouter.get("/attendance/:subjectId/log", asyncHandler(async (req, res) => {
  res.json(
    await portalService.studentAttendanceLog(
      req.user!.id,
      req.user!.universityId,
      str(req.params.subjectId),
      req.query.semesterId as string | undefined,
    ),
  );
}));

studentRouter.get("/attendance/history", asyncHandler(async (req, res) => {
  res.json(await portalService.studentAttendanceHistory(req.user!.id));
}));

studentRouter.get("/attendance", asyncHandler(async (req, res) => {
  res.json(await portalService.studentAttendance(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

studentRouter.get("/notes/folders", asyncHandler(async (req, res) => {
  res.json(await portalService.studentNoteDrive(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

studentRouter.get("/notes/:noteId/download", asyncHandler(async (req, res) => {
  res.json(await portalService.studentNoteDownload(req.user!.id, req.user!.universityId, str(req.params.noteId)));
}));

studentRouter.get("/notes/:noteId/flashcards", asyncHandler(async (req, res) => {
  res.json(await portalService.studentNoteFlashcards(req.user!.id, req.user!.universityId, str(req.params.noteId)));
}));

studentRouter.get("/notes/:noteId", asyncHandler(async (req, res) => {
  res.json(await portalService.studentNote(req.user!.id, req.user!.universityId, str(req.params.noteId)));
}));

studentRouter.get("/notes", asyncHandler(async (req, res) => {
  res.json(await portalService.studentNotes(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

studentRouter.get("/self-notes/:selfNoteId", asyncHandler(async (req, res) => {
  res.json(await portalService.studentSelfNote(req.user!.id, str(req.params.selfNoteId)));
}));

studentRouter.get("/self-notes", asyncHandler(async (req, res) => {
  res.json(await portalService.studentSelfNotes(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

studentRouter.post("/self-notes", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.createStudentSelfNote(req.user!.id, req.user!.universityId, req.body));
}));

studentRouter.put("/self-notes/:selfNoteId", asyncHandler(async (req, res) => {
  res.json(await portalService.updateStudentSelfNote(req.user!.id, str(req.params.selfNoteId), req.body));
}));

studentRouter.delete("/self-notes/:selfNoteId", asyncHandler(async (req, res) => {
  await portalService.deleteStudentSelfNote(req.user!.id, str(req.params.selfNoteId));
  res.status(204).send();
}));

studentRouter.get("/quizzes/subjects/:subjectId/chapters", asyncHandler(async (req, res) => {
  res.json(await portalService.studentQuizChapters(req.user!.id, req.user!.universityId, str(req.params.subjectId)));
}));

studentRouter.post("/quizzes/ai-generate", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.createStudentAiQuiz(req.user!.id, req.user!.universityId, req.body));
}));

studentRouter.delete("/quizzes/:quizId/ai-practice", asyncHandler(async (req, res) => {
  await portalService.deleteStudentAiQuiz(req.user!.id, str(req.params.quizId));
  res.status(204).send();
}));

studentRouter.get("/quizzes/history", asyncHandler(async (req, res) => {
  res.json(await portalService.studentQuizHistory(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

studentRouter.get("/quizzes/:quizId/result", asyncHandler(async (req, res) => {
  res.json(await portalService.studentQuizResult(req.user!.id, str(req.params.quizId)));
}));

studentRouter.post("/quizzes/:quizId/start", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.startStudentQuiz(req.user!.id, req.user!.universityId, str(req.params.quizId)));
}));

studentRouter.post("/quizzes/:quizId/submit", asyncHandler(async (req, res) => {
  res.json(await portalService.submitStudentQuiz(req.user!.id, req.user!.universityId, str(req.params.quizId), req.body.answers ?? {}, req.body.presentation ?? {}));
}));

studentRouter.get("/quizzes/:quizId", asyncHandler(async (req, res) => {
  res.json(await portalService.studentQuiz(req.user!.id, req.user!.universityId, str(req.params.quizId)));
}));

studentRouter.get("/quizzes", asyncHandler(async (req, res) => {
  res.json(await portalService.studentQuizzes(req.user!.id, req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

studentRouter.get("/announcements/unread-count", asyncHandler(async (req, res) => {
  res.json(await portalService.studentAnnouncementUnreadCount(req.user!.id, req.user!.universityId));
}));

studentRouter.patch("/announcements/mark-all-read", asyncHandler(async (req, res) => {
  res.json(await portalService.markAllStudentAnnouncementsRead(req.user!.id, req.user!.universityId));
}));

studentRouter.patch("/announcements/:announcementId/read", asyncHandler(async (req, res) => {
  res.json(await portalService.markStudentAnnouncementRead(req.user!.id, req.user!.universityId, str(req.params.announcementId)));
}));

studentRouter.get("/announcements/:announcementId", asyncHandler(async (req, res) => {
  res.json(await portalService.studentAnnouncement(req.user!.id, req.user!.universityId, str(req.params.announcementId)));
}));

studentRouter.get("/announcements", asyncHandler(async (req, res) => {
  res.json(
    await portalService.studentAnnouncements(
      req.user!.id,
      req.user!.universityId,
      Number(req.query.page ?? 1),
      Number(req.query.limit ?? 20),
      String(req.query.unreadOnly ?? "false") === "true",
    ),
  );
}));

// Calendar day status — is today (or ?date=) a working day? The master-controller gate.
studentRouter.get("/calendar/today", asyncHandler(async (req, res) => {
  res.json(await portalService.calendarDayStatus(req.user!.universityId, req.query.date as string | undefined));
}));

studentRouter.get("/calendar/events/upcoming", asyncHandler(async (req, res) => {
  res.json(await portalService.upcomingEvents(req.user!.universityId, Number(req.query.limit ?? 5)));
}));

studentRouter.get("/calendar/events", asyncHandler(async (req, res) => {
  res.json(await portalService.calendarEvents(req.user!.universityId, req.query as Record<string, string | number | undefined>));
}));

studentRouter.get("/calendar/phase-timeline", asyncHandler(async (req, res) => {
  res.json({
    semesterLabel: req.currentEnrollment ? (await portalService.studentCurrentEnrollment(req.user!.id, req.user!.universityId)).semesterLabel : null,
    ...await portalService.phaseTimeline(
      {
        universityId: req.user!.universityId,
        hodBatchIds: req.batchId ? [req.batchId] : [],
        hodSemesterIds: req.semesterId ? [req.semesterId] : [],
        userId: req.user!.id,
      },
      req.query.semesterId as string | undefined,
    ),
  });
}));

studentRouter.get("/mentor/messages/unread-count", asyncHandler(async (req, res) => {
  res.json(await portalService.studentMentorUnreadCount(req.user!.id, req.user!.universityId));
}));

studentRouter.patch("/mentor/messages/mark-read", asyncHandler(async (req, res) => {
  res.json(await portalService.markStudentMentorMessagesRead(req.user!.id, req.user!.universityId));
}));

studentRouter.post("/mentor/messages", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.sendStudentMentorMessage(req.user!.id, req.user!.universityId, String(req.body.content)));
}));

studentRouter.get("/mentor/messages", asyncHandler(async (req, res) => {
  res.json(await portalService.studentMentorMessages(req.user!.id, req.user!.universityId, Number(req.query.page ?? 1), Number(req.query.limit ?? 30)));
}));

studentRouter.get("/mentor", asyncHandler(async (req, res) => {
  res.json(await portalService.studentMentor(req.user!.id, req.user!.universityId, req.query.semesterId as string | undefined));
}));

studentRouter.get("/ai/conversations/:conversationId", asyncHandler(async (req, res) => {
  res.json(await portalService.studentAiConversation(req.user!.id, str(req.params.conversationId)));
}));

studentRouter.post("/ai/conversations/:conversationId/message", asyncHandler(async (req, res) => {
  res.json(await portalService.sendStudentAiMessage(req.user!.id, str(req.params.conversationId), String(req.body.content)));
}));

studentRouter.delete("/ai/conversations/:conversationId", asyncHandler(async (req, res) => {
  await portalService.deleteStudentAiConversation(req.user!.id, str(req.params.conversationId));
  res.status(204).send();
}));

studentRouter.get("/ai/conversations", asyncHandler(async (req, res) => {
  res.json(await portalService.studentAiConversations(req.user!.id));
}));

studentRouter.post("/ai/conversations", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.createStudentAiConversation(req.user!.id, req.user!.universityId, req.body));
}));

studentRouter.get("/ai/pyq-analysis/:subjectId", asyncHandler(async (req, res) => {
  res.json(await portalService.studentPyqAnalysis(req.user!.id, req.user!.universityId, str(req.params.subjectId)));
}));

studentRouter.get("/ai/smart-notes/:noteId/summary", asyncHandler(async (req, res) => {
  res.json(await portalService.studentSmartNoteSummary(req.user!.id, req.user!.universityId, str(req.params.noteId)));
}));

studentRouter.get("/ai/marks-prediction", asyncHandler(async (req, res) => {
  res.json(await portalService.studentMarksPrediction(req.user!.id));
}));


studentRouter.get("/study-planner/ai-status/:jobId", asyncHandler(async (req, res) => {
  res.json(await portalService.studentStudyPlannerAiStatus(str(req.params.jobId)));
}));

studentRouter.post("/study-planner/ai-suggest", asyncHandler(async (req, res) => {
  res.status(202).json(await portalService.studentStudyPlannerAiSuggest(req.user!.id, req.user!.universityId, req.body));
}));

studentRouter.post("/study-planner/tasks", asyncHandler(async (req, res) => {
  res.status(201).json(await portalService.addStudentStudyPlannerTask(req.user!.id, req.user!.universityId, req.body));
}));

studentRouter.patch("/study-planner/tasks/:taskId", asyncHandler(async (req, res) => {
  res.json(
    await portalService.updateStudentStudyPlannerTask(
      req.user!.id,
      req.user!.universityId,
      str(req.params.taskId),
      Boolean(req.body.isCompleted),
    ),
  );
}));

studentRouter.delete("/study-planner/tasks/:taskId", asyncHandler(async (req, res) => {
  res.json(await portalService.deleteStudentStudyPlannerTask(req.user!.id, str(req.params.taskId)));
}));

studentRouter.put("/study-planner", asyncHandler(async (req, res) => {
  res.json(await portalService.saveStudentStudyPlanner(req.user!.id, req.user!.universityId, req.body.plan ?? []));
}));

studentRouter.get("/study-planner", asyncHandler(async (req, res) => {
  res.json(await portalService.studentStudyPlanner(req.user!.id, req.user!.universityId));
}));

studentRouter.get("/leaderboard/my-rank", asyncHandler(async (req, res) => {
  res.json(await portalService.studentLeaderboardMyRank(req.user!.id, req.user!.universityId, req.query.phaseId as string | undefined));
}));

studentRouter.get("/leaderboard/subject/:subjectId", asyncHandler(async (req, res) => {
  res.json(
    await portalService.studentSubjectLeaderboard(
      req.user!.id,
      req.user!.universityId,
      str(req.params.subjectId),
      req.query.phaseId as string | undefined,
    ),
  );
}));

studentRouter.get("/leaderboard", asyncHandler(async (req, res) => {
  res.json(
    await portalService.studentLeaderboard(
      req.user!.id,
      req.user!.universityId,
      req.query.phaseId as string | undefined,
      req.query.subjectId as string | undefined,
    ),
  );
}));

// ── Notifications ──
studentRouter.get("/notifications", asyncHandler(async (req, res) =>
  res.json(await portalService.notificationsList({ studentId: req.user!.id }, Number(req.query.page ?? 1), Number(req.query.limit ?? 20), req.query.unreadOnly === "true"))));
studentRouter.get("/notifications/unread-count", asyncHandler(async (req, res) =>
  res.json(await portalService.notificationsUnreadCount({ studentId: req.user!.id }))));
studentRouter.patch("/notifications/:id/read", asyncHandler(async (req, res) =>
  res.json(await portalService.markNotificationRead(str(req.params.id), { studentId: req.user!.id }))));
studentRouter.patch("/notifications/mark-all-read", asyncHandler(async (req, res) =>
  res.json(await portalService.markAllNotificationsRead({ studentId: req.user!.id }))));
