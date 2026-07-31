// Seed daily attendance for EMP015's SY-3 (batches C1–C9) for the week
// 20–26 July 2026, so the coordinator Daily Attendance PDF has real data.
//
// Attendance is TIMETABLE-DRIVEN: for each batch on each weekday we only create
// records for the subjects actually scheduled in the timetable that day — never
// all six subjects. Per student per day we pick a disposition so the PDF shows
// both colours: ~8% fully absent (BLACK), ~30% partial (RED), rest present.
// Sunday (26 Jul) is a non-working day, so it is skipped.
import prisma from "../src/config/prisma.js";

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[], n: number) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

async function chunked<T>(model: { createMany: (a: { data: T[]; skipDuplicates?: boolean }) => Promise<{ count: number }> }, rows: T[], size = 5000) {
  let n = 0;
  for (let i = 0; i < rows.length; i += size) n += (await model.createMany({ data: rows.slice(i, i + size), skipDuplicates: true })).count;
  return n;
}

async function main() {
  const hod = await prisma.faculty.findFirst({ where: { employeeId: { equals: "EMP015", mode: "insensitive" } }, select: { id: true, universityId: true } });
  if (!hod) throw new Error("EMP015 not found.");
  const scope = await prisma.hodBatchScope.findFirst({ where: { facultyId: hod.id, semester: { status: "ACTIVE" } }, include: { semester: true } });
  if (!scope) throw new Error("EMP015 has no active scoped semester.");
  const sem = scope.semester;

  const enrollments = await prisma.studentEnrollment.findMany({ where: { semesterId: sem.id, isCurrent: true }, select: { id: true, batchId: true } });

  // Timetable: batchId → weekday(1-6) → { subjectId → facultyId }. Distinct
  // subjects per (batch, day) is what attendance is taken for.
  const slots = await prisma.timetableSlot.findMany({ where: { semesterId: sem.id }, select: { batchId: true, subjectId: true, facultyId: true, dayOfWeek: true } });
  const tt = new Map<string, Map<string, string | null>>(); // `${batchId}|${dow}` → subjectId → facultyId
  for (const s of slots) {
    const key = `${s.batchId}|${s.dayOfWeek}`;
    let m = tt.get(key); if (!m) { m = new Map(); tt.set(key, m); }
    if (!m.has(s.subjectId)) m.set(s.subjectId, s.facultyId);
  }
  if (slots.length === 0) throw new Error("No timetable slots — generate the timetable first.");

  // Working days only: Mon 20 … Sat 25 July 2026 (skip Sunday 26).
  const dates: Date[] = [];
  for (let d = 20; d <= 26; d++) { const day = new Date(Date.UTC(2026, 6, d)); if (day.getUTCDay() !== 0) dates.push(day); }

  const enrIds = enrollments.map((e) => e.id);
  for (let i = 0; i < enrIds.length; i += 500) {
    await prisma.attendanceRecord.deleteMany({ where: { enrollmentId: { in: enrIds.slice(i, i + 500) }, lectureDate: { in: dates } } });
  }

  const rows: any[] = [];
  for (const day of dates) {
    const dow = day.getUTCDay();
    for (const enr of enrollments) {
      const todays = tt.get(`${enr.batchId}|${dow}`); // subjectId → facultyId scheduled for this batch today
      if (!todays || todays.size === 0) continue; // batch has no class this weekday
      const subjectIds = [...todays.keys()];
      const r = Math.random();
      let absent = new Set<string>();
      if (r < 0.08) absent = new Set(subjectIds);                               // fully absent → BLACK
      else if (r < 0.33) absent = new Set(pick(subjectIds, rand(1, Math.max(1, subjectIds.length - 1)))); // partial → RED
      else if (r < 0.40) absent = new Set(pick(subjectIds, 1));                 // single miss → RED
      for (const [subjectId, fac] of todays) {
        rows.push({ enrollmentId: enr.id, subjectId, facultyId: fac ?? hod.id, lectureDate: day, isPresent: !absent.has(subjectId), isLocked: true });
      }
    }
  }
  const n = await chunked(prisma.attendanceRecord, rows);
  console.log(`✓ Seeded ${n} timetable-driven attendance records · ${dates.length} days (${dates.map((d) => d.toISOString().slice(0, 10)).join(", ")})`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
