import { Router } from "express";
import multer from "multer";

import { portalService } from "../services/portal.service.js";
import { asyncHandler } from "../utils/http.js";

const upload = multer({ storage: multer.memoryStorage() });

function str(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

// University (Dean) portal — mounted at /admin with requireAuth + requireSuperAdmin.
export const adminRouter = Router();

adminRouter.get("/overview", asyncHandler(async (req, res) => res.json(await portalService.uniOverview(req.user!.universityId))));

// Academic structure
adminRouter.get("/years", asyncHandler(async (req, res) => res.json(await portalService.uniYears(req.user!.universityId))));
adminRouter.post("/years", asyncHandler(async (req, res) => res.json(await portalService.uniCreateYear(req.user!.universityId, req.body))));
adminRouter.post("/years/:id/activate", asyncHandler(async (req, res) => res.json(await portalService.uniActivateYear(req.user!.universityId, str(req.params.id)))));
adminRouter.post("/semesters", asyncHandler(async (req, res) => res.json(await portalService.uniCreateSemester(req.user!.universityId, req.body))));
adminRouter.post("/semesters/:id/activate", asyncHandler(async (req, res) => res.json(await portalService.uniActivateSemester(req.user!.universityId, str(req.params.id)))));
adminRouter.post("/batches", asyncHandler(async (req, res) => res.json(await portalService.uniCreateBatch(req.user!.universityId, req.body))));
adminRouter.post("/batches/bulk", asyncHandler(async (req, res) => res.json(await portalService.uniBulkCreateBatches(req.user!.universityId, req.body))));

// HODs
adminRouter.get("/hods", asyncHandler(async (req, res) => res.json(await portalService.uniHods(req.user!.universityId))));
adminRouter.get("/promotion-dashboard", asyncHandler(async (req, res) => res.json(await portalService.promotionDashboard(req.user!.universityId))));
adminRouter.post("/hods/:facultyId/toggle", asyncHandler(async (req, res) => res.json(await portalService.uniSetHod(req.user!.universityId, str(req.params.facultyId), Boolean(req.body.isHod)))));
adminRouter.post("/hod-scope", asyncHandler(async (req, res) => res.json(await portalService.uniAssignHodScope(req.user!.universityId, String(req.body.facultyId), String(req.body.batchId)))));
adminRouter.delete("/hod-scope/:batchId", asyncHandler(async (req, res) => res.json(await portalService.uniRemoveHodScope(req.user!.universityId, str(req.params.batchId)))));

// Faculty
adminRouter.get("/faculty", asyncHandler(async (req, res) => res.json(await portalService.uniFaculty(req.user!.universityId, req.query.search as string | undefined, Number(req.query.page ?? 1), Number(req.query.limit ?? 20)))));
adminRouter.post("/faculty", asyncHandler(async (req, res) => res.json(await portalService.register(req.body, req.user!.universityId))));
adminRouter.patch("/faculty/:id/active", asyncHandler(async (req, res) => res.json(await portalService.uniSetFacultyActive(req.user!.universityId, str(req.params.id), Boolean(req.body.isActive)))));
adminRouter.put("/faculty/:id", asyncHandler(async (req, res) => res.json(await portalService.uniUpdateFaculty(req.user!.universityId, str(req.params.id), req.body))));
adminRouter.delete("/faculty/:id", asyncHandler(async (req, res) => res.json(await portalService.uniDeleteFaculty(req.user!.universityId, str(req.params.id)))));
adminRouter.post("/faculty/:id/promote-to-hod", asyncHandler(async (req, res) => res.json(await portalService.uniPromoteToHod(req.user!.universityId, str(req.params.id)))));
adminRouter.get("/faculty/csv/template", asyncHandler(async (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="faculty-template.csv"`);
  res.send(portalService.uniFacultyCsvTemplate());
}));
adminRouter.post("/faculty/csv", upload.single("file"), asyncHandler(async (req, res) => res.json(await portalService.uniUploadFacultyCsv(req.user!.universityId, req.file?.buffer))));

// Students
adminRouter.get("/students", asyncHandler(async (req, res) => res.json(await portalService.uniStudents(req.user!.universityId, { search: req.query.search as string | undefined, branch: req.query.branch as string | undefined, page: Number(req.query.page ?? 1), limit: Number(req.query.limit ?? 20) }))));
adminRouter.post("/students", asyncHandler(async (req, res) => res.json(await portalService.register({ ...req.body, role: "STUDENT" }, req.user!.universityId))));
adminRouter.patch("/students/:id/active", asyncHandler(async (req, res) => res.json(await portalService.uniSetStudentActive(req.user!.universityId, str(req.params.id), Boolean(req.body.isActive)))));
adminRouter.get("/students/:enrollmentNo/history", asyncHandler(async (req, res) => res.json(await portalService.getStudentHistory({ universityId: req.user!.universityId, userId: req.user!.id, role: req.user!.role, isHod: false, hodBatchIds: [] } as any, str(req.params.enrollmentNo)))));
adminRouter.get("/students/:enrollmentNo", asyncHandler(async (req, res) => res.json(await portalService.getStudent({ universityId: req.user!.universityId, userId: req.user!.id, role: req.user!.role, isHod: false, hodBatchIds: [] } as any, str(req.params.enrollmentNo)))));

// Subjects (Dean CRUD)
adminRouter.get("/subjects", asyncHandler(async (req, res) => res.json(await portalService.uniSubjectList(req.user!.universityId, { semesterNumber: req.query.semesterNumber ? Number(req.query.semesterNumber) : undefined, branch: req.query.branch as string | undefined }))));
adminRouter.post("/subjects", asyncHandler(async (req, res) => res.status(201).json(await portalService.createSubject({ ...req.body, universityId: req.user!.universityId }))));
adminRouter.put("/subjects/:id", asyncHandler(async (req, res) => res.json(await portalService.updateSubject(str(req.params.id), req.body))));
adminRouter.delete("/subjects/:id", asyncHandler(async (req, res) => { await portalService.deleteSubject(str(req.params.id)); res.status(204).send(); }));
adminRouter.get("/subjects/csv/template", asyncHandler(async (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="subjects-template.csv"`);
  res.send(portalService.uniSubjectsCsvTemplate());
}));
adminRouter.post("/subjects/csv", upload.single("file"), asyncHandler(async (req, res) => res.json(await portalService.uniUploadSubjectsCsv(req.user!.universityId, req.file?.buffer))));

// Branches — the universal list; student branches must come from here
adminRouter.get("/branches", asyncHandler(async (req, res) => res.json(await portalService.uniBranches(req.user!.universityId))));
adminRouter.post("/branches", asyncHandler(async (req, res) => res.status(201).json(await portalService.addUniversityBranch(req.user!.universityId, String(req.body.code).trim().toUpperCase(), String(req.body.name)))));
adminRouter.delete("/branches/:id", asyncHandler(async (req, res) => res.json(await portalService.uniDeleteBranch(req.user!.universityId, str(req.params.id)))));

// Settings
adminRouter.get("/settings", asyncHandler(async (req, res) => res.json(await portalService.uniSettings(req.user!.universityId))));
adminRouter.put("/settings", asyncHandler(async (req, res) => res.json(await portalService.uniUpdateSettings(req.user!.universityId, req.body))));
