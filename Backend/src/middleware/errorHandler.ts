import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { ApiError } from "../utils/http.js";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, "NOT_FOUND", "Route not found."));
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.issues.map((issue) => ({
          field: issue.path.join("."),
          issue: issue.message,
        })),
      },
    });
  }

  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? [],
      },
    });
  }

  // Never expose a raw Prisma FK exception to the UI. This most commonly
  // happens after a single-university database reseed when an old process or
  // session still carries the deleted university UUID.
  const databaseError = error as { code?: string; meta?: { field_name?: string } };
  if (databaseError?.code === "P2003") {
    const field = databaseError.meta?.field_name ?? "";
    const staleUniversity = field.includes("universityId") || field.includes("academic_years_universityId_fkey");
    return res.status(409).json({
      error: {
        code: staleUniversity ? "UNIVERSITY_CONTEXT_STALE" : "RELATION_CONSTRAINT",
        message: staleUniversity ? "Your session is connected to an old university record. Sign in again and retry." : "This record is still referenced by another record.",
        details: [],
      },
    });
  }

  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error(`[API] ${req.method} ${req.originalUrl} failed`, error);
  return res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message,
      details: [],
    },
  });
}
