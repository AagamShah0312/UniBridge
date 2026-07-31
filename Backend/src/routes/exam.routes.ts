import type { Request } from "express";
import { Router } from "express";

import { requireAuth } from "../middleware/auth.js";
import { examService } from "../services/exam.service.js";
import { asyncHandler } from "../utils/http.js";

// Exam management is available to year HODs AND exam coordinators, so this router
// only requires auth (no requireFacultyPortal, which would block HODs). The
// service authorizes each action via assertManager / getExamOrThrow.
export const examRouter = Router();
examRouter.use(requireAuth);

const uid = (req: Request) => req.user!.id;
const uni = (req: Request) => req.user!.universityId;
const s = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""));

// ── Faculty (any authenticated faculty): my published duties ──
examRouter.get("/me/duties", asyncHandler(async (req, res) => res.json(await examService.facultyDuties(uid(req), uni(req)))));

// ── Exam CRUD ──
examRouter.post("/", asyncHandler(async (req, res) => res.status(201).json(await examService.createExam(uid(req), uni(req), req.body))));
examRouter.get("/", asyncHandler(async (req, res) => res.json(await examService.listExams(uid(req), uni(req)))));
examRouter.get("/meta/subjects", asyncHandler(async (req, res) => res.json(await examService.yearSubjects(uid(req), uni(req)))));
examRouter.get("/:examId", asyncHandler(async (req, res) => res.json(await examService.getExam(uid(req), uni(req), s(req.params.examId)))));
examRouter.delete("/:examId", asyncHandler(async (req, res) => res.json(await examService.deleteExam(uid(req), uni(req), s(req.params.examId)))));
examRouter.get("/:examId/dashboard", asyncHandler(async (req, res) => res.json(await examService.dashboard(uid(req), uni(req), s(req.params.examId)))));
examRouter.get("/:examId/conflicts", asyncHandler(async (req, res) => res.json(await examService.detectConflicts(uid(req), uni(req), s(req.params.examId)))));
examRouter.post("/:examId/publish", asyncHandler(async (req, res) => res.json(await examService.publishExam(uid(req), uni(req), s(req.params.examId)))));
examRouter.post("/:examId/unpublish", asyncHandler(async (req, res) => res.json(await examService.unpublishExam(uid(req), uni(req), s(req.params.examId)))));

// ── Calendar / schedules ──
examRouter.post("/:examId/schedules", asyncHandler(async (req, res) => res.status(201).json(await examService.addSchedule(uid(req), uni(req), s(req.params.examId), req.body))));
examRouter.patch("/schedules/:scheduleId", asyncHandler(async (req, res) => res.json(await examService.updateSchedule(uid(req), uni(req), s(req.params.scheduleId), req.body))));
examRouter.delete("/schedules/:scheduleId", asyncHandler(async (req, res) => res.json(await examService.deleteSchedule(uid(req), uni(req), s(req.params.scheduleId)))));

// ── Blocks ──
examRouter.post("/:examId/blocks/generate", asyncHandler(async (req, res) => res.json(await examService.generateBlocks(uid(req), uni(req), s(req.params.examId)))));
examRouter.get("/:examId/blocks", asyncHandler(async (req, res) => res.json(await examService.listBlocks(uid(req), uni(req), s(req.params.examId)))));
examRouter.patch("/blocks/:blockId/room", asyncHandler(async (req, res) => res.json(await examService.setBlockRoom(uid(req), uni(req), s(req.params.blockId), s(req.body.room)))));
examRouter.patch("/blocks/:blockId/lock", asyncHandler(async (req, res) => res.json(await examService.lockBlock(uid(req), uni(req), s(req.params.blockId), Boolean(req.body.isLocked)))));
examRouter.post("/blocks/move", asyncHandler(async (req, res) => res.json(await examService.moveStudent(uid(req), uni(req), req.body))));
examRouter.post("/blocks/swap", asyncHandler(async (req, res) => res.json(await examService.swapBlocks(uid(req), uni(req), req.body))));

// ── External faculty ──
examRouter.post("/:examId/external", asyncHandler(async (req, res) => res.status(201).json(await examService.addExternal(uid(req), uni(req), s(req.params.examId), req.body))));
examRouter.get("/:examId/external", asyncHandler(async (req, res) => res.json(await examService.listExternal(uid(req), uni(req), s(req.params.examId)))));
examRouter.delete("/external/:externalId", asyncHandler(async (req, res) => res.json(await examService.removeExternal(uid(req), uni(req), s(req.params.externalId)))));

// ── Availability + allocations (per schedule) ──
examRouter.get("/schedules/:scheduleId/availability", asyncHandler(async (req, res) => res.json(await examService.availability(uid(req), uni(req), s(req.params.scheduleId)))));
examRouter.post("/schedules/:scheduleId/supervision/generate", asyncHandler(async (req, res) => res.json(await examService.generateSupervision(uid(req), uni(req), s(req.params.scheduleId)))));
examRouter.get("/schedules/:scheduleId/supervision", asyncHandler(async (req, res) => res.json(await examService.listSupervision(uid(req), uni(req), s(req.params.scheduleId)))));
examRouter.patch("/supervision/:allocationId", asyncHandler(async (req, res) => res.json(await examService.editSupervision(uid(req), uni(req), s(req.params.allocationId), req.body))));
examRouter.post("/schedules/:scheduleId/paper-checking/generate", asyncHandler(async (req, res) => res.json(await examService.generatePaperChecking(uid(req), uni(req), s(req.params.scheduleId)))));
examRouter.get("/schedules/:scheduleId/paper-checking", asyncHandler(async (req, res) => res.json(await examService.listPaperChecking(uid(req), uni(req), s(req.params.scheduleId)))));
examRouter.post("/schedules/:scheduleId/standby/generate", asyncHandler(async (req, res) => res.json(await examService.generateStandby(uid(req), uni(req), s(req.params.scheduleId)))));
examRouter.get("/schedules/:scheduleId/standby", asyncHandler(async (req, res) => res.json(await examService.listStandby(uid(req), uni(req), s(req.params.scheduleId)))));
examRouter.patch("/schedules/:scheduleId/standby", asyncHandler(async (req, res) => res.json(await examService.setStandby(uid(req), uni(req), s(req.params.scheduleId), Number(req.body.slot), s(req.body.facultyId)))));
