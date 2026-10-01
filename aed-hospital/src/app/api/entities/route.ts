import { api } from "@/server/api";
import { requirePermission } from "@/server/authz";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { reportToPdf } from "@/server/exporters";
import { entityAccounts, entityReport } from "@/server/services/entities";

export const maxDuration = 60;

export const GET = api(async ({ actor, url }) => {
  const q = { from: url.searchParams.get("from"), to: url.searchParams.get("to") };
  if (url.searchParams.get("format") !== "pdf") return entityAccounts(actor, q);
  requirePermission(actor, "reports.export");
  const report = await entityReport(actor, q);
  await audit(prisma, actor, { action: "REPORT_EXPORT", entityType: "Report", entityId: "entities", after: { format: "pdf", from: report.from, to: report.to } });
  const buf = await reportToPdf(report);
  const name = `AED-vs-Hormonal-Pharmacy-PL-${report.from.slice(0, 7)}_${report.to.slice(0, 7)}`;
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` } });
});
