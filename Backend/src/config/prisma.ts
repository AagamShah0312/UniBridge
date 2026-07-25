import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

const base = new PrismaClient({
  adapter,
  log: ["error", "warn"],
});

// ─────────────────────────────────────────────────────────────
// Soft-delete read guard.
//
// Academic records are never physically deleted — a correction sets `deletedAt` so the original
// survives for audit and for transcript requests years later. This extension hides retracted rows
// from every live read in ONE place, instead of relying on ~50 call sites each remembering to add
// `deletedAt: null` (one miss = wrong attendance %, wrong grade).
//
// ponytail: applies to reads only. Writes (updateMany setting deletedAt) and any query that
// explicitly mentions deletedAt are passed through untouched, so the archive/audit paths can
// still ask for retracted rows on purpose.
// ─────────────────────────────────────────────────────────────
const SOFT_DELETE_MODELS = new Set(["Result", "AttendanceRecord", "StudentEnrollment", "Batch"]);
const READ_OPS = new Set(["findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (
          model &&
          SOFT_DELETE_MODELS.has(model) &&
          READ_OPS.has(operation) &&
          // Caller asked about deletedAt explicitly → respect their intent (audit/archive reads).
          !(args as { where?: Record<string, unknown> })?.where?.deletedAt
        ) {
          const a = args as { where?: Record<string, unknown> };
          a.where = { ...(a.where ?? {}), deletedAt: null };
        }
        return query(args);
      },
    },
  },
}) as unknown as PrismaClient;

export default prisma;
