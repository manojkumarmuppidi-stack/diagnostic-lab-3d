"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Hormonal Pharmacy — its own accounts, apart from the hospital: monthly Sale − Purchase profit
 * and profit %, the margin on medicines actually sold, and a day-by-day running month-to-date view.
 */
import { FreshnessBanner } from "@/components/FreshnessBanner";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useApi } from "@/lib/client";
import { compare } from "@/lib/accounting";
import { addMonths, formatDayMonth, todayISO } from "@/lib/dates";
import { monthLabel } from "@/lib/expenses";
import { formatINR, formatINRCompact } from "@/lib/money";
import { Card, ErrorState, PageHeader, Spinner, Tabs } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { Kpi } from "@/components/Kpi";
import { BarsChart, ChartCard, SLOT } from "@/components/charts/Charts";

type Tab = "months" | "days";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);
const tone = (v: number | null | undefined) => (typeof v === "number" && v < 0 ? { color: "var(--bad)" } : undefined);

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const thisMonth = todayISO().slice(0, 7);
  const month = sp.get("month") || thisMonth;
  const tab = (sp.get("tab") as Tab) || "months";
  const go = (p: Record<string, string>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(p)) n.set(k, v);
    router.replace(`${path}?${n.toString()}`);
  };
  const { data, error, loading, reload } = useApi<any>(`/api/hormonal-pharmacy?month=${month}`);
  const d = data?.month === month ? data : null;
  const shift = (n: number) => go({ month: addMonths(`${month}-01`, n).slice(0, 7) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-secondary" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input type="month" className="input !w-auto" value={month} max={thisMonth} onChange={(e) => e.target.value && go({ month: e.target.value })} aria-label="Month" />
        <button className="btn btn-secondary" onClick={() => shift(1)} disabled={month >= thisMonth} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </button>
        {d?.partial && <span className="text-xs muted">Month to date · 1–{Number(d.range.to.slice(8))} {monthLabel(month)}</span>}
      </div>
      <ErrorState error={error} onRetry={reload} />
      {!d && !error && <Spinner />}
      {d && <Body d={d} tab={tab} setTab={(t) => go({ tab: t })} loading={loading} />}
    </div>
  );
}

function Body({ d, tab, setTab, loading }: { d: any; tab: Tab; setTab: (t: Tab) => void; loading: boolean }) {
  const c = d.current;
  const base = d.previousSameDays ?? d.previous;
  const vs = d.previousSameDays ? `same days of ${monthLabel(d.previous.key)}` : monthLabel(d.previous.key);
  return (
    <div className="space-y-4" style={{ opacity: loading ? 0.6 : 1 }}>
      <section>
        <h2 className="mb-2 text-sm font-semibold">
          {monthLabel(d.month)} · Sale − Purchase <span className="font-normal muted">(vs {vs})</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Net sales" value={c.netSales} change={compare(c.netSales, base.netSales)} hint="Sales after discount, less returns" href={`/pharmacy?tab=sales&from=${d.range.from}&to=${d.range.to}`} emphasis />
          <Kpi label="Purchases" value={c.purchases} change={compare(c.purchases, base.purchases)} goodWhen="down" hint="Supplier invoices dated in the month" href={`/pharmacy?tab=purchases&from=${d.range.from}&to=${d.range.to}`} emphasis />
          <Kpi label="Profit (Sale − Purchase)" value={c.profit} change={compare(c.profit, base.profit)} emphasis />
          <Kpi
            label={`Profit % · was ${pct(base.profitPct)}${c.profitPct !== null && base.profitPct !== null ? ` (${c.profitPct - base.profitPct >= 0 ? "+" : ""}${(c.profitPct - base.profitPct).toFixed(1)} pts)` : ""}`}
            value={c.profitPct}
            format="pct"
            hint="Profit ÷ net sales; change shown in percentage points"
            emphasis
          />
        </div>
        {c.soldMargin !== null && (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Margin on medicines sold" value={c.soldMargin} change={base.soldMargin !== null ? compare(c.soldMargin, base.soldMargin) : undefined} hint="Sale value − purchase cost of the medicines sold, both ex-GST" />
            <Kpi label="Margin % on sold" value={c.soldMarginPct} format="pct" hint="Margin ÷ taxable sale value" />
            {c.bills !== null && <Kpi label="Bills" value={c.bills} format="int" change={base.bills !== null ? compare(c.bills, base.bills) : undefined} />}
            {c.bills ? <Kpi label="Average bill" value={c.netSales / c.bills} /> : null}
          </div>
        )}
        <div className="mt-3">
          <FreshnessBanner to={d.range.to} />
        </div>
        {d.notes.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {d.notes.map((n: string) => (
              <li key={n} className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--status-warning)" }} />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "months", label: "Month by month" },
          { key: "days", label: "Day by day" },
        ]}
      />
      {tab === "months" ? <Months d={d} /> : <Days d={d} />}

      <p className="text-xs muted">
        Hormonal Pharmacy is kept apart from the hospital accounts: its sales are not hospital income and its purchases are not hospital expenses on the Dashboard&apos;s
        segment view. Profit here is AED&apos;s monthly measure, Sale − Purchase. It swings when stock is built up or sold down; &ldquo;Margin on medicines sold&rdquo; does not.{" "}
        <Link href="/analytics?tab=pharmacy" className="underline">
          Medicine-wise analytics
        </Link>
      </p>
    </div>
  );
}

function Months({ d }: { d: any }) {
  const rows = d.months.map((m: any) => ({ ...m, label: monthLabel(m.key) }));
  return (
    <div className="space-y-4">
      <ChartCard
        title="Sales vs purchases by month"
        height={240}
        table={{
          columns: [
            { key: "label", label: "Month", format: "text" },
            { key: "netSales", label: "Net sales", format: "money" },
            { key: "purchases", label: "Purchases", format: "money" },
            { key: "profit", label: "Profit", format: "money" },
          ],
          rows,
        }}
      >
        <BarsChart
          data={rows}
          xKey="label"
          series={[
            { key: "netSales", label: "Net sales", color: SLOT(0) },
            { key: "purchases", label: "Purchases", color: SLOT(1) },
          ]}
        />
      </ChartCard>
      <Card title="Profit and profit % — month by month">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Net sales</th>
                <th className="num">Purchases</th>
                <th className="num">Profit</th>
                <th className="num">Profit %</th>
                <th className="num">Margin on sold</th>
                <th className="num">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((m: any) => (
                <tr key={m.key} style={m.key === d.month ? { fontWeight: 600 } : undefined}>
                  <td className="whitespace-nowrap">
                    {m.label}
                    {m.key === d.month && d.partial ? " (to date)" : ""}
                  </td>
                  <td className="num">{m.netSales ? formatINRCompact(m.netSales) : "—"}</td>
                  <td className="num">{m.purchases ? formatINRCompact(m.purchases) : "—"}</td>
                  <td className="num" style={tone(m.profit)}>
                    {m.netSales || m.purchases ? formatINRCompact(m.profit) : "—"}
                  </td>
                  <td className="num" style={tone(m.profitPct)}>
                    {pct(m.profitPct)}
                  </td>
                  <td className="num">{m.soldMargin === null ? "—" : formatINRCompact(m.soldMargin)}</td>
                  <td className="num">{pct(m.soldMarginPct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>12 months</td>
                <td className="num">{formatINRCompact(d.yearTotal.netSales)}</td>
                <td className="num">{formatINRCompact(d.yearTotal.purchases)}</td>
                <td className="num" style={tone(d.yearTotal.profit)}>
                  {formatINRCompact(d.yearTotal.profit)}
                </td>
                <td className="num">{pct(d.yearTotal.profitPct)}</td>
                <td className="num">{d.yearTotal.soldMargin === null ? "—" : formatINRCompact(d.yearTotal.soldMargin)}</td>
                <td className="num">{pct(d.yearTotal.soldMarginPct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Days({ d }: { d: any }) {
  const rows = [...d.days].reverse();
  return (
    <Card title={`${monthLabel(d.month)} — day by day, with the month so far`}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Day</th>
              <th className="num">Net sales</th>
              <th className="num">Purchases</th>
              <th className="num">Sale − Purchase</th>
              <th className="num">Month so far</th>
              <th className="num">Profit % so far</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x: any) => (
              <tr key={x.key}>
                <td className="whitespace-nowrap">{formatDayMonth(x.key)}</td>
                <td className="num">{x.netSales ? formatINR(x.netSales) : "—"}</td>
                <td className="num">{x.purchases ? formatINR(x.purchases) : "—"}</td>
                <td className="num" style={tone(x.profit)}>
                  {x.netSales || x.purchases ? formatINR(x.profit) : "—"}
                </td>
                <td className="num" style={tone(x.cumProfit)}>
                  {formatINRCompact(x.cumProfit)}
                </td>
                <td className="num" style={tone(x.cumProfitPct)}>
                  {pct(x.cumProfitPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs muted">A day&apos;s Sale − Purchase is lumpy: supplier invoices land on the day they are billed. Read the running month-so-far column.</p>
    </Card>
  );
}

export default function Page() {
  return (
    <Guard perm="pharmacy.view">
      <PageHeader title="Hormonal Pharmacy — accounts" subtitle="A separate segment: monthly Sale − Purchase profit and profit %, checkable day by day" />
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
