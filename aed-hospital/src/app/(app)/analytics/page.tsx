"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FreshnessBanner } from "@/components/FreshnessBanner";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { qs, useApi } from "@/lib/client";
import { STREAM_LABELS, EXPENSE_LABELS, compare, AED_INCOME_STREAMS } from "@/lib/accounting";
import { addDays, addMonths, formatDayMonth, formatMonth } from "@/lib/dates";
import { formatINR, formatNumber } from "@/lib/money";
import type { Granularity } from "@/lib/periods";
import { STREAM_HREF, withRange } from "@/lib/drill";
import { Card, ErrorState, PageHeader, Spinner, Tabs } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { Kpi } from "@/components/Kpi";
import { PeriodPicker, periodQuery, type PeriodValue } from "@/components/PeriodPicker";
import { BarsChart, ChartCard, DonutChart, SLOT, STREAM_COLORS, TrendChart } from "@/components/charts/Charts";
import { masterOptions, useMasters } from "@/components/session";
import { ModuleInsights } from "@/components/insights/ModuleInsights";

type Tab = "revenue" | "opd" | "ipd" | "lab" | "pharmacy" | "expense" | "profitability";
const TABS: { key: Tab; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "opd", label: "OPD" },
  { key: "ipd", label: "IPD" },
  { key: "lab", label: "Laboratory" },
  { key: "pharmacy", label: "Hormonal Pharmacy" },
  { key: "expense", label: "Expenses" },
  { key: "profitability", label: "Profitability" },
];

/** Date range covered by a chart bucket, for drill-down links. */
function bucketRange(bucket: string, g: Granularity): [string, string] {
  if (g === "month") return [bucket, addDays(addMonths(bucket, 1), -1)];
  if (g === "week") return [bucket, addDays(bucket, 6)];
  return [bucket, bucket];
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = (sp.get("tab") as Tab) || "revenue";
  const [period, setPeriod] = useState<PeriodValue>({ preset: "this_month" });
  const [granularity, setGranularity] = useState<"" | Granularity>("");
  // Deep links from global search: ?tab=pharmacy&medicine=… / ?tab=lab&investigationId=…
  const [filters, setFilters] = useState<{ doctorId?: string; specialtyId?: string; departmentId?: string; investigationId?: string; medicine?: string }>(() => ({
    medicine: sp.get("medicine") || undefined,
    investigationId: sp.get("investigationId") || undefined,
  }));
  const { masters } = useMasters();
  const url = period.preset === "custom" && (!period.from || !period.to) ? null : `/api/analytics/${tab}${qs({ ...periodQuery(period), granularity, ...filters, investigationId: tab === "lab" ? filters.investigationId : undefined, medicine: tab === "pharmacy" ? filters.medicine : undefined })}`;
  const { data: raw, error, loading, reload } = useApi<{ kind: string; period: any; granularity: Granularity; data: any }>(url);
  // useApi keeps the last response while the next loads; never render one tab with another tab's data.
  const data = raw && raw.kind === tab ? raw : null;
  const g = data?.granularity ?? "day";
  const from = data?.period.current.from;
  const to = data?.period.current.to;
  const drill = (href: string, bucket?: string) => {
    const [f, t] = bucket ? bucketRange(bucket, g) : [from, to];
    router.push(withRange(href, f, t));
  };

  return (
    <>
      <PageHeader title="Analytics" subtitle={data ? `${data.period.current.label}` : undefined} />
      <div className="space-y-4">
        <Tabs<Tab> tabs={TABS} value={tab} onChange={(t) => router.replace(`${path}?tab=${t}`)} />
        {data && <FreshnessBanner to={data.period.current.to} />}
        <div className="card flex flex-wrap items-end gap-3 p-3">
          <PeriodPicker value={period} onChange={setPeriod} showCompare={false} />
          <label className="flex flex-col gap-1 text-xs text-2">
            Group by
            <select className="input !w-auto" value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)}>
              <option value="">Auto</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          {["revenue", "opd", "ipd", "lab"].includes(tab) && (
            <label className="flex flex-col gap-1 text-xs text-2">
              Doctor
              <select className="input !w-auto" value={filters.doctorId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, doctorId: e.target.value || undefined }))}>
                <option value="">All doctors</option>
                {masterOptions(masters, "doctors", { includeId: filters.doctorId }).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {["revenue", "opd"].includes(tab) && (
            <label className="flex flex-col gap-1 text-xs text-2">
              Specialty
              <select className="input !w-auto" value={filters.specialtyId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, specialtyId: e.target.value || undefined }))}>
                <option value="">All specialties</option>
                {masterOptions(masters, "specialties", { includeId: filters.specialtyId }).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {["revenue", "lab", "expense"].includes(tab) && (
            <label className="flex flex-col gap-1 text-xs text-2">
              Department
              <select className="input !w-auto" value={filters.departmentId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, departmentId: e.target.value || undefined }))}>
                <option value="">All departments</option>
                {masterOptions(masters, "departments", { includeId: filters.departmentId }).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <ErrorState error={error} onRetry={reload} />
        {!data && !error && <Spinner />}
        {data && (
          <div style={{ opacity: loading ? 0.6 : 1 }} className="space-y-4">
            <ModuleInsights
              key={`${tab}-${JSON.stringify(period)}`}
              section={({ revenue: "overview", profitability: "overview", opd: "opd", ipd: "ipd", lab: "lab", pharmacy: "pharmacy", expense: "expense" } as const)[tab]}
              query={periodQuery(period)}
              title="Insights, comparison bars & share pies"
            />
            {tab === "revenue" && <Revenue d={data.data} g={g} drill={drill} filtered={!!(filters.doctorId || filters.specialtyId || filters.departmentId)} />}
            {tab === "opd" && <Opd d={data.data} g={g} drill={drill} />}
            {tab === "ipd" && <Ipd d={data.data} g={g} drill={drill} />}
            {tab === "lab" && <Lab d={data.data} g={g} drill={drill} selectedId={filters.investigationId} onSelect={(id) => setFilters((f) => ({ ...f, investigationId: id }))} />}
            {tab === "pharmacy" && <Pharmacy d={data.data} g={g} drill={drill} medicine={filters.medicine} onMedicine={(m) => setFilters((f) => (f.medicine === m ? f : { ...f, medicine: m }))} />}
            {tab === "expense" && <Expense d={data.data} g={g} drill={drill} />}
            {tab === "profitability" && <Profitability d={data.data} g={g} drill={drill} />}
          </div>
        )}
      </div>
    </>
  );
}

type P = { d: any; g: Granularity; drill: (href: string, bucket?: string) => void };
const grid6 = "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6";
const streamSeries = AED_INCOME_STREAMS.map((s) => ({ key: s, label: STREAM_LABELS[s], color: STREAM_COLORS[s] }));

function Revenue({ d, g, drill, filtered }: P & { filtered: boolean }) {
  return (
    <>
      <div className={grid6}>
        {AED_INCOME_STREAMS.map((s) => (
          <Kpi key={s} label={STREAM_LABELS[s]} value={d.byStream[s]} swatch={STREAM_COLORS[s]} href={undefined} />
        ))}
      </div>
      {filtered && <p className="text-xs muted">Doctor / specialty / department filters apply only to streams that carry that attribute (e.g. pharmacy sales have no doctor).</p>}
      <ChartCard title={`Revenue by stream (${g}ly)`} subtitle="Stacked; click a bar to open that period's daily accounts" table={{ columns: [{ key: "bucket", label: "Period" }, ...streamSeries.map((s) => ({ key: s.key, label: s.label, format: "money" as const })), { key: "income", label: "Total", format: "money" as const }], rows: d.series }} height={320}>
        <BarsChart data={d.series} xKey="bucket" stacked granularity={g} series={streamSeries} onBarClick={(r) => drill("/daily-accounts", String(r.bucket))} />
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue mix" subtitle={`Total ${formatINR(d.total)}`}>
          <DonutChart data={AED_INCOME_STREAMS.map((s) => ({ key: s, name: STREAM_LABELS[s], value: Math.max(0, d.byStream[s]), color: STREAM_COLORS[s] }))} onSliceClick={(x) => x.key && drill(STREAM_HREF[x.key])} />
        </ChartCard>
        <ChartCard title="OPD · IPD · Lab · Pharmacy trend" table={{ columns: [{ key: "bucket", label: "Period" }, ...streamSeries.slice(0, 4).map((s) => ({ key: s.key, label: s.label, format: "money" as const }))], rows: d.series }}>
          <TrendChart data={d.series} xKey="bucket" granularity={g} series={streamSeries.slice(0, 4)} onPointClick={(r) => drill("/daily-accounts", String(r.bucket))} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue by doctor (OPD, IPD, lab referrals, diet)" table={{ columns: [{ key: "name", label: "Doctor" }, { key: "amount", label: "Revenue", format: "money" }], rows: d.byDoctor }} height={Math.max(220, d.byDoctor.length * 30)}>
          <BarsChart data={d.byDoctor} xKey="name" horizontal series={[{ key: "amount", label: "Revenue", color: SLOT(0) }]} onBarClick={(r) => drill(`/opd?doctorId=${r.id}`)} />
        </ChartCard>
        <ChartCard title="OPD revenue by specialty" table={{ columns: [{ key: "name", label: "Specialty" }, { key: "amount", label: "Revenue", format: "money" }], rows: d.bySpecialty }} height={Math.max(220, d.bySpecialty.length * 34)}>
          <BarsChart data={d.bySpecialty} xKey="name" horizontal series={[{ key: "amount", label: "Revenue", color: SLOT(0) }]} onBarClick={(r) => drill(`/opd?specialtyId=${r.id}`)} />
        </ChartCard>
      </div>
    </>
  );
}

function Opd({ d, g, drill }: P) {
  const t = d.totals;
  return (
    <>
      <div className={grid6}>
        <Kpi label="Total consultations" value={t.total} format="int" />
        <Kpi label="New" value={t.new} format="int" />
        <Kpi label="Old" value={t.old} format="int" />
        <Kpi label="New %" value={t.newPct} format="pct" />
        <Kpi label="OPD revenue" value={t.revenue} />
        <Kpi label="Avg consultation revenue" value={t.avgRevenue} />
      </div>
      <div className={grid6}>
        {d.bySpecialty.map((s: any) => (
          <Kpi key={s.id} label={s.name} value={s.total} format="int" hint={`${s.new} new · ${s.old} old · ${formatINR(s.revenue)}`} href={undefined} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title={`Consultations trend (${g}ly) — new vs old`} table={{ columns: [{ key: "bucket", label: "Period" }, { key: "new", label: "New", format: "int" }, { key: "old", label: "Old", format: "int" }, { key: "revenue", label: "Revenue", format: "money" }], rows: d.trend }}>
            <BarsChart data={d.trend} xKey="bucket" stacked format="int" granularity={g} series={[{ key: "new", label: "New", color: SLOT(0) }, { key: "old", label: "Old", color: SLOT(1) }]} onBarClick={(r) => drill("/opd", String(r.bucket))} />
          </ChartCard>
        </div>
        <ChartCard title="New vs old">
          <DonutChart format="int" data={[{ key: "NEW", name: "New", value: t.new, color: SLOT(0) }, { key: "OLD", name: "Old", value: t.old, color: SLOT(1) }]} onSliceClick={(x) => drill(`/opd?visitType=${x.key}`)} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Specialty distribution" table={{ columns: [{ key: "name", label: "Specialty" }, { key: "new", label: "New", format: "int" }, { key: "old", label: "Old", format: "int" }, { key: "revenue", label: "Revenue", format: "money" }], rows: d.bySpecialty }}>
          <BarsChart data={d.bySpecialty} xKey="name" horizontal stacked format="int" series={[{ key: "new", label: "New", color: SLOT(0) }, { key: "old", label: "Old", color: SLOT(1) }]} onBarClick={(r) => drill(`/opd?specialtyId=${r.id}`)} />
        </ChartCard>
        <Card title="By doctor">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th className="num">New</th>
                  <th className="num">Old</th>
                  <th className="num">Total</th>
                  <th className="num">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {d.byDoctor.map((x: any) => (
                  <tr key={x.id ?? "none"} className="cursor-pointer" onClick={() => x.id && drill(`/opd?doctorId=${x.id}`)}>
                    <td>{x.name}</td>
                    <td className="num">{formatNumber(x.new)}</td>
                    <td className="num">{formatNumber(x.old)}</td>
                    <td className="num">{formatNumber(x.total)}</td>
                    <td className="num">{formatINR(x.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function Lab({ d, g, drill, selectedId, onSelect }: P & { selectedId?: string; onSelect: (id?: string) => void }) {
  const [sort, setSort] = useState<"volume" | "revenue" | "low" | "change">("volume");
  const [q, setQ] = useState("");
  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const xs = (d.investigations as any[]).filter((x) => !needle || x.name.toLowerCase().includes(needle) || String(x.category ?? "").toLowerCase().includes(needle));
    if (sort === "volume") xs.sort((a, b) => b.tests - a.tests);
    else if (sort === "revenue") xs.sort((a, b) => b.revenue - a.revenue);
    else if (sort === "change") xs.sort((a, b) => Math.abs(b.tests - b.prevTests) - Math.abs(a.tests - a.prevTests));
    else xs.sort((a, b) => a.tests - b.tests);
    return xs;
  }, [d, sort, q]);
  const chartRows = useMemo(() => sorted.filter((x) => x.tests > 0).slice(0, 25), [sorted]);
  const t = d.totals;
  const p = d.previousTotals;
  const sel = d.selected;
  const per = g === "day" ? "day" : g;
  return (
    <>
      <div className={grid6}>
        <Kpi label="Tests performed" value={t.tests} format="int" change={p ? compare(t.tests, p.tests) : undefined} />
        <Kpi label="Lab revenue" value={t.revenue} change={p ? compare(t.revenue, p.revenue) : undefined} />
        <Kpi label="Avg revenue / test" value={t.avgPerTest} />
        <Kpi label="Avg tests / day" value={t.avgTestsPerDay} format="int" />
      </div>

      <Card
        title="Test-wise counts"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input className="input !w-48 !py-1 text-sm" placeholder="Find a test, e.g. ECG" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a test" />
            <select className="input !w-auto !py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort investigations">
              <option value="volume">Most performed</option>
              <option value="revenue">Highest revenue</option>
              <option value="change">Biggest change</option>
              <option value="low">Least performed</option>
            </select>
          </div>
        }
      >
        <p className="mb-2 text-xs muted">
          {formatNumber(sorted.length)} tests · this period vs the previous period of the same length. Click a test to see it {per} by {per}.
        </p>
        <div className="max-h-[440px] overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Investigation</th>
                <th className="num">This period</th>
                <th className="num">Previous</th>
                <th className="num">Change</th>
                <th className="num">Revenue</th>
                <th className="num">Avg / test</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((x: any) => {
                const diff = x.tests - x.prevTests;
                return (
                  <tr key={x.id} className={`cursor-pointer ${x.id === selectedId ? "bg-[var(--surface-2)] font-semibold" : ""}`} onClick={() => onSelect(x.id === selectedId ? undefined : x.id)}>
                    <td>
                      {x.name} <span className="text-xs muted">{x.category}</span>
                    </td>
                    <td className="num">{formatNumber(x.tests)}</td>
                    <td className="num muted">{formatNumber(x.prevTests)}</td>
                    <td className="num" style={{ color: diff > 0 ? "var(--status-good)" : diff < 0 ? "var(--status-critical)" : undefined }}>
                      {diff > 0 ? "+" : ""}
                      {formatNumber(diff)}
                      {x.prevTests > 0 && <span className="text-xs muted"> ({diff >= 0 ? "+" : ""}{Math.round((diff / x.prevTests) * 100)}%)</span>}
                    </td>
                    <td className="num">{formatINR(x.revenue)}</td>
                    <td className="num">{x.avg === null ? "—" : formatINR(x.avg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {sel && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={sel.name} actions={<button className="btn btn-sm btn-secondary" onClick={() => onSelect(undefined)}>Clear</button>}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs muted">Performed</dt>
                <dd className="text-2xl font-semibold tabular-nums">{formatNumber(sel.tests)}</dd>
              </div>
              <div>
                <dt className="text-xs muted">Revenue</dt>
                <dd className="text-2xl font-semibold tabular-nums">{formatINR(sel.revenue)}</dd>
              </div>
              <div>
                <dt className="text-xs muted">Average per {per}</dt>
                <dd className="text-lg font-semibold tabular-nums">{sel.avgPerBucket === null ? "—" : sel.avgPerBucket.toFixed(1)}</dd>
              </div>
              <div>
                <dt className="text-xs muted">Busiest {per}</dt>
                <dd className="text-lg font-semibold tabular-nums">{sel.busiest ? `${formatNumber(sel.busiest.tests)} · ${g === "month" ? formatMonth(sel.busiest.bucket) : g === "week" ? `week of ${formatDayMonth(sel.busiest.bucket)}` : formatDayMonth(sel.busiest.bucket)}` : "—"}</dd>
              </div>
            </dl>
            <button className="btn btn-sm btn-ghost mt-3" onClick={() => drill(`/lab?investigationId=${sel.id}`)}>
              Open the transactions
            </button>
          </Card>
          <div className="lg:col-span-2">
          <ChartCard title={`${sel.name} per ${per}`} table={{ columns: [{ key: "bucket", label: "Period" }, { key: "tests", label: "Tests", format: "int" }, { key: "revenue", label: "Revenue", format: "money" }], rows: sel.trend }}>
            <BarsChart data={sel.trend} xKey="bucket" format="int" granularity={g} series={[{ key: "tests", label: sel.name, color: SLOT(2) }]} onBarClick={(r) => drill(`/lab?investigationId=${sel.id}`, String(r.bucket))} />
          </ChartCard>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={`Tests per ${per}`} table={{ columns: [{ key: "bucket", label: "Period" }, { key: "tests", label: "Tests", format: "int" }], rows: d.trend }}>
          <BarsChart data={d.trend} xKey="bucket" format="int" granularity={g} series={[{ key: "tests", label: "Tests", color: SLOT(2) }]} onBarClick={(r) => drill("/lab", String(r.bucket))} />
        </ChartCard>
        <ChartCard title={`Lab revenue per ${per}`} table={{ columns: [{ key: "bucket", label: "Period" }, { key: "revenue", label: "Revenue", format: "money" }], rows: d.trend }}>
          <TrendChart data={d.trend} xKey="bucket" granularity={g} series={[{ key: "revenue", label: "Revenue", color: SLOT(2) }]} onPointClick={(r) => drill("/lab", String(r.bucket))} />
        </ChartCard>
      </div>
      <ChartCard title={sort === "revenue" ? "Top 25 tests by revenue" : "Top 25 tests by volume"} subtitle="Click a bar to see that test over time" height={Math.max(260, chartRows.length * 26)}>
        <BarsChart data={chartRows} xKey="name" horizontal format={sort === "revenue" ? "money" : "int"} series={[sort === "revenue" ? { key: "revenue", label: "Revenue", color: SLOT(2) } : { key: "tests", label: "Tests", color: SLOT(2) }]} onBarClick={(r) => onSelect(String(r.id))} />
      </ChartCard>
    </>
  );
}

function Ipd({ d, g, drill }: P) {
  const t = d.totals;
  return (
    <>
      <div className={grid6}>
        <Kpi label="Admissions" value={t.admissions} format="int" />
        <Kpi label="Billed (net)" value={t.billed} />
        <Kpi label="Collected (income)" value={t.collected} />
        <Kpi label="Avg admission value" value={t.avgAdmissionValue} />
        <Kpi label="Outstanding" value={t.outstanding} href="/ipd?tab=outstanding" />
        <Kpi label="Refunds" value={d.collectionsByKind.refunds} goodWhen="down" />
      </div>
      <div className={grid6}>
        {d.byType.map((x: any) => (
          <Kpi key={x.id} label={`${x.name} revenue`} value={x.collected} hint={`${x.admissions} admissions · billed ${formatINR(x.billed)}`} href={undefined} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={`Admissions per ${g}`} table={{ columns: [{ key: "bucket", label: "Period" }, { key: "admissions", label: "Admissions", format: "int" }, { key: "billed", label: "Billed", format: "money" }], rows: d.trend }}>
          <BarsChart data={d.trend} xKey="bucket" format="int" granularity={g} series={[{ key: "admissions", label: "Admissions", color: SLOT(1) }]} onBarClick={(r) => drill("/ipd", String(r.bucket))} />
        </ChartCard>
        <ChartCard title="Collections by admission type" table={{ columns: [{ key: "name", label: "Type" }, { key: "collected", label: "Collected", format: "money" }, { key: "billed", label: "Billed", format: "money" }], rows: d.byType }}>
          <BarsChart data={d.byType} xKey="name" horizontal series={[{ key: "collected", label: "Collected", color: SLOT(1) }]} onBarClick={(r) => drill(`/ipd?admissionTypeId=${r.id}`)} />
        </ChartCard>
      </div>
    </>
  );
}

function Pharmacy({ d, g, drill, medicine, onMedicine }: P & { medicine?: string; onMedicine: (q?: string) => void }) {
  const t = d.totals;
  const it = d.items;
  const per = g === "day" ? "day" : g;
  return (
    <>
      <div className={grid6}>
        <Kpi label="Total sales" value={t.totalSales} hint="Gross sales − discount (collections)" />
        <Kpi label="Returns" value={t.returns} goodWhen="down" />
        <Kpi label="Net sales" value={t.netSales} />
        <Kpi label="Purchases" value={t.purchases} href={undefined} />
        {it?.hasData ? (
          <>
            <Kpi label="Margin on medicines sold" value={it.totals.margin} change={it.previousTotals ? compare(it.totals.margin, it.previousTotals.margin) : undefined} hint="Sale value − purchase cost of the units sold, both excluding GST" />
            <Kpi label="Margin %" value={it.totals.marginPct} format="pct" />
          </>
        ) : (
          <>
            <Kpi label="Gross margin" value={t.grossMargin} />
            <Kpi label="Gross margin %" value={t.grossMarginPct} format="pct" />
          </>
        )}
      </div>
      {it?.hasData && (
        <div className={grid6}>
          <Kpi label="Pharmacy bills" value={it.totals.bills} format="int" change={it.previousTotals ? compare(it.totals.bills, it.previousTotals.bills) : undefined} />
          <Kpi label="Avg bill value" value={it.totals.avgBill} change={it.previousTotals ? compare(it.totals.avgBill ?? 0, it.previousTotals.avgBill ?? 0) : undefined} />
          <Kpi label="Units sold" value={it.totals.units} format="int" change={it.previousTotals ? compare(it.totals.units, it.previousTotals.units) : undefined} />
          <Kpi label="Medicines sold" value={it.totals.medicines} format="int" hint="Distinct products with at least one sale" />
        </div>
      )}
      <ChartCard title={`Net sales vs purchases (${g}ly)`} subtitle="Same unit (₹), one axis" table={{ columns: [{ key: "bucket", label: "Period" }, { key: "netSales", label: "Net sales", format: "money" }, { key: "purchases", label: "Purchases", format: "money" }, { key: "returns", label: "Returns", format: "money" }], rows: d.trend }} height={300}>
        <BarsChart data={d.trend} xKey="bucket" granularity={g} series={[{ key: "netSales", label: "Net sales", color: SLOT(3) }, { key: "purchases", label: "Purchases", color: SLOT(6) }]} onBarClick={(r) => drill("/pharmacy", String(r.bucket))} />
      </ChartCard>
      {it?.hasData ? (
        <MedicineSection it={it} g={g} per={per} medicine={medicine} onMedicine={onMedicine} m={d.medicine} />
      ) : (
        <Card title="Medicine-wise sales">
          <p className="text-sm text-2">
            No medicine-level data for this period. Import OneGlance <b>Purchase/Sales Report</b> (sales view, one row per medicine) in Excel Import to see units sold per medicine, bills and true margin.
          </p>
        </Card>
      )}
      {d.payables?.hasPayments && <Payables p={d.payables} />}
      <Card title="How pharmacy is accounted">
        <ul className="list-disc space-y-1 pl-5 text-sm text-2">
          <li>Net sales (after discount and returns) are counted once in hospital income — from collections.</li>
          <li>Stock purchases are counted once in expenditure — never also as a “cost” of sales.</li>
          <li>Medicine-wise figures (units, bills, margin) come from the HMS medicine lines. They explain the sales; they are not added to income a second time. Margin there = sale value − purchase cost of the units sold, both excluding GST.</li>
          <li>Without medicine lines, gross margin = Net sales − Purchases (purchases stand in for cost of goods sold).</li>
        </ul>
      </Card>
    </>
  );
}

function Payables({ p }: { p: any }) {
  const [all, setAll] = useState(false);
  const rows = (p.suppliers as any[]).filter((x) => all || x.openAmount > 0);
  const t = p.totals;
  return (
    <Card
      title="Suppliers — purchased vs paid"
      actions={
        <label className="flex items-center gap-2 text-xs text-2">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show fully paid suppliers too
        </label>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Purchased (invoices)" value={t.purchased} hint={`${formatNumber(t.invoices)} invoices dated in this period`} />
        <Kpi label="Paid to suppliers" value={t.paid} hint="Payments dated in this period (any invoice)" />
        <Kpi label="Open invoices" value={t.openInvoices} format="int" goodWhen="down" />
        <Kpi label="Open invoice value" value={t.openAmount} goodWhen="down" hint="This period's invoices not listed in any recorded payment" />
        <Kpi label="Avg days invoice → payment" value={t.avgDaysToPay} format="int" goodWhen="up" hint={`Credit actually taken, over ${formatNumber(t.matchedInvoicesPaid)} invoices paid in this period`} />
      </div>
      <p className="mb-2 text-xs muted">
        An invoice counts as paid when a recorded payment to that supplier lists its number. Payments made in cash/UPI outside OneGlance&apos;s payment report are not visible here, so treat “open” as “no payment recorded”, not as a confirmed dues figure.
      </p>
      <div className="max-h-[420px] overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th className="num">Invoices</th>
              <th className="num">Purchased</th>
              <th className="num">Paid</th>
              <th className="num">Open invoices</th>
              <th className="num">Open value</th>
              <th>Oldest open</th>
              <th>Last paid</th>
              <th className="num">Days to pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x: any) => (
              <tr key={x.supplier}>
                <td>{x.supplier}</td>
                <td className="num">{formatNumber(x.invoices)}</td>
                <td className="num">{formatINR(x.purchased)}</td>
                <td className="num">{formatINR(x.paid)}</td>
                <td className="num">{formatNumber(x.openInvoices)}</td>
                <td className="num" style={{ color: x.openAmount > 0 ? "var(--status-critical)" : undefined }}>
                  {formatINR(x.openAmount)}
                </td>
                <td>{x.oldestOpen ? formatDayMonth(x.oldestOpen) : "—"}</td>
                <td>{x.lastPaid ? formatDayMonth(x.lastPaid) : "—"}</td>
                <td className="num">{x.avgDaysToPay ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MedicineSection({ it, g, per, medicine, onMedicine, m }: { it: any; g: Granularity; per: string; medicine?: string; onMedicine: (q?: string) => void; m: any }) {
  const [q, setQ] = useState(medicine ?? "");
  const [sort, setSort] = useState<"revenue" | "units" | "margin" | "change">("revenue");
  // Ask the server for the combined trend once typing pauses (e.g. "janumet" → every Janumet strength).
  useEffect(() => {
    const h = setTimeout(() => onMedicine(q.trim().length >= 2 ? q.trim() : undefined), 450);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const xs = (it.medicines as any[]).filter((x) => !needle || x.name.toLowerCase().includes(needle));
    if (sort === "units") xs.sort((a, b) => b.units - a.units);
    else if (sort === "margin") xs.sort((a, b) => b.margin - a.margin);
    else if (sort === "change") xs.sort((a, b) => Math.abs(b.revenue - b.prevRevenue) - Math.abs(a.revenue - a.prevRevenue));
    else xs.sort((a, b) => b.revenue - a.revenue);
    return xs;
  }, [it, q, sort]);
  const short = (n: string) => (n.length > 24 ? `${n.slice(0, 23)}…` : n);
  const top = useMemo(() => [...(it.medicines as any[])].sort((a, b) => b.revenue - a.revenue).slice(0, 15).map((x) => ({ ...x, label: x.name.length > 24 ? `${x.name.slice(0, 23)}…` : x.name })), [it]);
  return (
    <>
      <Card
        title="Medicine-wise sales"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input className="input !w-52 !py-1 text-sm" placeholder="Find a medicine, e.g. Janumet" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a medicine" />
            <select className="input !w-auto !py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort medicines">
              <option value="revenue">Highest sales value</option>
              <option value="units">Most units</option>
              <option value="margin">Highest margin</option>
              <option value="change">Biggest change</option>
            </select>
          </div>
        }
      >
        <p className="mb-2 text-xs muted">
          {formatNumber(rows.length)} medicines · units are tablets / capsules / pens / vials as billed · this period vs the previous period of the same length.
        </p>
        <div className="max-h-[440px] overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th className="num">Units</th>
                <th className="num">Previous</th>
                <th className="num">Bills</th>
                <th className="num">Sales value</th>
                <th className="num">Margin</th>
                <th className="num">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((x: any) => {
                const diff = x.units - x.prevUnits;
                return (
                  <tr key={x.id} className="cursor-pointer" onClick={() => setQ(x.name)}>
                    <td>
                      {x.name} <span className="text-xs muted">{x.form}</span>
                    </td>
                    <td className="num">{formatNumber(x.units)}</td>
                    <td className="num muted">
                      {formatNumber(x.prevUnits)}
                      {diff !== 0 && (
                        <span className="text-xs" style={{ color: diff > 0 ? "var(--status-good)" : "var(--status-critical)" }}>
                          {" "}
                          ({diff > 0 ? "+" : ""}
                          {formatNumber(diff)})
                        </span>
                      )}
                    </td>
                    <td className="num">{formatNumber(x.bills)}</td>
                    <td className="num">{formatINR(x.revenue)}</td>
                    <td className="num" style={{ color: x.margin < 0 ? "var(--status-critical)" : undefined }}>
                      {formatINR(x.margin)}
                    </td>
                    <td className="num">{x.marginPct === null ? "—" : `${x.marginPct.toFixed(1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 400 && <p className="p-2 text-xs muted">Showing the first 400 — search to narrow down.</p>}
        </div>
      </Card>

      {m && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={`“${m.q}” — all matching medicines`} actions={<button className="btn btn-sm btn-secondary" onClick={() => setQ("")}>Clear</button>}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs muted">Units sold</dt>
                <dd className="text-2xl font-semibold tabular-nums">{formatNumber(m.units)}</dd>
              </div>
              <div>
                <dt className="text-xs muted">Sales value</dt>
                <dd className="text-2xl font-semibold tabular-nums">{formatINR(m.revenue)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs muted">Average per {per}</dt>
                <dd className="text-lg font-semibold tabular-nums">{m.avgPerBucket === null ? "—" : m.avgPerBucket.toFixed(1)} units</dd>
              </div>
            </dl>
            {m.variants.length > 0 && (
              <table className="table mt-3 text-sm">
                <tbody>
                  {m.variants.slice(0, 12).map((v: any) => (
                    <tr key={v.name}>
                      <td>{v.name}</td>
                      <td className="num">{formatNumber(v.units)}</td>
                      <td className="num muted">{formatINR(v.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <div className="lg:col-span-2">
            <ChartCard title={`“${m.q}” units per ${per}`} table={{ columns: [{ key: "bucket", label: "Period" }, { key: "units", label: "Units", format: "int" }, { key: "revenue", label: "Sales value", format: "money" }], rows: m.trend }}>
              <BarsChart data={m.trend} xKey="bucket" format="int" granularity={g} series={[{ key: "units", label: "Units", color: SLOT(3) }]} />
            </ChartCard>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top 15 medicines by sales value" subtitle="Click a bar to see that medicine over time" height={Math.max(260, top.length * 34)}>
          <BarsChart data={top} xKey="label" horizontal series={[{ key: "revenue", label: "Sales value", color: SLOT(3) }]} onBarClick={(r) => setQ(String(r.name))} />
        </ChartCard>
        <ChartCard title="Purchases by supplier" table={{ columns: [{ key: "supplier", label: "Supplier" }, { key: "invoices", label: "Invoices", format: "int" }, { key: "amount", label: "Amount", format: "money" }], rows: it.suppliers }} height={Math.max(260, it.suppliers.length * 34)}>
          <BarsChart data={it.suppliers.map((x: any) => ({ ...x, label: short(x.supplier) }))} xKey="label" horizontal series={[{ key: "amount", label: "Purchases", color: SLOT(6) }]} />
        </ChartCard>
      </div>
    </>
  );
}

function Expense({ d, g, drill }: P) {
  const t = d.totals;
  const top = d.byCategory.slice(0, 7);
  const rest = d.byCategory.slice(7).reduce((a: number, c: any) => a + c.amount, 0);
  const donut = [...top.map((c: any, i: number) => ({ key: c.id, name: c.name, value: c.amount, color: SLOT(i) })), ...(rest > 0 ? [{ key: "", name: "Other categories", value: rest, color: "var(--text-3)" }] : [])];
  return (
    <>
      <div className={grid6}>
        <Kpi label="Total expenses" value={t.total} />
        <Kpi label={EXPENSE_LABELS.HOSPITAL} value={t.HOSPITAL} href={undefined} />
        <Kpi label={EXPENSE_LABELS.OTHER} value={t.OTHER} />
        <Kpi label="Average daily expense" value={t.avgDaily} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={`Expense trend (${g}ly)`} table={{ columns: [{ key: "bucket", label: "Period" }, { key: "expenses", label: "Expenses", format: "money" }], rows: d.incomeVsExpense }}>
          <BarsChart data={d.incomeVsExpense} xKey="bucket" granularity={g} series={[{ key: "expenses", label: "Expenses", color: SLOT(1) }]} onBarClick={(r) => drill("/expenses", String(r.bucket))} />
        </ChartCard>
        <ChartCard title="By category (excl. pharmacy purchases)">
          <DonutChart data={donut} onSliceClick={(x) => x.key && drill(`/expenses?categoryId=${x.key}`)} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Income vs expense" table={{ columns: [{ key: "bucket", label: "Period" }, { key: "income", label: "Income", format: "money" }, { key: "expenses", label: "Expenses", format: "money" }, { key: "net", label: "Net", format: "money" }], rows: d.incomeVsExpense }}>
          <TrendChart data={d.incomeVsExpense} xKey="bucket" granularity={g} series={[{ key: "income", label: "Income", color: SLOT(0) }, { key: "expenses", label: "Expenses", color: SLOT(1) }]} onPointClick={(r) => drill("/daily-accounts", String(r.bucket))} />
        </ChartCard>
        <ChartCard title="By department" table={{ columns: [{ key: "name", label: "Department" }, { key: "amount", label: "Amount", format: "money" }], rows: d.byDepartment }} height={Math.max(220, d.byDepartment.length * 30)}>
          <BarsChart data={d.byDepartment} xKey="name" horizontal series={[{ key: "amount", label: "Amount", color: SLOT(1) }]} onBarClick={(r) => r.id && drill(`/expenses?departmentId=${r.id}`)} />
        </ChartCard>
      </div>
      <Card title="Largest expenses">
        <table className="table">
          <tbody>
            {d.largest.map((e: any) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td>{e.description}</td>
                <td className="muted">{e.category}</td>
                <td className="num font-medium">{formatINR(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Profitability({ d, g, drill }: P) {
  const k = d.kpis;
  const rows = [
    ["Total Income", formatINR(k.totalIncome), "OPD + IPD collections + Lab + Pharmacy net sales + Diet + Other income"],
    ["Total Expenses", formatINR(k.totalExpenses), "Hospital operating + Pharmacy purchases + Other expenses"],
    ["Net Operating Result", formatINR(k.netOperatingResult), "Total Income − Total Expenses"],
    ["Net margin %", k.netMarginPct === null ? "—" : `${k.netMarginPct}%`, "Net Operating Result ÷ Total Income × 100"],
    ["Revenue per patient", formatINR(k.revenuePerPatient), `Total Income ÷ ${formatNumber(d.counts.patients)} distinct patients`],
    ["Expense per patient", formatINR(k.expensePerPatient), "Total Expenses ÷ distinct patients"],
    ["Revenue per consultation", formatINR(k.avgConsultationRevenue), `OPD income ÷ ${formatNumber(d.counts.consultations)} consultations`],
    ["Revenue per IPD admission", formatINR(k.revenuePerAdmission), `IPD collections ÷ ${formatNumber(d.counts.admissions)} admissions (collections may relate to earlier admissions)`],
    ["Revenue per lab test", formatINR(k.avgLabRevenuePerTest), `Lab income ÷ ${formatNumber(d.counts.labTests)} tests`],
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Total Income" value={k.totalIncome} emphasis />
        <Kpi label="Total Expenses" value={k.totalExpenses} emphasis />
        <Kpi label="Net Operating Result" value={k.netOperatingResult} emphasis />
      </div>
      <ChartCard title="Income, expenses and net result" table={{ columns: [{ key: "bucket", label: "Period" }, { key: "income", label: "Income", format: "money" }, { key: "expenses", label: "Expenses", format: "money" }, { key: "net", label: "Net", format: "money" }], rows: d.series }} height={300}>
        <TrendChart data={d.series} xKey="bucket" granularity={g} series={[{ key: "income", label: "Income", color: SLOT(0) }, { key: "expenses", label: "Expenses", color: SLOT(1) }, { key: "net", label: "Net result", color: SLOT(2) }]} onPointClick={(r) => drill("/daily-accounts", String(r.bucket))} />
      </ChartCard>
      <Card title="Profitability metrics & definitions">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Value</th>
                <th>How it is calculated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([a, b, c]) => (
                <tr key={a}>
                  <td className="font-medium">{a}</td>
                  <td className="num">{b}</td>
                  <td className="whitespace-normal text-xs text-2">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs muted">Income is recognised on a collections basis on the transaction date. Only active records are counted. See ACCOUNTING_RULES.md for the full definitions.</p>
      </Card>
    </>
  );
}

export default function Page() {
  return (
    <Guard perm="analytics.view">
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
