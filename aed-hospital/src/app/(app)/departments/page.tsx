"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Department-wise accounts: AED income by department (USG scan room, Cardiac, SCP …) month by month,
 * with the billed items behind each department and the names not yet in any department.
 */
import { Fragment, Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { useApi } from "@/lib/client";
import { endOfMonth, todayISO } from "@/lib/dates";
import { mLabel } from "@/lib/entities";
import { formatINR, formatINRCompact, formatNumber } from "@/lib/money";
import { recentMonths } from "@/lib/periods";
import { STREAM_LABELS } from "@/lib/accounting";
import { Card, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useCan } from "@/components/session";
import { BarsChart, ChartCard, SLOT } from "@/components/charts/Charts";

function GroupRows({ g, months, grand, muted }: { g: any; months: string[]; grand: number; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr style={muted ? { opacity: 0.85 } : undefined}>
        <td className="whitespace-nowrap">
          <button type="button" className="flex items-center gap-1 text-left font-medium hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!g.items.length}>
            {g.items.length ? open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" /> : <span className="inline-block w-4" />}
            {g.name}
          </button>
        </td>
        {months.map((m) => (
          <td key={m} className="num">
            {g.byMonth[m] ? formatINRCompact(g.byMonth[m]) : "—"}
          </td>
        ))}
        <td className="num font-semibold">{g.total ? formatINR(g.total) : "—"}</td>
        <td className="num muted">{grand && g.total ? `${((g.total / grand) * 100).toFixed(1)}%` : ""}</td>
        <td className="num muted">{g.count ? formatNumber(g.count) : ""}</td>
      </tr>
      {open &&
        g.items.map((it: any) => (
          <tr key={`${it.stream}|${it.name}`} className="text-xs">
            <td className="pl-8">
              {it.name} <span className="muted">· {STREAM_LABELS[it.stream as keyof typeof STREAM_LABELS] ?? it.stream}</span>
            </td>
            {months.map((m) => (
              <td key={m} className="num muted">
                {it.byMonth[m] ? formatINRCompact(it.byMonth[m]) : ""}
              </td>
            ))}
            <td className="num">{formatINR(it.total)}</td>
            <td />
            <td className="num muted">{formatNumber(it.count)}</td>
          </tr>
        ))}
    </>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const can = useCan();
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
  const { data, error, loading, reload } = useApi<any>(from <= to ? `/api/departments?from=${from}-01&to=${toDate}` : null);
  const chart = data ? data.departments.filter((d: any) => d.total).map((d: any) => ({ name: d.name, total: d.total })) : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {(["from", "to"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-2">
            {k === "from" ? "From" : "To"}
            <select className="input !w-auto" value={k === "from" ? from : to} onChange={(e) => set(k, e.target.value)}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {data && (
          <p className="text-sm muted">
            AED income {formatINRCompact(data.grandTotal)} · in departments {formatINRCompact(data.departmentsTotal)} ({data.grandTotal ? ((data.departmentsTotal / data.grandTotal) * 100).toFixed(0) : 0}%)
          </p>
        )}
      </div>
      {from > to && <p className="text-sm">Choose a “From” month before the “To” month.</p>}
      <ErrorState error={error} onRetry={reload} />
      {!data && !error && from <= to && <Spinner />}
      {data && (
        <div className="space-y-4" style={{ opacity: loading ? 0.6 : 1 }}>
          <Card title="Income by department, month by month — tap a department to see its billed items">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Department</th>
                    {data.months.map((m: string) => (
                      <th key={m} className="num whitespace-nowrap">
                        {mLabel(m)}
                      </th>
                    ))}
                    <th className="num">Total</th>
                    <th className="num">Share</th>
                    <th className="num">Bills / tests</th>
                  </tr>
                </thead>
                <tbody>
                  {data.departments.map((g: any) => (
                    <GroupRows key={g.id} g={g} months={data.months} grand={data.grandTotal} />
                  ))}
                  {data.unassigned.length > 0 && (
                    <tr>
                      <td colSpan={data.months.length + 4} className="pt-4 text-xs font-semibold uppercase tracking-wide text-2">
                        Not in any department — consultations, other lab tests, IPD, other income
                      </td>
                    </tr>
                  )}
                  {data.unassigned.map((g: any) => (
                    <Fragment key={g.id}>
                      <GroupRows g={g} months={data.months} grand={data.grandTotal} muted />
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td>AED income (all)</td>
                    {data.months.map((m: string) => (
                      <td key={m} className="num">
                        {formatINRCompact(data.totals[m] ?? 0)}
                      </td>
                    ))}
                    <td className="num">{formatINR(data.grandTotal)}</td>
                    <td className="num">100%</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
          {chart.length > 0 && (
            <ChartCard title="Department income for the period" height={Math.max(220, chart.length * 34)} table={{ columns: [{ key: "name", label: "Department", format: "text" }, { key: "total", label: "Income", format: "money" }], rows: chart }}>
              <BarsChart data={chart} xKey="name" horizontal series={[{ key: "total", label: "Income", color: SLOT(0) }]} />
            </ChartCard>
          )}
          <p className="flex gap-2 text-xs muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              A bill belongs to a department by the name it was billed under in OneGlance (consultation type, lab test, diet service or IPD admission type). Income only; Hormonal Pharmacy is
              separate. {can("masters.manage") && (
                <>
                  To move a billed name into a department, add a word from it under{" "}
                  <Link className="underline" href="/masters?type=serviceDepartments">
                    Master Data → Income departments
                  </Link>
                  .
                </>
              )}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Guard perm="analytics.view">
      <PageHeader title="Department accounts" subtitle="AED income by department — USG, foot & physio, cardiac, JJ Wellness, ophthalmology, diet, SCP, short admissions, MMP — month by month" />
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
