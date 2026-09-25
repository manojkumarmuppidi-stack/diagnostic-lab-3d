"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { download, qs } from "@/lib/client";
import { startOfMonth } from "@/lib/dates";
import { IMPORT_TYPES, MODULES, MODULE_KEYS, type ModuleKey } from "@/lib/modules";
import { Button, Card, PageHeader, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useCan, useSession } from "@/components/session";

export default function ExportPage() {
  const { today } = useSession();
  const can = useCan();
  const toast = useToast();
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  const [includeAll, setIncludeAll] = useState(false);
  const run = (m: ModuleKey, format: "xlsx" | "csv") =>
    download(`/api/export/${m}${qs({ from, to, format, status: includeAll ? "ALL" : "" })}`).catch((e) => toast("error", e.message));
  const modules = MODULE_KEYS.filter((m) => can(`${MODULES[m].perm}.view` as never));
  return (
    <Guard perm="reports.export">
      <PageHeader title="Excel Export" subtitle="Download raw transactions for any period (by transaction date)" />
      <div className="space-y-4">
        <div className="card flex flex-wrap items-end gap-3 p-3">
          <label className="flex flex-col gap-1 text-xs text-2">
            From
            <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-2">
            To
            <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 pb-3 text-sm">
            <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
            Include voided / superseded / reversed rows (audit export)
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <div key={m} className="card flex items-center justify-between gap-2 p-3">
              <span className="text-sm font-medium">{MODULES[m].label}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => run(m, "xlsx")}>
                  <Download className="h-4 w-4" /> Excel
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(m, "csv")}>
                  CSV
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Card title="Blank import templates">
          <div className="flex flex-wrap gap-2">
            {IMPORT_TYPES.map((t) => (
              <Button key={t.key} size="sm" variant="secondary" onClick={() => download(`/api/templates/${t.key}`).catch((e) => toast("error", e.message))}>
                {t.label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs muted">Reports with totals and comparisons are under Reports (Excel / CSV / PDF).</p>
        </Card>
      </div>
    </Guard>
  );
}
