"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Department-wise accounts: is each department (USG scan room, Cardiac, JJ Wellness …) making money?
 * Profit = billed income + margin on its pharmacy medicines − its own expenses − staff incentive, with the
 * partner's share (JJ Wellness 20%); then income month by month with the billed items behind it.
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
import { Badge, Card, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useCan } from "@/components/session";
import { BarsChart, ChartCard, SLOT } from "@/components/charts/Charts";

const money = (v: number | undefined) => (v ? formatINR(v) : "—");
const signed = (v: number) => <span style={{ color: v < 0 ? "var(--status-bad)" : undefined }}>{formatINR(v)}</span>;

function Verdict({ p }: { p: any }) {
  if (!p.costsMapped && !p.totals.pharmacySales) return <Badge tone="neutral">No costs linked</Badge>;
  if (p.totals.profit > 0) return <Badge tone="green">Profit</Badge>;
  if (p.totals.profit < 0) return <Badge tone="red">Loss</Badge>;
  return <Badge tone="neutral">Break-even</Badge>;
}

function ProfitRows({ p, months }: { p: any; months: string[] }) {
  const [open, setOpen] = useState(false);
  const line = (label: string, byMonth: Record<string, number>, total: number, minus = false) => (
    <tr className="text-xs">
      <td className="pl-8">{label}</td>
      <td colSpan={5} className="muted">
        {months
          .filter((m) => byMonth[m])
          .map((m) => `${mLabel(m)} ${minus ? "−" : ""}${formatINRCompact(byMonth[m])}`)
          .join(" · ")}
      </td>
      <td className="num">{minus ? `−${formatINR(total)}` : formatINR(total)}</td>
      <td colSpan={2} />
    </tr>
  );
  return (
    <>
      <tr>
        <td className="whitespace-nowrap">
          <button type="button" className="flex items-center gap-1 text-left font-medium hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            {p.name}
          </button>
        </td>
        <td className="num">{money(p.totals.income)}</td>
        <td className="num">{money(p.totals.pharmacyMargin)}</td>
        <td className="num">{p.totals.expenses ? `−${formatINR(p.totals.expenses)}` : "—"}</td>
        <td className="num">{p.totals.incentive ? `−${formatINR(p.totals.incentive)}` : "—"}</td>
        <td className="num muted">{p.totals.pharmacySales ? formatINRCompact(p.totals.pharmacySales) : ""}</td>
        <td className="num font-semibold">{signed(p.totals.profit)}</td>
        <td className="num muted">{p.marginPct === null ? "" : `${p.marginPct.toFixed(0)}%`}</td>
        <td>
          <Verdict p={p} />
        </td>
      </tr>
      {open && (
        <>
          {line("Profit by month", p.profit, p.totals.profit)}
          {line("Billed income", p.income, p.totals.income)}
          {p.medicines.length > 0 && line(`Pharmacy margin (sales ${formatINRCompact(p.totals.pharmacySales)}, without GST, after cost)`, p.pharmacyMargin, p.totals.pharmacyMargin)}
          {p.medicines.slice(0, 12).map((m: any) => (
            <tr key={m.name} className="text-xs">
              <td className="pl-12 muted">{m.name}</td>
              <td colSpan={5} className="muted">sales {formatINR(m.sales)}</td>
              <td className="num muted">{formatINR(m.margin)}</td>
              <td colSpan={2} />
            </tr>
          ))}
          {p.totals.incentive > 0 && line(`Staff incentive ${p.incentivePct}% of injection sales`, p.incentive, p.totals.incentive, true)}
          {p.expenseItems.map((e: any) => (
            <Fragment key={e.name}>{line(e.name, e.byMonth, e.total, true)}</Fragment>
          ))}
          {p.missingCost > 0 && (
            <tr className="text-xs">
              <td colSpan={9} className="pl-8 muted">
                {p.missingCost} medicine lines have no purchase cost, so their margin is counted as ₹0.
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

function ProfitCard({ data }: { data: any }) {
  const [sharedOpen, setSharedOpen] = useState(false);
  return (
    <Card title="Is each department making money? — profit for the period (tap a department for months and costs)">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Department</th>
              <th className="num">Billed income</th>
              <th className="num">+ Injection margin</th>
              <th className="num">− Own expenses</th>
              <th className="num">− Incentive</th>
              <th className="num">Injection sales</th>
              <th className="num">Profit</th>
              <th className="num">Margin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.profit.map((p: any) => (
              <ProfitRows key={p.id} p={p} months={data.months} />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <button type="button" className="flex items-center gap-1 text-left hover:underline" onClick={() => setSharedOpen((o) => !o)} aria-expanded={sharedOpen}>
                  {sharedOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  Shared costs, not charged to any department
                </button>
              </td>
              <td colSpan={2} />
              <td className="num">{data.sharedExpenses.total ? `−${formatINR(data.sharedExpenses.total)}` : "—"}</td>
              <td colSpan={5} className="text-xs muted">
                salaries of common staff, rent, power … (by expense department)
              </td>
            </tr>
            {sharedOpen &&
              data.sharedExpenses.items.map((e: any) => (
                <tr key={e.name} className="text-xs">
                  <td className="pl-8">{e.name}</td>
                  <td colSpan={2} />
                  <td className="num">−{formatINR(e.total)}</td>
                  <td colSpan={5} />
                </tr>
              ))}
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function PartnerCard({ partner, months }: { partner: any; months: string[] }) {
  return (
    <Card title={`${partner.name} — ${partner.pct}% share of profit (${partner.departments.join(" + ")})`}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th />
              {months.map((m) => (
                <th key={m} className="num whitespace-nowrap">
                  {mLabel(m)}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Profit after {partner.name} expenses & incentive</td>
              {months.map((m) => (
                <td key={m} className="num">
                  {signed(partner.profit[m] ?? 0)}
                </td>
              ))}
              <td className="num font-semibold">{signed(partner.totals.profit)}</td>
            </tr>
            <tr>
              <td>
                {partner.name} share ({partner.pct}%)
              </td>
              {months.map((m) => (
                <td key={m} className="num">
                  {money(partner.share[m])}
                </td>
              ))}
              <td className="num font-semibold">{formatINR(partner.totals.share)}</td>
            </tr>
            <tr>
              <td>AED keeps</td>
              {months.map((m) => (
                <td key={m} className="num">
                  {signed(round((partner.profit[m] ?? 0) - (partner.share[m] ?? 0)))}
                </td>
              ))}
              <td className="num font-semibold">{signed(partner.totals.aed)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs muted">The share is worked out month by month and only on a month in profit; a loss month gives {partner.name} nothing and is not carried forward.</p>
    </Card>
  );
}
const round = (v: number) => Math.round(v * 100) / 100;

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
          <ProfitCard data={data} />
          {data.partners.map((p: any) => (
            <PartnerCard key={p.name} partner={p} months={data.months} />
          ))}
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
              A bill belongs to a department by the name it was billed under in OneGlance (consultation type, lab test, diet service or IPD admission type). A department&apos;s own
              expenses are those booked to its expense department (e.g. JJ Wellness → &quot;Wellness&quot;); everything else is a shared cost. Injection margin comes from the
              Hormonal Pharmacy&apos;s medicine-wise sales (OneGlance Purchase/Sales report), without GST. Profit here is before shared costs.{" "}
              {can("masters.manage") && (
                <>
                  To move a billed name, an expense department or a medicine into a department, edit it under{" "}
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
      <PageHeader title="Department accounts" subtitle="Income, own costs and profit of each department — USG, foot & physio, cardiac, JJ Wellness, ophthalmology, diet, SCP, short admissions, MMP" />
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
