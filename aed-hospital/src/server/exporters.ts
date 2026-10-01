/**
 * Render reports and transaction lists to Excel (ExcelJS), CSV and PDF (pdfkit).
 * PDFs use the built-in Helvetica font, which has no ₹ glyph, so amounts print as "Rs.".
 */
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { formatDate } from "@/lib/dates";
import type { ColType, Report, ReportColumn } from "./services/reports";

const INR_FMT = '"₹"#,##,##0.00;[Red]-"₹"#,##,##0.00';

function fmtPlain(v: unknown, t?: ColType): string {
  if (v === null || v === undefined || v === "") return t === "pct" ? "—" : "";
  if (t === "money" && typeof v === "number") return `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
  if (t === "int" && typeof v === "number") return new Intl.NumberFormat("en-IN").format(v);
  if (t === "pct" && typeof v === "number") return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  if (t === "date" && typeof v === "string") return formatDate(v);
  return String(v);
}

function sheetName(s: string, used: Set<string>) {
  const base = s.replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Sheet";
  let n = 1;
  let name = base;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 25)} ${++n}`;
  used.add(name.toLowerCase());
  return name;
}

function applyColumnFormats(ws: ExcelJS.Worksheet, cols: ReportColumn[], startRow: number, endRow: number) {
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(col.width ?? 10, c.type === "money" ? 16 : c.type === "text" || !c.type ? 26 : 12);
    for (let r = startRow; r <= endRow; r++) {
      const cell = ws.getCell(r, i + 1);
      if (c.type === "money") cell.numFmt = INR_FMT;
      if (c.type === "pct" && typeof cell.value === "number") cell.numFmt = '0.0"%"';
      if (c.type === "int") cell.numFmt = "#,##0";
    }
  });
}

export async function reportToXlsx(report: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.hospital;
  wb.created = new Date();
  const used = new Set<string>();
  const sum = wb.addWorksheet(sheetName("Summary", used));
  sum.addRow([report.hospital]).font = { bold: true, size: 14 };
  sum.addRow([report.address]);
  sum.addRow([report.title]).font = { bold: true, size: 12 };
  sum.addRow([`Period: ${report.period}`]);
  sum.addRow([`Generated ${new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by ${report.generatedBy}`]);
  sum.addRow([]);
  sum.addRow(["Key figures"]).font = { bold: true };
  for (const k of report.kpis) {
    const row = sum.addRow([k.label, k.value]);
    if (k.type === "money") row.getCell(2).numFmt = INR_FMT;
    if (k.type === "pct") row.getCell(2).numFmt = '0.0"%"';
  }
  sum.addRow([]);
  sum.addRow(["Definitions"]).font = { bold: true };
  for (const n of report.notes) sum.addRow([n]);
  sum.getColumn(1).width = 40;
  sum.getColumn(2).width = 20;

  for (const t of report.tables) {
    const ws = wb.addWorksheet(sheetName(t.title, used));
    ws.addRow([`${report.title} — ${t.title}`]).font = { bold: true };
    ws.addRow([report.period]);
    const header = ws.addRow(t.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } }));
    const first = ws.rowCount + 1;
    for (const r of t.rows) ws.addRow(t.columns.map((c) => (r[c.key] ?? null) as ExcelJS.CellValue));
    if (t.totals) ws.addRow(t.columns.map((c) => (t.totals![c.key] ?? null) as ExcelJS.CellValue)).font = { bold: true };
    applyColumnFormats(ws, t.columns, first, ws.rowCount);
    ws.views = [{ state: "frozen", ySplit: 3 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function reportToCsv(report: Report): string {
  const lines: string[] = [];
  lines.push(csvCell(`${report.hospital} — ${report.title}`), csvCell(`Period: ${report.period}`), "");
  lines.push("Key figures");
  for (const k of report.kpis) lines.push([k.label, k.value ?? ""].map(csvCell).join(","));
  for (const t of report.tables) {
    lines.push("", csvCell(t.title), t.columns.map((c) => csvCell(c.label)).join(","));
    for (const r of t.rows) lines.push(t.columns.map((c) => csvCell(r[c.key])).join(","));
    if (t.totals) lines.push(t.columns.map((c) => csvCell(t.totals![c.key])).join(","));
  }
  return "﻿" + lines.join("\r\n");
}

export function rowsToCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  return "﻿" + [columns.map((c) => csvCell(c.label)).join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","))].join("\r\n");
}

export async function rowsToXlsx(title: string, columns: { key: string; label: string; type?: string }[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.slice(0, 28) || "Data");
  const h = ws.addRow(columns.map((c) => c.label));
  h.font = { bold: true };
  for (const r of rows) ws.addRow(columns.map((c) => (r[c.key] ?? null) as ExcelJS.CellValue));
  applyColumnFormats(ws, columns as ReportColumn[], 2, ws.rowCount);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function templateXlsx(title: string, headers: string[], sample: (string | number)[][], notes: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  const h = ws.addRow(headers);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E5AE0" } }));
  for (const s of sample) ws.addRow(s);
  headers.forEach((_, i) => (ws.getColumn(i + 1).width = 18));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const info = wb.addWorksheet("Instructions");
  info.addRow([`${title} — import template`]).font = { bold: true, size: 13 };
  info.addRow(["The sample row is FICTIONAL DEMO DATA — delete it before importing."]);
  info.addRow([]);
  for (const n of notes) info.addRow([n]);
  info.getColumn(1).width = 110;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function reportToPdf(report: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: `${report.title} — ${report.period}`, Author: report.hospital } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const pageW = doc.page.width - 72;

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#1b3771").text(report.hospital);
    doc.font("Helvetica").fontSize(9).fillColor("#555").text(report.address);
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text(report.title);
    doc.font("Helvetica").fontSize(9).fillColor("#333").text(`Period: ${report.period}`);
    doc.text(`Generated ${new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by ${report.generatedBy}`);
    doc.moveDown(0.8);

    // KPI grid (3 per row)
    const kw = pageW / 3;
    report.kpis.forEach((k, i) => {
      if (i % 3 === 0 && i) doc.y += 38;
      const x = 36 + (i % 3) * kw;
      const y = doc.y;
      doc.roundedRect(x + 2, y, kw - 6, 34, 4).fillAndStroke("#f3f6fb", "#d9e2f0");
      doc.fillColor("#555").font("Helvetica").fontSize(7.5).text(k.label.toUpperCase(), x + 8, y + 5, { width: kw - 16 });
      doc.fillColor("#111").font("Helvetica-Bold").fontSize(11).text(fmtPlain(k.value, k.type) || "—", x + 8, y + 17, { width: kw - 16 });
      doc.y = y;
    });
    doc.y += 46;
    doc.x = 36;

    for (const t of report.tables) {
      drawTable(doc, t.title, t.columns, t.rows, t.totals, pageW);
    }
    if (report.notes.length) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.moveDown(0.5).font("Helvetica-Bold").fontSize(9).fillColor("#000").text(report.notesTitle ?? "Definitions", 36);
      doc.font("Helvetica").fontSize(8).fillColor("#444");
      for (const n of report.notes) doc.text(`• ${n.replace(/₹\s?/g, "Rs. ").replace(/−/g, "-")}`, 36, undefined, { width: pageW });
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // The footer sits inside the bottom margin; without lifting the margin pdfkit would start a blank page.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(7.5).fillColor("#888").text(`${report.hospital} · ${report.title} · Page ${i + 1} of ${range.count}`, 36, doc.page.height - 28, { width: pageW, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}

function drawTable(doc: PDFKit.PDFDocument, title: string, cols: ReportColumn[], rows: Record<string, unknown>[], totals: Record<string, unknown> | undefined, pageW: number) {
  const fontSize = cols.length > 8 ? 6.5 : cols.length > 5 ? 7.5 : 8.5;
  const weights = cols.map((c) => (!c.type || c.type === "text" ? 2 : c.type === "money" ? 1.3 : 1));
  const tw = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / tw) * pageW);
  const rowH = fontSize + 7;
  const bottom = doc.page.height - 48;
  const header = () => {
    let x = 36;
    doc.rect(36, doc.y, pageW, rowH).fill("#1e5ae0");
    const y = doc.y;
    cols.forEach((c, i) => {
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(fontSize).text(c.label, x + 3, y + 3.5, { width: widths[i] - 6, align: c.type && c.type !== "text" ? "right" : "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + rowH;
  };
  if (doc.y > bottom - rowH * 4) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#1b3771").text(title, 36, doc.y);
  doc.moveDown(0.2);
  header();
  const drawRow = (r: Record<string, unknown>, bold: boolean, shade: boolean) => {
    if (doc.y + rowH > bottom) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    if (shade) doc.rect(36, y, pageW, rowH).fill(bold ? "#e8eef7" : "#f8fafc");
    let x = 36;
    cols.forEach((c, i) => {
      doc.fillColor("#111").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).text(fmtPlain(r[c.key], c.type), x + 3, y + 3.5, { width: widths[i] - 6, align: c.type && c.type !== "text" ? "right" : "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + rowH;
  };
  if (!rows.length) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#777").text("No records in this period.", 40, doc.y + 3);
    doc.moveDown(0.5);
  }
  rows.forEach((r, i) => drawRow(r, false, i % 2 === 1));
  if (totals) drawRow(totals, true, true);
  doc.y += 10;
  doc.x = 36;
}
