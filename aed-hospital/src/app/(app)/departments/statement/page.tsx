"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A department's account laid out for paper: income lines, cost lines, profit and the partner's share,
 * month by month. ?dept=<id> (or none for every department, one per page), ?from=YYYY-MM&to=YYYY-MM,
 * ?print=1 opens the print dialog. Always printed on white paper, whatever the screen theme.
 */
import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { download, useApi } from "@/lib/client";
import { endOfMonth, formatDateTime, todayISO } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { ErrorState, Spinner, useToast } from "@/components/ui";
import { colLabel } from "@/components/departments/insights";

/** One row per cost: a cost entered as several month ranges (e.g. a salary that changed) is shown once. */
function byLabel(lines: { label: string; byMonth: Record<string, number>; total: number }[]) {
  const out = new Map<string, { label: string; byMonth: Record<string, number>; total: number }>();
  for (const l of lines) {
    const e = out.get(l.label) ?? { label: l.label, byMonth: {}, total: 0 };
    for (const [m, v] of Object.entries(l.byMonth)) e.byMonth[m] = (e.byMonth[m] ?? 0) + v;
    e.total += l.total;
    out.set(l.label, e);
  }
  return [...out.values()].filter((l) => l.total);
}

const amt = (v: number | undefined) => (v ? formatINR(Math.round(v)) : "—");

function Lines({ title, rows, months }: { title: string; rows: { label: string; byMonth: Record<string, number>; total: number }[]; months: string[] }) {
  return (
    <>
      <tr className="dst-group">
        <td colSpan={months.length + 2}>{title}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.label}>
          <td className="dst-label">{r.label}</td>
          {months.map((m) => (
            <td key={m}>{amt(r.byMonth[m])}</td>
          ))}
          <td className="dst-total">{amt(r.total)}</td>
        </tr>
      ))}
    </>
  );
}

function Total({ label, byMonth, total, months, strong }: { label: string; byMonth: Record<string, number>; total: number; months: string[]; strong?: boolean }) {
  return (
    <tr className={strong ? "dst-strong" : "dst-sum"}>
      <td className="dst-label">{label}</td>
      {months.map((m) => (
        <td key={m} className={(byMonth[m] ?? 0) < 0 ? "dst-neg" : ""}>
          {amt(byMonth[m])}
        </td>
      ))}
      <td className={`dst-total ${total < 0 ? "dst-neg" : ""}`}>{amt(total)}</td>
    </tr>
  );
}

function Statement({ st, data }: { st: any; data: any }) {
  const months: string[] = data.months;
  const partner = data.partners.find((p: any) => p.departments.includes(st.name));
  const aed: Record<string, number> = {};
  if (partner) for (const m of months) aed[m] = (st.profit[m] ?? 0) - (partner.share[m] ?? 0);
  return (
    <section className="dst-sheet">
      <header className="dst-head">
        <div>
          <div className="dst-org">AED Hospital</div>
          <h1>{st.name} — department account</h1>
          <div className="dst-period">
            {colLabel(months[0])} to {colLabel(months[months.length - 1])}
          </div>
        </div>
        <div className="dst-kpis">
          <div>
            <span>Income</span>
            <b>{formatINR(Math.round(st.totals.income))}</b>
          </div>
          <div>
            <span>Costs</span>
            <b>{formatINR(Math.round(st.totals.costs))}</b>
          </div>
          <div>
            <span>Profit</span>
            <b className={st.totals.profit < 0 ? "dst-neg" : ""}>{formatINR(Math.round(st.totals.profit))}</b>
          </div>
          <div>
            <span>Margin</span>
            <b>{st.marginPct == null ? "—" : `${st.marginPct}%`}</b>
          </div>
        </div>
      </header>
      <table className="dst-table">
        <thead>
          <tr>
            <th />
            {months.map((m) => (
              <th key={m}>{colLabel(m)}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <Lines title="Income" rows={st.incomeLines.map((l: any) => ({ label: l.name, byMonth: l.byMonth, total: l.total }))} months={months} />
          <Total label="Total income" byMonth={st.income} total={st.totals.income} months={months} />
          <Lines title="Costs" rows={byLabel(st.costLines)} months={months} />
          <Total label="Total costs" byMonth={st.costs} total={st.totals.costs} months={months} />
          <Total label="Profit" byMonth={st.profit} total={st.totals.profit} months={months} strong />
          {partner && (
            <>
              <Total label={`${partner.name} share (${partner.pct}% of profit, profit months only)`} byMonth={partner.share} total={partner.totals.share} months={months} />
              <Total label="AED keeps" byMonth={aed} total={partner.totals.aed} months={months} strong />
            </>
          )}
        </tbody>
      </table>
      {!st.costsEntered && <p className="dst-warn">No costs entered for this department yet: its profit is its income.</p>}
      <footer className="dst-foot">
        For department performance only — figures come from the core accounts and do not change them. Printed {formatDateTime(new Date().toISOString())}.
      </footer>
    </section>
  );
}

function Inner() {
  const sp = useSearchParams();
  const toast = useToast();
  const dept = sp.get("dept");
  const today = todayISO();
  const from = sp.get("from") || `${today.slice(0, 4)}-01`;
  const to = sp.get("to") || today.slice(0, 7);
  const toDate = to >= today.slice(0, 7) ? today : endOfMonth(`${to}-01`);
  const { data, error, reload } = useApi<any>(`/api/departments?from=${from}-01&to=${toDate}`);
  const printed = useRef(false);
  useEffect(() => {
    if (sp.get("print") === "1" && data && !printed.current) {
      printed.current = true;
      const h = setTimeout(() => window.print(), 600);
      return () => clearTimeout(h);
    }
  }, [sp, data]);
  const list = data ? (dept ? data.statements.filter((s: any) => s.id === dept) : data.statements) : [];
  const title = dept ? list[0]?.name : "All departments";
  return (
    <div className="dst-root">
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/departments?from=${from}&to=${to}${dept ? `&dept=${dept}` : ""}`} className="text-sm muted inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Department accounts
          </Link>
          <h1 className="text-xl font-semibold">{title ?? "Department account"} — print or download</h1>
          <p className="text-sm muted">{dept ? "One page" : "One page per department"}, A4 landscape — in the print window choose “Save as PDF”.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-secondary"
            disabled={!data}
            onClick={async () => {
              try {
                await download(`/api/departments/statement?${new URLSearchParams({ ...(dept ? { departmentId: dept } : {}), from: `${from}-01`, to: toDate }).toString()}`);
              } catch (e: any) {
                toast("error", e.message);
              }
            }}
          >
            <Download className="h-4 w-4" /> Download Excel
          </button>
          <button className="btn btn-primary" onClick={() => window.print()} disabled={!data}>
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </button>
        </div>
      </div>
      <ErrorState error={error} onRetry={reload} />
      {!data && !error && <Spinner />}
      {data && !list.length && <p className="muted">Department not found.</p>}
      {list.map((st: any) => (
        <Statement key={st.id} st={st} data={data} />
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner />
    </Suspense>
  );
}
