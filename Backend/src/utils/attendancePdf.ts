// Dedicated renderers for the two attendance reports the coordinator generates.
// The generic ExportTable in export.ts can't express these layouts (per-batch
// grids with colour-coded roll numbers; a very wide compiled sheet), so they get
// their own pdfkit code. Both return a Buffer for the route to stream.
import PDFDocument from "pdfkit";

const BLUE = "#4A72B0";      // header band
const BLUE_LT = "#BDD7EE";   // sub-header
const RED = "#C0392B";       // partial-absence / below-threshold
const INK = "#111111";
const GREY = "#666666";
const GRID = "#B8B8B8";

function buffered(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// ── Daily: one page section per batch, two batches per row ──────────────────
export interface DailyLecture { no: number; subject: string; faculty: string; absent: { roll: number; partial: boolean }[] }
export interface DailyBatch { code: string; lectures: DailyLecture[] }
export interface DailyPdfData {
  institute: string; department: string; semester: string;
  date: string; weekNo: number | string; day: string; batches: DailyBatch[];
}

export function renderDailyAttendancePdf(data: DailyPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  const bandRow = (text: string, bg: string, fg: string, size: number, h = 20) => {
    const y = doc.y;
    doc.rect(left, y, width, h).fill(bg);
    doc.fillColor(fg).font("Helvetica-Bold").fontSize(size).text(text, left, y + (h - size) / 2 - 1, { width, align: "center" });
    doc.fillColor(INK).font("Helvetica").y = y + h;
  };

  // ── Title + legend banner ──
  bandRow(data.institute, BLUE, "#ffffff", 13, 24);
  bandRow(`Department: ${data.department}   |   Semester: ${data.semester}`, BLUE_LT, "#1a3c66", 10);
  bandRow("FONT COLOUR: BLACK (Absent in all Lectures)", "#ECECEC", INK, 9, 16);
  bandRow("RED (Not attended all Lectures)", "#FBDDDD", RED, 9, 16);
  bandRow(`Date: ${data.date}   |   Week No: ${data.weekNo}   |   Day: ${data.day}`, "#E4EEDC", "#2f5d1e", 9, 16);
  doc.moveDown(0.5);

  const colW = (width - 12) / 2; // two batch tables per row, 12pt gutter
  // No | Subject | Faculty | Absent Nos
  const sub = [26, 88, 66, colW - 26 - 88 - 66];
  const rowGap = 4;
  const bottom = doc.page.height - doc.page.margins.bottom;

  const lectureHeight = (lec: DailyLecture) => {
    const txt = lec.absent.length ? lec.absent.map((a) => a.roll).join(", ") : "—";
    const h = doc.font("Helvetica").fontSize(8).heightOfString(txt, { width: sub[3] - 8 });
    return Math.max(20, h + 8);
  };
  const batchHeight = (b: DailyBatch) => 18 + 16 + b.lectures.reduce((s, l) => s + lectureHeight(l), 0);

  const drawBatch = (b: DailyBatch, x: number, y0: number) => {
    let y = y0;
    doc.rect(x, y, colW, 18).fill(BLUE);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10).text(`Batch: ${b.code}`, x, y + 4, { width: colW, align: "center" });
    y += 18;
    // column header
    doc.rect(x, y, colW, 16).fill(BLUE_LT);
    doc.fillColor("#1a3c66").fontSize(8).font("Helvetica-Bold");
    ["No", "Subject", "Faculty", "Absent Nos"].forEach((h, i) => {
      const cx = x + sub.slice(0, i).reduce((a, c) => a + c, 0);
      doc.text(h, cx + 4, y + 4, { width: sub[i] - 6, lineBreak: false });
    });
    y += 16;
    doc.font("Helvetica").fillColor(INK);
    b.lectures.forEach((lec) => {
      const h = lectureHeight(lec);
      doc.lineWidth(0.5).strokeColor(GRID).rect(x, y, colW, h).stroke();
      let cx = x;
      doc.fillColor(INK).fontSize(8).font("Helvetica");
      doc.text(String(lec.no), cx + 4, y + 4, { width: sub[0] - 6, lineBreak: false }); cx += sub[0];
      doc.text(lec.subject, cx + 4, y + 4, { width: sub[1] - 6, lineBreak: false }); cx += sub[1];
      doc.text(lec.faculty, cx + 4, y + 4, { width: sub[2] - 6, lineBreak: false }); cx += sub[2];
      // Absent Nos: colour each roll number (red = partial, black = absent-all)
      if (!lec.absent.length) {
        doc.fillColor(GREY).text("—", cx + 4, y + 4, { width: sub[3] - 8 });
      } else {
        doc.fontSize(8);
        const startX = cx + 4;
        doc.text("", startX, y + 4, { width: sub[3] - 8, continued: false });
        doc.y = y + 4; doc.x = startX;
        lec.absent.forEach((a, i) => {
          const last = i === lec.absent.length - 1;
          doc.fillColor(a.partial ? RED : INK).font(a.partial ? "Helvetica-Bold" : "Helvetica")
            .text(a.roll + (last ? "" : ", "), { width: sub[3] - 8, continued: !last });
        });
      }
      doc.fillColor(INK).font("Helvetica");
      y += h;
    });
    // vertical separators
    doc.lineWidth(0.5).strokeColor(GRID);
    let vx = x;
    for (let i = 0; i < sub.length - 1; i++) { vx += sub[i]; doc.moveTo(vx, y0 + 34).lineTo(vx, y).stroke(); }
    return y;
  };

  // pair batches: left/right, advance by the taller
  for (let i = 0; i < data.batches.length; i += 2) {
    const pair = data.batches.slice(i, i + 2);
    const need = Math.max(...pair.map(batchHeight));
    if (doc.y + need > bottom) { doc.addPage({ size: "A4", layout: "landscape", margin: 28 }); }
    const y0 = doc.y;
    let maxY = y0;
    pair.forEach((b, k) => { const endY = drawBatch(b, left + k * (colW + 12), y0); maxY = Math.max(maxY, endY); });
    doc.y = maxY + rowGap;
  }
  return buffered(doc);
}

// ── Weekly: one wide compiled row per student ───────────────────────────────
export interface WeeklyStudent {
  roll: number; div: string; enrollmentNo: string; name: string;
  subjects: { attended: number; total: number }[]; // aligned to subjectCodes
  overallAttended: number; overallTotal: number; mentor: string;
}
export interface WeeklyPdfData {
  institute: string; department: string; semester: string; uptoLabel: string;
  subjectCodes: string[]; students: WeeklyStudent[]; threshold: number;
}

const pct = (a: number, t: number) => (t > 0 ? Math.round((a / t) * 1000) / 10 : 0);
// pdfkit's lineBreak:false overflows rather than clips, so a long name bleeds into
// the next row. Hard-cap the character count to keep every row one line tall.
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function renderWeeklyAttendancePdf(data: WeeklyPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 20 });
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  // identity(4) + one cell per subject + overall + mentor
  const idW = [26, 26, 92, 120];
  const tailN = data.subjectCodes.length + 2; // subjects + overall + mentor
  const cellW = (width - idW.reduce((a, c) => a + c, 0)) / tailN;
  const headers = ["Roll", "Div", "Enrollment", "Name", ...data.subjectCodes, "Overall", "Mentor"];
  const colX = (i: number) => {
    if (i < 4) return left + idW.slice(0, i).reduce((a, c) => a + c, 0);
    return left + idW.reduce((a, c) => a + c, 0) + (i - 4) * cellW;
  };
  const colW = (i: number) => (i < 4 ? idW[i] : cellW);
  const rowH = 16;
  const bottom = doc.page.height - doc.page.margins.bottom - rowH;

  doc.rect(left, doc.y, width, 22).fill(BLUE);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(12).text(data.institute, left, doc.y + 5, { width, align: "center" });
  doc.fillColor(INK).font("Helvetica").y += 22;
  doc.rect(left, doc.y, width, 16).fill("#DDE8F5");
  doc.fillColor("#1a3c66").fontSize(9).font("Helvetica-Bold")
    .text(`${data.department} · ${data.semester} · Compiled Attendance ${data.uptoLabel}   (below ${data.threshold}% in red)`, left, doc.y + 3, { width, align: "center" });
  doc.fillColor(INK).font("Helvetica").y += 16;
  doc.moveDown(0.3);

  const drawHead = () => {
    const y = doc.y;
    doc.rect(left, y, width, rowH).fill(BLUE);
    doc.fillColor("#fff").fontSize(7).font("Helvetica-Bold");
    headers.forEach((h, i) => doc.text(h, colX(i) + 2, y + 5, { width: colW(i) - 3, align: i < 4 ? "left" : "center", lineBreak: false }));
    doc.fillColor(INK).font("Helvetica").y = y + rowH;
  };
  drawHead();

  data.students.forEach((s, ri) => {
    if (doc.y > bottom) { doc.addPage({ size: "A4", layout: "landscape", margin: 20 }); drawHead(); }
    const y = doc.y;
    if (ri % 2 === 1) { doc.rect(left, y, width, rowH).fill("#F5F8FC"); doc.fillColor(INK); }
    const overallPct = pct(s.overallAttended, s.overallTotal);
    const below = overallPct < data.threshold;
    doc.fontSize(7).font(below ? "Helvetica-Bold" : "Helvetica");
    doc.fillColor(below ? RED : INK).text(String(s.roll), colX(0) + 2, y + 5, { width: colW(0) - 3, lineBreak: false });
    doc.text(s.div, colX(1) + 2, y + 5, { width: colW(1) - 3, lineBreak: false });
    doc.text(s.enrollmentNo, colX(2) + 2, y + 5, { width: colW(2) - 3, lineBreak: false });
    doc.text(clip(s.name, 30), colX(3) + 2, y + 5, { width: colW(3) - 3, lineBreak: false });
    s.subjects.forEach((sub, i) => {
      const p = pct(sub.attended, sub.total);
      doc.fillColor(sub.total > 0 && p < data.threshold ? RED : INK).font(sub.total > 0 && p < data.threshold ? "Helvetica-Bold" : "Helvetica")
        .text(sub.total ? `${sub.attended}/${sub.total} ${p}%` : "—", colX(4 + i) + 1, y + 5, { width: cellW - 2, align: "center", lineBreak: false });
    });
    const oi = 4 + data.subjectCodes.length;
    doc.fillColor(below ? RED : INK).font(below ? "Helvetica-Bold" : "Helvetica")
      .text(`${s.overallAttended}/${s.overallTotal} ${overallPct}%`, colX(oi) + 1, y + 5, { width: cellW - 2, align: "center", lineBreak: false });
    doc.fillColor(INK).font("Helvetica").text(s.mentor || "—", colX(oi + 1) + 1, y + 5, { width: cellW - 2, align: "center", lineBreak: false });
    doc.y = y + rowH;
  });

  if (!data.students.length) doc.moveDown(1).fontSize(10).fillColor(GREY).text("No students in this semester.", left, doc.y);
  return buffered(doc);
}
