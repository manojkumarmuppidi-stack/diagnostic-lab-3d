import { api } from "@/server/api";
import { requirePermission } from "@/server/authz";
import { badRequest } from "@/server/errors";
import { MODULES, isModuleKey } from "@/lib/modules";
import { listTransactions } from "@/server/services/transactions";
import { rowsToCsv, rowsToXlsx } from "@/server/exporters";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";

export const GET = api<{ module: string }>(async ({ actor, params, url }) => {
  requirePermission(actor, "reports.export");
  if (!isModuleKey(params.module)) throw badRequest("Unknown module");
  const q = Object.fromEntries(url.searchParams);
  const all: Record<string, unknown>[] = [];
  for (let page = 1; ; page++) {
    const r = await listTransactions(actor, params.module, { ...q, page: String(page), pageSize: "500" });
    all.push(...r.rows);
    if (page * 500 >= r.total || page > 400) break;
  }
  const def = MODULES[params.module];
  const cols = [...def.columns.filter((c) => c.key !== "attachments"), { key: "status", label: "Status" }, { key: "remarks", label: "Remarks" }, { key: "id", label: "Record ID" }];
  await audit(prisma, actor, { action: "EXPORT", entityType: def.label, after: { filters: q, rows: all.length } });
  const name = `AED-${params.module}-${q.from ?? "all"}-${q.to ?? "all"}`;
  if (q.format === "csv") {
    return new Response(rowsToCsv(cols, all), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  }
  const buf = await rowsToXlsx(def.label, cols, all);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
});
