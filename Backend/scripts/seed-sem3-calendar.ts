// Load the REAL SEM-III 2025-26 academic calendar (L. J. Institute) into the active Semester 3:
//   1. Re-date phases T1–T4 to the actual CCE/SEE windows (they're otherwise evenly split).
//   2. Create CalendarEvents for every non-teaching day — breaks, public holidays,
//      reading holidays, test days and the IPE/Project Evaluation window.
//
// Grading per the calendar: T1/T2/T3 = CCE, 25 marks each (CO1–CO3, 75% weightage);
// T4 = SEE, 41 marks + 9 MCQ (CO4, 25% weightage).
//
// Idempotent: calendar events for this semester are cleared and rebuilt on each run.
import prisma from "../src/config/prisma.js";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// ── Phases (T1–T4): window = teaching block, examDate = first paper of that test ──
const PHASES = [
  { number: 1, label: "T1", start: "2025-09-15", end: "2025-10-13", exam: "2025-10-06" },
  { number: 2, label: "T2", start: "2025-10-27", end: "2025-11-21", exam: "2025-11-15" },
  { number: 3, label: "T3", start: "2025-11-24", end: "2025-12-19", exam: "2025-12-13" },
  { number: 4, label: "T4", start: "2025-12-22", end: "2026-02-07", exam: "2026-01-12" },
];

type Ev = { title: string; start: string; end?: string; type: "PUBLIC_HOLIDAY" | "HOLIDAY" | "SEMESTER_BREAK" | "READING_HOLIDAY" | "EXAM" | "ACTIVITY" };

const EVENTS: Ev[] = [
  // ── Breaks & holidays ──
  { title: "Eid-e-Meeladunnabi", start: "2025-09-05", type: "PUBLIC_HOLIDAY" },
  { title: "Navaratri Break", start: "2025-10-02", end: "2025-10-04", type: "SEMESTER_BREAK" },
  { title: "Diwali Break", start: "2025-10-14", end: "2025-10-26", type: "SEMESTER_BREAK" },
  { title: "Holiday", start: "2025-11-22", type: "HOLIDAY" },
  { title: "Holiday", start: "2025-12-20", type: "HOLIDAY" },
  { title: "Christmas", start: "2025-12-25", type: "PUBLIC_HOLIDAY" },
  { title: "Makar Sankranti", start: "2026-01-14", type: "PUBLIC_HOLIDAY" },
  { title: "Holiday", start: "2026-01-15", type: "HOLIDAY" },
  { title: "Holiday", start: "2026-01-22", type: "HOLIDAY" },
  { title: "Republic Day", start: "2026-01-26", type: "PUBLIC_HOLIDAY" },

  // ── Reading holidays (the day before / between papers) ──
  ...["2025-10-07", "2025-10-09", "2025-10-11", "2025-11-14", "2025-11-18", "2025-11-20",
      "2025-12-12", "2025-12-16", "2025-12-18", "2026-01-13", "2026-01-16", "2026-01-20"]
    .map((s): Ev => ({ title: "Reading Holiday", start: s, type: "READING_HOLIDAY" })),

  // ── T1 (CCE) ──
  { title: "Test-1 (CCE): PS", start: "2025-10-06", type: "EXAM" },
  { title: "Test-1 (CCE): FSD-1", start: "2025-10-08", type: "EXAM" },
  { title: "Test-1 (CCE): PYTHON-I", start: "2025-10-10", type: "EXAM" },
  { title: "Test-1 (CCE): DE", start: "2025-10-13", type: "EXAM" },
  { title: "Test-1 (CCE): ETC", start: "2026-01-27", type: "EXAM" },
  // ── T2 (CCE) ──
  { title: "Test-2 (CCE): PS", start: "2025-11-15", type: "EXAM" },
  { title: "Test-2 (CCE): FSD-1", start: "2025-11-17", type: "EXAM" },
  { title: "Test-2 (CCE): PYTHON-1", start: "2025-11-19", type: "EXAM" },
  { title: "Test-2 (CCE): DE", start: "2025-11-21", type: "EXAM" },
  { title: "Test-2 (CCE): ETC", start: "2026-01-30", type: "EXAM" },
  // ── T3 (CCE) ──
  { title: "Test-3 (CCE): PS", start: "2025-12-13", type: "EXAM" },
  { title: "Test-3 (CCE): FSD-1", start: "2025-12-15", type: "EXAM" },
  { title: "Test-3 (CCE): PYTHON-1", start: "2025-12-17", type: "EXAM" },
  { title: "Test-3 (CCE): DE", start: "2025-12-19", type: "EXAM" },
  { title: "Test-3 (CCE): ETC", start: "2026-02-03", type: "EXAM" },
  // ── T4 (SEE) ──
  { title: "Test-4 (SEE): PS", start: "2026-01-12", type: "EXAM" },
  { title: "Test-4 (SEE): FSD-1", start: "2026-01-17", type: "EXAM" },
  { title: "Test-4 (SEE): PYTHON-1", start: "2026-01-19", type: "EXAM" },
  { title: "Test-4 (SEE): DE", start: "2026-01-21", type: "EXAM" },
  { title: "Test-4 (SEE): ETC", start: "2026-02-06", type: "EXAM" },
  { title: "Test-4 (SEE): CI", start: "2026-02-07", type: "EXAM" },

  // ── Post-exam project window ──
  { title: "IPE / Project Evaluation", start: "2026-02-09", end: "2026-02-21", type: "ACTIVITY" },
];

async function main() {
  const sem = await prisma.semester.findFirst({ where: { number: 3, status: "ACTIVE" }, select: { id: true, universityId: true, label: true } });
  if (!sem) throw new Error("No ACTIVE Semester 3.");
  // Any HOD of this university can own the events (CalendarEvent.createdById is required).
  const owner = await prisma.faculty.findFirst({ where: { universityId: sem.universityId, isHod: true, deletedAt: null }, select: { id: true, name: true } });
  if (!owner) throw new Error("No HOD found to own the calendar events.");

  // ── 1. Real phase windows ──
  for (const p of PHASES) {
    await prisma.phase.updateMany({
      where: { semesterId: sem.id, number: p.number },
      data: { label: p.label, startDate: d(p.start), endDate: d(p.end), examDate: d(p.exam) },
    });
  }
  console.log(`✓ ${PHASES.length} phases re-dated (T1 ${PHASES[0].start} → T4 ${PHASES[3].end})`);

  // ── 2. Calendar events ──
  await prisma.calendarEvent.deleteMany({ where: { semesterId: sem.id } });
  const rows = EVENTS.map((e) => ({
    universityId: sem.universityId, semesterId: sem.id,
    title: e.title, startDate: d(e.start), endDate: d(e.end ?? e.start),
    eventType: e.type as any, visibleTo: "ALL" as any, createdById: owner.id,
  }));
  const { count } = await prisma.calendarEvent.createMany({ data: rows, skipDuplicates: true });

  const byType = EVENTS.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }), {});
  console.log(`✓ ${count} calendar events on ${sem.label}:`, JSON.stringify(byType));
  console.log("✓ SEM-III calendar loaded.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
