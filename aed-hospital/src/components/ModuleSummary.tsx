"use client";
import { useSearchParams } from "next/navigation";
import type { ModuleKey } from "@/lib/modules";
import { qs, useApi } from "@/lib/client";
import { startOfMonth } from "@/lib/dates";
import { formatINR, formatNumber } from "@/lib/money";
import { Kpi } from "./Kpi";
import { useSession } from "./session";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** KPI strip above a module's transaction list, for the same date range as the list. */
export function ModuleSummary({ module }: { module: ModuleKey }) {
  const sp = useSearchParams();
  const { today } = useSession();
  const from = sp.get("from") || startOfMonth(today);
  const to = sp.get("to") || today;
  const { data } = useApi<any>(`/api/summary/${module}${qs({ from, to })}`);
  if (!data) return <div className="h-[92px]" />;
  const grid = "grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6";
  if (data.kind === "opd") {
    const t = data.totals;
    return (
      <div className="space-y-3">
        <div className={grid}>
          <Kpi label="Total consultations" value={t.total} format="int" />
          <Kpi label="New" value={t.new} format="int" hint={t.newPct !== null ? `${t.newPct}% new` : undefined} />
          <Kpi label="Old" value={t.old} format="int" />
          <Kpi label="OPD revenue" value={t.revenue} />
          <Kpi label="Avg consultation revenue" value={t.avgRevenue} />
          <Kpi label="New %" value={t.newPct} format="pct" />
        </div>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Specialty</th>
                <th className="num">New</th>
                <th className="num">Old</th>
                <th className="num">Total</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.bySpecialty.map((s: any) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="num">{formatNumber(s.new)}</td>
                  <td className="num">{formatNumber(s.old)}</td>
                  <td className="num">{formatNumber(s.total)}</td>
                  <td className="num">{formatINR(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  if (data.kind === "lab") {
    const t = data.totals;
    const top = [...data.investigations].sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 6);
    return (
      <div className="space-y-3">
        <div className={grid}>
          <Kpi label="Tests" value={t.tests} format="int" />
          <Kpi label="Lab revenue" value={t.revenue} />
          <Kpi label="Avg revenue / test" value={t.avgPerTest} />
          <Kpi label="Avg tests / day" value={t.avgTestsPerDay} format="int" />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {top.map((i: any) => (
            <span key={i.id} className="card px-2 py-1">
              {i.name}: <b>{formatNumber(i.tests)}</b> · {formatINR(i.revenue)}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (data.kind === "ipd") {
    const t = data.totals;
    return (
      <div className={grid}>
        <Kpi label="Admissions" value={t.admissions} format="int" />
        <Kpi label="Billed (net)" value={t.billed} />
        <Kpi label="Collected (income)" value={t.collected} />
        <Kpi label="Avg admission value" value={t.avgAdmissionValue} />
        <Kpi label="Outstanding (all open)" value={t.outstanding} hint={`${t.outstandingCount} admissions with balance due`} />
        {data.byType.map((x: any) => (
          <Kpi key={x.id} label={`${x.name} (collected)`} value={x.collected} hint={`${x.admissions} admissions, billed ${formatINR(x.billed)}`} />
        ))}
      </div>
    );
  }
  if (data.kind === "pharmacy") {
    const t = data.totals;
    return (
      <div className={grid}>
        <Kpi label="Sales (after discount)" value={t.totalSales} />
        <Kpi label="Returns" value={t.returns} goodWhen="down" />
        <Kpi label="Net sales" value={t.netSales} />
        <Kpi label="Purchases" value={t.purchases} />
        <Kpi label="Gross margin" value={t.grossMargin} hint="Net sales − purchases (purchases used as cost proxy)" />
        <Kpi label="Gross margin %" value={t.grossMarginPct} format="pct" />
      </div>
    );
  }
  if (data.kind === "expense") {
    const t = data.totals;
    return (
      <div className="space-y-3">
        <div className={grid}>
          <Kpi label="Hospital expenses" value={t.HOSPITAL} />
          <Kpi label="Other expenses" value={t.OTHER} />
          <Kpi label="Pharmacy purchases" value={t.PHARMACY_PURCHASE} hint="Recorded in Pharmacy, shown for completeness" />
          <Kpi label="Avg daily expense" value={t.avgDaily} />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {data.byCategory.slice(0, 8).map((c: any) => (
            <span key={c.id} className="card px-2 py-1">
              {c.name}: <b>{formatINR(c.amount)}</b>
            </span>
          ))}
        </div>
      </div>
    );
  }
  return null;
}
