"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { FileDown, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { download, qs, useApi } from "@/lib/client";
import { addDays, addMonths, startOfMonth } from "@/lib/dates";
import { formatDate } from "@/lib/dates";
import { formatINR, formatNumber } from "@/lib/money";
import { Button, Card, ErrorState, PageHeader, Spinner, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useCan, useSession } from "@/components/session";

const TYPES = [
  ["daily", "Daily Report"],
  ["weekly", "Weekly Report"],
  ["monthly", "Monthly Report"],
  ["department", "Department Report"],
  ["opd", "OPD Report"],
  ["ipd", "IPD Report"],
  ["lab", "Laboratory Report"],
  ["pharmacy", "Pharmacy Report"],
  ["expense", "Expense Report"],
  ["income-vs-expense", "Income vs Expense Report"],
  ["profitability", "Profitability Report"],
  ["consultation", "Consultation Report"],
  ["historical", "Historical Comparison Report"],
] as const;

function fmt(v: unknown, t?: string) {
  if (v === null || v === undefined || v === "") return t === "pct" ? "—" : "";
  if (t === "money") return formatINR(Number(v), { paise: Number(v) % 1 !== 0 });
  if (t === "int") return formatNumber(Number(v));
  if (t === "pct") return `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
  if (t === "date") return formatDate(String(v));
  return String(v);
}

function ReportsInner() {
  const { today } = useSession();
  const can = useCan();
  const toast = useToast();
  const [type, setType] = useState<string>("monthly");
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  const single = type === "daily" || type === "weekly" || type === "monthly";
  const params = single ? { date } : { from, to };
  const { data, error, loading, reload } = useApi<any>(`/api/reports/${type}${qs(params)}`);
  const dl = (format: string) => download(`/api/reports/${type}${qs({ ...params, format })}`).catch((e) => toast("error", e.message));

  return (
    <>
      <PageHeader title="Reports" subtitle="Preview on screen, then export to Excel, CSV or PDF" />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3 no-print">
        <label className="flex flex-col gap-1 text-xs text-2">
          Report
          <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {single ? (
          <label className="flex flex-col gap-1 text-xs text-2">
            {type === "daily" ? "Date" : type === "weekly" ? "Any date in the week" : "Any date in the month"}
            <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs text-2">
              From
              <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-2">
              To
              <input type="date" className="input !w-auto" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="flex gap-1 pb-0.5">
              <Button size="sm" variant="secondary" onClick={() => { setFrom(addDays(today, -29)); setTo(today); }}>30 days</Button>
              <Button size="sm" variant="secondary" onClick={() => { setFrom(addMonths(startOfMonth(today), -11)); setTo(today); }}>12 months</Button>
            </div>
          </>
        )}
        {can("reports.export") && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => dl("xlsx")}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button size="sm" variant="secondary" onClick={() => dl("csv")}>
              <FileText className="h-4 w-4" /> CSV
            </Button>
            <Button size="sm" onClick={() => dl("pdf")}>
              <FileDown className="h-4 w-4" /> PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.print()} aria-label="Print">
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-4" style={{ opacity: loading ? 0.6 : 1 }}>
          <div>
            <p className="text-xs muted">{data.hospital} · {data.address}</p>
            <h2 className="text-lg font-semibold">{data.title}</h2>
            <p className="text-sm muted">{data.period}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {data.kpis.map((k: any) => (
              <div key={k.label} className="card p-3">
                <p className="text-xs muted">{k.label}</p>
                <p className="text-lg font-semibold tabular-nums">{fmt(k.value, k.type) || "—"}</p>
              </div>
            ))}
          </div>
          {data.tables.map((t: any) => (
            <Card key={t.title} title={t.title} bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      {t.columns.map((c: any) => (
                        <th key={c.key} className={c.type && c.type !== "text" && c.type !== "date" ? "num" : ""}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.length === 0 && (
                      <tr>
                        <td colSpan={t.columns.length} className="muted">
                          No records in this period.
                        </td>
                      </tr>
                    )}
                    {t.rows.map((r: any, i: number) => (
                      <tr key={i}>
                        {t.columns.map((c: any) => (
                          <td key={c.key} className={c.type && c.type !== "text" && c.type !== "date" ? "num" : ""}>
                            {fmt(r[c.key], c.type)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {t.totals && (
                      <tr className="font-semibold" style={{ background: "var(--surface-2)" }}>
                        {t.columns.map((c: any) => (
                          <td key={c.key} className={c.type && c.type !== "text" && c.type !== "date" ? "num" : ""}>
                            {fmt(t.totals[c.key], c.type)}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <Card title="Definitions">
            <ul className="list-disc space-y-1 pl-5 text-xs text-2">
              {data.notes.map((n: string) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Guard perm="reports.view">
      <ReportsInner />
    </Guard>
  );
}
