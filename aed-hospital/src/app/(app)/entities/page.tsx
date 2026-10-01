"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AED Hospital and Hormonal Pharmacy as two separate entities: income, expenses, profit/loss and
 * margin for each, month by month, with plain-language insights.
 */
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, TrendingDown } from "lucide-react";
import { useApi } from "@/lib/client";
import { endOfMonth, todayISO } from "@/lib/dates";
import { ENTITY_LABELS, ENTITY_SCOPE, mLabel, type EntityKey } from "@/lib/entities";
import { formatINR, formatINRCompact } from "@/lib/money";
import { recentMonths } from "@/lib/periods";
import { Card, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { Kpi } from "@/components/Kpi";
import { FreshnessBanner } from "@/components/FreshnessBanner";
import { BarsChart, ChartCard, SLOT } from "@/components/charts/Charts";

const TONE = {
  good: { icon: CheckCircle2, color: "var(--good)" },
  bad: { icon: TrendingDown, color: "var(--bad)" },
  warn: { icon: AlertTriangle, color: "var(--status-warning)" },
  info: { icon: Info, color: "var(--series-1)" },
} as const;

function Entity({ k, e }: { k: EntityKey; e: any }) {
  const excluded = e.months.filter((m: any) => m.incomeMissing).length;
  const t = excluded ? e.completeTotals : e.totals;
  const rows = e.months.map((m: any) => ({ ...m, label: mLabel(m.month) }));
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{ENTITY_LABELS[k]}</h2>
        <p className="text-xs muted">{ENTITY_SCOPE[k]}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Income" value={t.income} emphasis />
        <Kpi label="Expenses" value={t.expenses} emphasis />
        <Kpi label={t.profit >= 0 ? "Profit" : "Loss"} value={t.profit} emphasis />
        <Kpi label="Margin" value={t.marginPct} format="pct" emphasis />
      </div>
      {excluded > 0 && (
        <p className="text-xs muted">
          Figures above cover months with income recorded. Including the {excluded} month{excluded === 1 ? "" : "s"} without income, expenses are {formatINRCompact(e.totals.expenses)}.
        </p>
      )}
      <Card title="What the numbers say">
        <ul className="space-y-2 text-sm">
          {e.insights.map((i: any, n: number) => {
            const T = TONE[i.tone as keyof typeof TONE];
            return (
              <li key={n} className="flex gap-2">
                <T.icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: T.color }} />
                <span>{i.text}</span>
              </li>
            );
          })}
        </ul>
      </Card>
      <ChartCard
        title="Income vs expenses by month"
        height={220}
        table={{
          columns: [
            { key: "label", label: "Month", format: "text" },
            { key: "income", label: "Income", format: "money" },
            { key: "expenses", label: "Expenses", format: "money" },
            { key: "profit", label: "Profit / loss", format: "money" },
          ],
          rows,
        }}
      >
        <BarsChart
          data={rows}
          xKey="label"
          series={[
            { key: "income", label: "Income", color: SLOT(0) },
            { key: "expenses", label: "Expenses", color: SLOT(1) },
          ]}
        />
      </ChartCard>
      <Card title="Month by month">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Income</th>
                <th className="num">Expenses</th>
                <th className="num">Profit / loss</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m: any) => (
                <tr key={m.month} style={m.incomeMissing ? { opacity: 0.6 } : undefined}>
                  <td className="whitespace-nowrap">
                    {m.label}
                    {m.incomeMissing && <div className="text-xs" style={{ color: "var(--status-warning)" }}>income not recorded</div>}
                  </td>
                  <td className="num">{m.income ? formatINRCompact(m.income) : "—"}</td>
                  <td className="num">{m.expenses ? formatINRCompact(m.expenses) : "—"}</td>
                  <td className="num" style={!m.incomeMissing && m.profit < 0 ? { color: "var(--bad)" } : undefined}>
                    {m.incomeMissing || (!m.income && !m.expenses) ? "—" : formatINRCompact(m.profit)}
                  </td>
                  <td className="num">{m.marginPct === null || m.incomeMissing ? "—" : `${m.marginPct.toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {e.costs.length > 0 && (
        <Card title="Where the money goes">
          <table className="table">
            <tbody>
              {e.costs.slice(0, 8).map((c: any) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="num">{formatINR(c.amount)}</td>
                  <td className="num muted">{e.totals.expenses ? `${Math.round((c.amount / e.totals.expenses) * 100)}%` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const today = todayISO();
  const months = recentMonths(today, 24);
  const from = sp.get("from") || `${today.slice(0, 4)}-01`;
  const to = sp.get("to") || today.slice(0, 7);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    n.set(k, v);
    router.replace(`${path}?${n.toString()}`);
  };
  const toDate = endOfMonth(`${to}-01`) < today ? endOfMonth(`${to}-01`) : today;
  const { data, error, loading, reload } = useApi<any>(`/api/entities?from=${from}-01&to=${toDate}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-2">
          From
          <select className="input !w-auto" value={from} onChange={(e) => set("from", e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-2">
          To
          <select className="input !w-auto" value={to} onChange={(e) => set("to", e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <p className="text-sm muted">
            Both together: income {formatINRCompact(data.combined.income)} · expenses {formatINRCompact(data.combined.expenses)} ·{" "}
            <b style={{ color: data.combined.profit < 0 ? "var(--bad)" : undefined }}>
              {data.combined.profit < 0 ? "loss" : "profit"} {formatINRCompact(Math.abs(data.combined.profit))}
            </b>
          </p>
        )}
      </div>
      <FreshnessBanner to={toDate} />
      <ErrorState error={error} onRetry={reload} />
      {!data && !error && <Spinner />}
      {data && from <= to && (
        <div className="grid gap-6 xl:grid-cols-2" style={{ opacity: loading ? 0.6 : 1 }}>
          <Entity k="AED" e={data.entities.AED} />
          <Entity k="HP" e={data.entities.HP} />
        </div>
      )}
      {from > to && <p className="text-sm">Choose a “From” month before the “To” month.</p>}
    </div>
  );
}

export default function Page() {
  return (
    <Guard perm="dashboard.view">
      <PageHeader title="AED Hospital vs Hormonal Pharmacy" subtitle="Two separate entities — income, expenses and profit/loss for each, with insights" />
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
