import PDFDocument from "pdfkit";
import type { Response } from "express";

// One table shape, two renderers. Every export endpoint builds an ExportTable and
// sendExport turns it into CSV or a real PDF based on ?format=.
export interface ExportTable {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
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

export function toPdf(table: ExportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Wide tables get landscape so columns stay readable.
    const landscape = table.headers.length > 6;
    const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const colWidth = width / table.headers.length;
    const rowHeight = 18;

    doc.fontSize(16).font("Helvetica-Bold").text(table.title, left, doc.y);
    if (table.subtitle) doc.moveDown(0.2).fontSize(9).font("Helvetica").fillColor("#666").text(table.subtitle);
    doc.fillColor("#000").moveDown(0.6);

    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, width, rowHeight).fill("#EEF2FF");
      doc.fillColor("#1E293B").fontSize(8).font("Helvetica-Bold");
      table.headers.forEach((h, i) => doc.text(String(h), left + i * colWidth + 4, y + 5, { width: colWidth - 8, lineBreak: false }));
      doc.fillColor("#000").font("Helvetica");
      doc.y = y + rowHeight;
    };

    drawHeader();
    const bottom = doc.page.height - doc.page.margins.bottom - rowHeight;
    table.rows.forEach((row, ri) => {
      if (doc.y > bottom) {
        doc.addPage({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: 36 });
        drawHeader();
      }
      const y = doc.y;
      if (ri % 2 === 1) doc.rect(left, y, width, rowHeight).fill("#F8FAFC").fillColor("#000");
      doc.fontSize(8).font("Helvetica").fillColor("#0F172A");
      row.forEach((v, i) => doc.text(cell(v), left + i * colWidth + 4, y + 5, { width: colWidth - 8, lineBreak: false }));
      doc.y = y + rowHeight;
    });

    if (table.rows.length === 0) {
      doc.moveDown(1).fontSize(10).fillColor("#666").text("No records matched this export.", left, doc.y);
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
