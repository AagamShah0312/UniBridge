// One-off, idempotent: give every HOD a mentor code (they take lectures, so the
// timetable/attendance needs a code to show). Derives initials from the name,
// makes it unique within the university. HODs never get mentees regardless.
import prisma from "../src/config/prisma.js";

const initials = (name: string) => {
  const parts = name.replace(/^(prof\.?|dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, "").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "X";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? "X");
  return (first + last).toUpperCase();
};

async function main() {
  const hods = await prisma.faculty.findMany({ where: { isHod: true, mentorCode: null }, select: { id: true, name: true, employeeId: true, universityId: true } });
  for (const h of hods) {
    const base = initials(h.name);
    let code = base, n = 1;
    // Uniqueness within the same university (matches updateMentorCode's check).
    while (await prisma.faculty.findFirst({ where: { mentorCode: code, universityId: h.universityId, id: { not: h.id } }, select: { id: true } })) {
      code = `${base}${n++}`;
    }
    await prisma.faculty.update({ where: { id: h.id }, data: { mentorCode: code } });
    console.log(`  ${h.employeeId}  ${h.name.padEnd(28)} → ${code}`);
  }
  console.log(`✓ Backfilled ${hods.length} HOD mentor code(s).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
