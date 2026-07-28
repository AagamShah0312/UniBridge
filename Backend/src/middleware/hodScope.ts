import type { NextFunction, Request, Response } from "express";

import prisma from "../config/prisma.js";
import { ApiError } from "../utils/http.js";

export async function hodScope(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.isHod) {
    return next(new ApiError(403, "FORBIDDEN", "HOD role required."));
  }

  const universityId = req.user.universityId;
  // ponytail: an HOD owns their batches for a whole 4-year batch (academic year), and only one
  // semester of that year is ACTIVE at a time. Resolve the HOD's CURRENT context by academic year,
  // not by a scope.semesterId that drifts after promotion. This keeps batches/students visible
  // even when a promotion has advanced the active semester past where the scope row points.
  const allScopes = await prisma.hodBatchScope.findMany({
    where: { facultyId: req.user.id },
    include: { batch: { select: { id: true, code: true, academicYearId: true } } },
  });

  let batchIds: string[] = [];
  let activeSemesterId: string | undefined = typeof req.query.semesterId === "string" ? req.query.semesterId : undefined;

  if (allScopes.length > 0) {
    const yearIds = [...new Set(allScopes.map((s) => s.batch.academicYearId))];
    // the academic year the HOD is currently working in = the one with an ACTIVE semester
    const activeSem = await prisma.semester.findFirst({
      where: { universityId, status: "ACTIVE", academicYearId: { in: yearIds } },
      orderBy: { number: "desc" },
      select: { id: true, academicYearId: true },
    });
    const targetYearId = activeSem?.academicYearId ?? yearIds[0];
    const yearScopes = allScopes.filter((s) => s.batch.academicYearId === targetYearId);
    batchIds = yearScopes.map((s) => s.batchId);
    if (!activeSemesterId) activeSemesterId = activeSem?.id;
    req.hodBatchCodes = yearScopes.map((s) => s.batch.code);
  } else {
    req.hodBatchCodes = [];
  }

  req.hodBatchIds = batchIds;
  req.hodSemesterIds = activeSemesterId ? [activeSemesterId] : [];

  next();
}
