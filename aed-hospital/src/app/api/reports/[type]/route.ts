import { api } from "@/server/api";
import { requirePermission } from "@/server/authz";
import { badRequest } from "@/server/errors";
import { REPORT_TYPES, buildReport, type ReportType } from "@/server/services/reports";
import { reportToCsv, reportToPdf, reportToXlsx } from "@/server/exporters";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";

/** Vercel function time limit (60 s is allowed on every Vercel plan). */
export const maxDuration = 60;

export const GET = api<{ type: string }>(async ({ actor, params, url }) => {
  if (!REPORT_TYPES.some((t) => t.key === params.type)) throw badRequest("Unknown report");
  const q = Object.fromEntries(url.searchParams);
  const report = await buildReport(actor, params.type as ReportType, q);
  const format = q.format ?? "json";
  if (format === "json") return report;
  requirePermission(actor, "reports.export");
  await audit(prisma, actor, { action: "REPORT_EXPORT", entityType: "Report", entityId: params.type, after: { format, from: report.from, to: report.to } });
  const name = `AED-${params.type}-${report.from}${report.to !== report.from ? `_${report.to}` : ""}`;
  if (format === "csv") return new Response(reportToCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  if (format === "pdf") {
    const buf = await reportToPdf(report);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` } });
  }
  if (format === "xlsx") {
    const buf = await reportToXlsx(report);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
  }
  throw badRequest("Unknown format");
});
