/**
 * Spreadsheet reading for the import centre.
 *  - .xlsx → ExcelJS
 *  - .csv  → built-in RFC-4180 parser (delimiter auto-detected)
 *  - .xls  → SheetJS (legacy binary format). See EXCEL_IMPORT_SPEC.md §10 for the
 *            security note on the npm build of SheetJS.
 * Every file is size-limited and checked by magic bytes, not just by extension.
 */
import ExcelJS from "exceljs";
import { badRequest } from "./errors";

export type Cell = string | number | boolean | null;

export interface SheetData {
  name: string;
  headerRow: number; // 1-based row number of the detected header
  headers: string[];
  rows: { rowNumber: number; values: Record<string, Cell> }[];
}

// Vercel functions accept at most 4.5 MB request bodies. Browsers gzip large files before
// upload (see import page), so the file itself may be larger than the request.
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || (process.env.VERCEL ? 4 : 10)) * 1024 * 1024;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_ROWS = 50_000;

export type FileKind = "xlsx" | "xls" | "csv";

export function detectKind(fileName: string, buf: Buffer): FileKind {
  const ext = fileName.toLowerCase().split(".").pop();
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  const isOle = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (ext === "xlsx" && isZip) return "xlsx";
  if (ext === "xls" && (isOle || isZip)) return isZip ? "xlsx" : "xls";
  if (ext === "csv") {
    if (buf.subarray(0, Math.min(buf.length, 8192)).includes(0)) throw badRequest("This CSV file contains binary data");
    return "csv";
  }
  throw badRequest("Unsupported or corrupted file. Upload .xlsx, .xls or .csv");
}

function cellToValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cellToValue(o.result); // formula
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("").trim() || null;
    if ("text" in o) return cellToValue(o.text); // hyperlink
    if ("error" in o) return null;
  }
  return String(v);
}

/** The header is the row (within the first 15) with the most non-empty text cells. Title rows above it are skipped. */
function detectHeader(grid: Cell[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const row = grid[i] ?? [];
    const texts = row.filter((c) => typeof c === "string" && c.trim() && !/^\d+([.,]\d+)?$/.test(c)).length;
    const nonEmpty = row.filter((c) => c !== null && c !== "").length;
    const score = texts * 2 - (nonEmpty - texts);
    if (texts >= 2 && score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

function gridToSheet(name: string, grid: Cell[][]): SheetData | null {
  const nonEmptyRows = grid.filter((r) => r?.some((c) => c !== null && c !== ""));
  if (nonEmptyRows.length < 2) return null;
  const h = detectHeader(grid);
  const seen = new Map<string, number>();
  const headerCells = grid[h] ?? [];
  const width = Math.max(...grid.slice(h, h + 200).map((r) => r?.length ?? 0));
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    let label = String(headerCells[c] ?? "").replace(/\s+/g, " ").trim() || `Column ${c + 1}`;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    if (n > 1) label = `${label} (${n})`;
    headers.push(label);
  }
  const rows: SheetData["rows"] = [];
  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !row.some((c) => c !== null && c !== "")) continue;
    const values: Record<string, Cell> = {};
    headers.forEach((hd, i) => (values[hd] = row[i] ?? null));
    rows.push({ rowNumber: r + 1, values });
    if (rows.length > MAX_ROWS) throw badRequest(`Too many rows (max ${MAX_ROWS.toLocaleString()} per sheet). Split the file.`);
  }
  // Drop unnamed columns that are completely empty.
  const used = headers.filter((hd) => !hd.startsWith("Column ") || rows.some((r) => r.values[hd] !== null));
  for (const r of rows) for (const hd of headers) if (!used.includes(hd)) delete r.values[hd];
  return { name, headerRow: h + 1, headers: used, rows };
}

async function readXlsx(buf: Buffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw badRequest("Could not read this Excel file. Is it password-protected or corrupted?");
  }
  const out: SheetData[] = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    const grid: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cellToValue(cell.value);
      });
      grid[rowNumber - 1] = cells;
    });
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    const s = gridToSheet(ws.name, grid);
    if (s) out.push(s);
  });
  return out;
}

async function readXls(buf: Buffer): Promise<SheetData[]> {
  const XLSX = await import("xlsx");
  let wb;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellFormula: false, cellHTML: false, sheetRows: MAX_ROWS + 20 });
  } catch {
    throw badRequest("Could not read this .xls file");
  }
  const out: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true }) as Cell[][];
    // Convert cells formatted as dates to ISO strings using the cell's number format.
    const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
    if (range) {
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && cell.t === "n" && cell.z && /[dmy]/i.test(String(cell.z)) && !/^[#0.,%]+$/.test(String(cell.z))) {
            const parsed = XLSX.SSF.parse_date_code(cell.v as number);
            if (parsed && grid[r - range.s.r]) {
              grid[r - range.s.r][c - range.s.c] = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
            }
          }
        }
      }
    }
    const s = gridToSheet(name, grid.map((row) => row.map((v) => (typeof v === "string" ? v.trim() || null : v))));
    if (s) out.push(s);
  }
  return out;
}

/** RFC-4180 CSV parser with delimiter detection (comma / semicolon / tab). */
export function parseCsv(text: string): Cell[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  const push = () => {
    const t = field.trim();
    row.push(t === "" ? null : t);
    field = "";
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === delim) push();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      push();
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    push();
    rows.push(row);
  }
  return rows;
}

export async function readSpreadsheet(fileName: string, buf: Buffer): Promise<SheetData[]> {
  if (buf.length === 0) throw badRequest("The file is empty");
  if (buf.length > MAX_FILE_BYTES) throw badRequest(`File too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB). Export one month at a time.`);
  const kind = detectKind(fileName, buf);
  let sheets: SheetData[];
  if (kind === "xlsx") sheets = await readXlsx(buf);
  else if (kind === "xls") sheets = await readXls(buf);
  else {
    const s = gridToSheet("CSV", parseCsv(buf.toString("utf8")));
    sheets = s ? [s] : [];
  }
  if (!sheets.length) throw badRequest("No data found. The file needs a header row and at least one data row.");
  return sheets;
}
