// Parse an academic-calendar spreadsheet (CSV or Excel) into calendar events.
// CSV is parsed natively (no dependency); .xlsx/.xls uses the `xlsx` package,
// loaded lazily so a CSV upload never needs it.

export type EventTypeStr = "HOLIDAY" | "PUBLIC_HOLIDAY" | "READING_HOLIDAY" | "SEMESTER_BREAK" | "EXAM" | "CULTURAL" | "ACTIVITY" | "PHASE" | "OTHER";
export type VisibilityStr = "ALL" | "FACULTY_HOD" | "HOD_ONLY";

export interface ParsedEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  type: EventTypeStr;
  description: string | null;
  visibleTo: VisibilityStr;
}
export interface ParseResult { rows: ParsedEvent[]; errors: string[] }

const TYPE_MAP: Record<string, EventTypeStr> = {
  holiday: "HOLIDAY",
  "public holiday": "PUBLIC_HOLIDAY", public_holiday: "PUBLIC_HOLIDAY", gazetted: "PUBLIC_HOLIDAY",
  "reading holiday": "READING_HOLIDAY", reading_holiday: "READING_HOLIDAY", reading: "READING_HOLIDAY", study: "READING_HOLIDAY",
  "semester break": "SEMESTER_BREAK", semester_break: "SEMESTER_BREAK", break: "SEMESTER_BREAK", vacation: "SEMESTER_BREAK",
  exam: "EXAM", exams: "EXAM", examination: "EXAM", test: "EXAM",
  cultural: "CULTURAL", fest: "CULTURAL", festival: "CULTURAL",
  activity: "ACTIVITY", workshop: "ACTIVITY", seminar: "ACTIVITY", sports: "ACTIVITY", event: "ACTIVITY",
  phase: "PHASE",
  other: "OTHER",
};
const normalizeType = (raw: string): EventTypeStr => TYPE_MAP[raw.trim().toLowerCase().replace(/\s+/g, " ")] ?? "OTHER";
const normalizeVisibility = (raw: string): VisibilityStr => {
  const v = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return v === "FACULTY_HOD" || v === "FACULTY" ? "FACULTY_HOD" : v === "HOD_ONLY" || v === "HOD" ? "HOD_ONLY" : "ALL";
};

// Accepts ISO (yyyy-mm-dd), dd-mm-yyyy, dd/mm/yyyy, an Excel serial number, or a Date.
function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`); return Number.isNaN(d.getTime()) ? null : d; }
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, dd, mm, yy] = dmy;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d+(\.\d+)?$/.test(s)) { // Excel serial date (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// RFC-4180-ish CSV line splitter (handles quoted fields with commas/quotes).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Header aliases → canonical column keys.
const COL: Record<string, "title" | "start" | "end" | "type" | "description" | "visibility"> = {
  title: "title", event: "title", name: "title", occasion: "title",
  "start date": "start", startdate: "start", start: "start", from: "start", date: "start",
  "end date": "end", enddate: "end", end: "end", to: "end", till: "end",
  type: "type", category: "type", kind: "type",
  description: "description", desc: "description", remarks: "description", note: "description", notes: "description",
  visibility: "visibility", visibleto: "visibility", "visible to": "visibility", audience: "visibility",
};

function rowsToEvents(matrix: unknown[][]): ParseResult {
  const errors: string[] = [];
  if (matrix.length < 2) return { rows: [], errors: ["The file has no data rows."] };
  const header = matrix[0].map((h) => String(h ?? "").trim().toLowerCase());
  const idx: Partial<Record<"title" | "start" | "end" | "type" | "description" | "visibility", number>> = {};
  header.forEach((h, i) => { const key = COL[h]; if (key && idx[key] === undefined) idx[key] = i; });
  if (idx.title === undefined || idx.start === undefined) {
    return { rows: [], errors: ["Missing required columns. The file needs at least 'Title' and 'Start Date' columns."] };
  }
  const rows: ParsedEvent[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (!cells || cells.every((c) => String(c ?? "").trim() === "")) continue; // skip blank lines
    const title = String(cells[idx.title!] ?? "").trim();
    if (!title) { errors.push(`Row ${r + 1}: missing title — skipped.`); continue; }
    const start = parseDate(cells[idx.start!]);
    if (!start) { errors.push(`Row ${r + 1} ("${title}"): unreadable start date — skipped.`); continue; }
    const end = idx.end !== undefined ? parseDate(cells[idx.end]) ?? start : start;
    rows.push({
      title: title.slice(0, 200),
      startDate: start,
      endDate: end < start ? start : end,
      type: idx.type !== undefined ? normalizeType(String(cells[idx.type] ?? "")) : "OTHER",
      description: idx.description !== undefined ? (String(cells[idx.description] ?? "").trim() || null) : null,
      visibleTo: idx.visibility !== undefined ? normalizeVisibility(String(cells[idx.visibility] ?? "")) : "ALL",
    });
  }
  return { rows, errors };
}

export async function parseCalendarFile(buffer: Buffer, filename: string): Promise<ParseResult> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "txt") {
    const text = buffer.toString("utf-8").replace(/^﻿/, ""); // strip BOM
    const lines = text.split(/\r?\n/);
    return rowsToEvents(lines.map(splitCsvLine));
  }
  if (ext === "xlsx" || ext === "xls") {
    // Variable specifier so this compiles whether or not `xlsx` is installed;
    // a CSV upload never reaches here and needs no dependency.
    const mod = "xlsx";
    let XLSX: any;
    try { XLSX = await import(mod); }
    catch { return { rows: [], errors: ["Excel parsing is unavailable on the server. Please upload a .csv file instead."] }; }
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { rows: [], errors: ["The Excel file has no sheets."] };
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[][];
    return rowsToEvents(matrix);
  }
  return { rows: [], errors: [`Unsupported file type ".${ext}". Upload a .csv or .xlsx file.`] };
}

// A downloadable CSV template so HODs know the exact format.
export const CALENDAR_TEMPLATE_CSV = [
  "Title,Start Date,End Date,Type,Description,Visibility",
  "Independence Day,2026-08-15,2026-08-15,PUBLIC_HOLIDAY,National holiday,ALL",
  "Mid-Sem Break,2026-10-19,2026-10-25,SEMESTER_BREAK,,ALL",
  "T-1 Internal Exams,2026-09-07,2026-09-12,EXAM,Phase 1 internals,ALL",
  "Reading Day,2026-09-06,2026-09-06,READING_HOLIDAY,Study leave before T-1,ALL",
  "Tech Fest,2026-11-20,2026-11-21,CULTURAL,Annual technical festival,ALL",
].join("\n");
