import PDFDocument from "pdfkit";
import type { Response } from "express";

// One table shape, two renderers. Every export endpoint builds an ExportTable and
// sendExport turns it into CSV or a real PDF based on ?format=.
//
// Everything past `rows` is OPTIONAL — existing callers keep working untouched, and
// richer callers can add a summary band, meta chips, alignment hints or a footnote.
export interface ExportTable {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
  /** Context chips under the title, e.g. { label: "Semester", value: "Semester 3" }. */
  meta?: { label: string; value: string }[];
  /** Highlight cards above the table, e.g. { label: "Avg attendance", value: "84%" }. */
  summary?: { label: string; value: string }[];
  /** Explanatory footnote printed under the table (legends, caveats). */
  note?: string;
  /** Per-column alignment. Omitted columns auto-detect: numeric → right, else left. */
  columnAlign?: ("left" | "right" | "center")[];
}

export type ExportFormat = "csv" | "pdf";

export function parseFormat(raw: unknown): ExportFormat {
  return String(Array.isArray(raw) ? raw[0] : raw ?? "").toLowerCase() === "pdf" ? "pdf" : "csv";
}

const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// RFC-4180: quote when the value holds a comma, quote or newline (student names do).
function csvCell(v: unknown) {
  const s = cell(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: ExportTable): string {
  return [table.headers.map(csvCell).join(","), ...table.rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

// ── Design tokens (match the portal's UI palette) ────────────
const BRAND = "#2563EB";
const INK = "#152232";
const MUTED = "#5B6B7B";
const FAINT = "#8DA0B4";
const RULE = "#E5EDF4";
const ZEBRA = "#F7FAFD";
const ORG = "L. J. Institute of Engineering & Technology";

const PAD = 6;
const MIN_COL = 46;

// Right-align real measures (marks, percentages, counts) but NOT identifiers: a 14-digit
// enrollment number is a label, and right-aligning it just opens a gap mid-table.
function isMeasure(s: string) {
  const t = s.trim();
  if (t === "" || !/^-?[\d,]+(\.\d+)?%?$/.test(t)) return false;
  const digits = t.replace(/\D/g, "");
  return digits.length <= 8 || t.includes("%") || t.includes(".");
}

/**
 * Column widths proportional to actual content, not equal slices. Measures the header
 * and a sample of rows so a "Name" column gets room while "T1" stays narrow — this is
 * what stops long student names being clipped.
 */
function computeWidths(doc: PDFKit.PDFDocument, table: ExportTable, total: number): number[] {
  const sample = table.rows.slice(0, 60);
  const demand = table.headers.map((h, i) => {
    doc.fontSize(8.5).font("Helvetica-Bold");
    let w = doc.widthOfString(cell(h));
    doc.font("Helvetica");
    for (const r of sample) w = Math.max(w, doc.widthOfString(cell(r[i])));
    return Math.min(w + PAD * 2, 260); // cap so one essay column can't eat the page
  });
  const sum = demand.reduce((a, b) => a + b, 0) || 1;
  const widths = demand.map((d) => Math.max(MIN_COL, (d / sum) * total));
  // Re-normalise after the MIN_COL floor so the row still spans exactly `total`.
  const grown = widths.reduce((a, b) => a + b, 0);
  return widths.map((w) => (w / grown) * total);
}

export function toPdf(table: ExportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const landscape = table.headers.length > 6;
    const doc = new PDFDocument({
      size: "A4",
      layout: landscape ? "landscape" : "portrait",
      margin: 40,
      bufferPages: true, // needed to stamp "Page x of y" once the total is known
      info: { Title: table.title, Author: ORG },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const widths = computeWidths(doc, table, width);
    const align: ("left" | "right" | "center")[] = table.headers.map((_h, i) =>
      table.columnAlign?.[i] ?? (table.rows.slice(0, 20).some((r) => isMeasure(cell(r[i]))) ? "right" : "left"),
    );

    // ── Letterhead ────────────────────────────────────────────
    doc.fillColor(BRAND).fontSize(8).font("Helvetica-Bold")
      .text(ORG.toUpperCase(), left, doc.y, { characterSpacing: 1.1 });
    doc.moveDown(0.35);
    doc.fillColor(INK).fontSize(19).font("Helvetica-Bold").text(table.title, { lineGap: 1 });
    if (table.subtitle) {
      doc.moveDown(0.2).fillColor(MUTED).fontSize(10).font("Helvetica").text(table.subtitle);
    }

    // Context chips + generated stamp
    const stamp = `Generated ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
    const chips = [...(table.meta ?? []).map((m) => `${m.label}: ${m.value}`), `${table.rows.length} record${table.rows.length === 1 ? "" : "s"}`, stamp];
    doc.moveDown(0.45).fillColor(FAINT).fontSize(8.5).font("Helvetica").text(chips.join("   ·   "), { width });

    // Brand rule under the masthead
    doc.moveDown(0.5);
    doc.save().rect(left, doc.y, width, 2).fill(BRAND).restore();
    doc.y += 12;

    // ── Summary cards ─────────────────────────────────────────
    if (table.summary?.length) {
      const n = table.summary.length;
      const gap = 8;
      const cw = (width - gap * (n - 1)) / n;
      const y0 = doc.y;
      const ch = 40;
      table.summary.forEach((s, i) => {
        const x = left + i * (cw + gap);
        doc.save().roundedRect(x, y0, cw, ch, 6).fill(ZEBRA).restore();
        doc.fillColor(FAINT).fontSize(7).font("Helvetica-Bold").text(s.label.toUpperCase(), x + 8, y0 + 7, { width: cw - 16, characterSpacing: 0.6, lineBreak: false });
        doc.fillColor(INK).fontSize(14).font("Helvetica-Bold").text(s.value, x + 8, y0 + 18, { width: cw - 16, lineBreak: false });
      });
      doc.y = y0 + ch + 14;
    }

    // ── Table ─────────────────────────────────────────────────
    const HEAD_H = 22;

    const drawHeader = () => {
      const y = doc.y;
      doc.save().rect(left, y, width, HEAD_H).fill(BRAND).restore();
      doc.fillColor("#FFFFFF").fontSize(8.5).font("Helvetica-Bold");
      let x = left;
      table.headers.forEach((h, i) => {
        doc.text(cell(h), x + PAD, y + 7, { width: widths[i] - PAD * 2, align: align[i], lineBreak: false });
        x += widths[i];
      });
      doc.y = y + HEAD_H;
    };

    // Height of a row once every cell wraps within its column.
    const rowHeight = (row: (string | number | null | undefined)[]) => {
      doc.fontSize(8.5).font("Helvetica");
      const h = Math.max(
        ...row.map((v, i) => doc.heightOfString(cell(v), { width: widths[i] - PAD * 2 })),
        11,
      );
      return h + 9;
    };

    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 28; // leave room for the footer

    drawHeader();
    table.rows.forEach((row, ri) => {
      const h = rowHeight(row);
      if (doc.y + h > bottomLimit()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (ri % 2 === 1) doc.save().rect(left, y, width, h).fill(ZEBRA).restore();
      doc.fillColor(INK).fontSize(8.5).font("Helvetica");
      let x = left;
      row.forEach((v, i) => {
        // Wraps instead of truncating — the old renderer clipped long names.
        doc.text(cell(v), x + PAD, y + 4.5, { width: widths[i] - PAD * 2, align: align[i] });
        x += widths[i];
      });
      doc.save().moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(RULE).stroke().restore();
      doc.y = y + h;
    });

    if (table.rows.length === 0) {
      doc.moveDown(1.2).fillColor(MUTED).fontSize(10).font("Helvetica")
        .text("No records matched this export.", left, doc.y, { width, align: "center" });
    }

    if (table.note) {
      doc.moveDown(1).fillColor(MUTED).fontSize(8).font("Helvetica-Oblique").text(table.note, left, doc.y, { width });
    }

    // ── Footer on every page (page count is only known now) ───
    // bufferedPageRange()/switchToPage() come from `bufferPages: true`. The cast is only
    // needed because @types/pdfkit under-declares them.
    const paged = doc as unknown as { bufferedPageRange(): { start: number; count: number }; switchToPage(n: number): void };
    const range = paged.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      paged.switchToPage(i);
      const fy = doc.page.height - doc.page.margins.bottom - 16;
      doc.save().moveTo(left, fy - 6).lineTo(left + width, fy - 6).lineWidth(0.5).strokeColor(RULE).stroke().restore();
      doc.fillColor(FAINT).fontSize(7.5).font("Helvetica");
      doc.text(ORG, left, fy, { width: width / 2, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, left + width / 2, fy, { width: width / 2, align: "right", lineBreak: false });
    }

    doc.end();
  });
}

/** Send an ExportTable as a CSV or PDF attachment. `baseName` carries no extension. */
export async function sendExport(res: Response, baseName: string, format: ExportFormat, table: ExportTable) {
  if (format === "pdf") {
    const buf = await toPdf(table);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}.pdf"`);
    res.status(200).send(buf);
    return;
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${baseName}.csv"`);
  res.status(200).send(toCsv(table));
}
