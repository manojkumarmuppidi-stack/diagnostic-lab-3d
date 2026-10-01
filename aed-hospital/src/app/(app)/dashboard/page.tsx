"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { useApi, qs } from "@/lib/client";
import { compare, EXPENSE_LABELS, INCOME_STREAMS, pctOf, STREAM_LABELS, type Change, type Counts, type ExpenseByKind, type IncomeByStream } from "@/lib/accounting";
import { addDays } from "@/lib/dates";
import { formatINR, formatNumber, formatPct } from "@/lib/money";
import type { Granularity, ResolvedPeriod } from "@/lib/periods";
import { Card, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { Kpi } from "@/components/Kpi";
import { PeriodPicker, periodQuery, type PeriodValue } from "@/components/PeriodPicker";
import { BarsChart, ChartCard, DonutChart, STREAM_COLORS } from "@/components/charts/Charts";
import { useCan } from "@/components/session";
import { STREAM_HREF, withRange } from "@/lib/drill";
import { ComparisonCard, InsightList, type SectionData } from "@/components/insights/InsightViews";
import { FileDown, Lightbulb, Presentation } from "lucide-react";

interface Summary {
  income: IncomeByStream;
  expense: ExpenseByKind;
  counts: Counts;
  kpis: Record<string, number | null>;
}
interface DashboardData {
  today: string;
  period: ResolvedPeriod;
  current: Summary;
  previous: Summary;
  comparison: Record<string, Change>;
  collectionsByMode: Record<string, number>;
  alerts: { id: string; severity: "info" | "warning" | "critical"; title: string; detail: string; href?: string }[];
  trend: Record<string, number | string>[];
  trendGranularity: Granularity;
  trendRange: { from: string; to: string };
}


export default function DashboardPage() {
  const [period, setPeriod] = useState<PeriodValue>({ preset: "today", compareMode: "like_for_like" });
  const { data, error, loading, reload } = useApi<DashboardData>(period.preset === "custom" && (!period.from || !period.to) ? null : `/api/dashboard${qs(periodQuery(period))}`);
  const router = useRouter();
  const can = useCan();
  const ins = useApi<{ section: SectionData }>(period.preset === "custom" && (!period.from || !period.to) ? null : `/api/insights/overview${qs(periodQuery(period))}`);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Executive Dashboard"
        subtitle={data ? `${data.period.current.label} · compared with ${data.period.previous.label} (${data.period.previous.from} → ${data.period.previous.to})` : "Loading…"}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <PeriodPicker value={period} onChange={setPeriod} />
            <Link
              className="btn btn-secondary no-print"
              href={`/daily-summary?date=${data && data.period.current.from === data.period.current.to ? data.period.current.to : data?.today ?? ""}&print=1`}
              title="One-page A4 summary of the day — save as PDF"
            >
              <FileDown className="h-4 w-4" /> Day summary PDF
            </Link>
          </div>
        }
      />
      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-5" style={{ opacity: loading ? 0.6 : 1 }}>
          {data.alerts.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.alerts.map((a) => {
                const Icon = a.severity === "critical" ? OctagonAlert : a.severity === "warning" ? AlertTriangle : Info;
                const color = a.severity === "critical" ? "var(--status-critical)" : a.severity === "warning" ? "var(--status-warning)" : "var(--series-1)";
                const body = (
                  <div className="card flex h-full items-start gap-2 p-3 text-sm" style={{ borderLeft: `4px solid ${color}` }}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} aria-label={a.severity} />
                    <div>
                      <p className="font-medium">{a.title}</p>
                      <p className="text-xs muted">{a.detail}</p>
                    </div>
                  </div>
                );
                return a.href ? (
                  <Link key={a.id} href={a.href}>
                    {body}
                  </Link>
                ) : (
                  <div key={a.id}>{body}</div>
                );
              })}
            </div>
          )}

          {ins.data && ins.data.section.insights.length > 0 && (
            <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "linear-gradient(135deg, color-mix(in srgb, var(--brand) 8%, var(--surface)), var(--surface))" }}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Lightbulb className="h-4 w-4" style={{ color: "var(--status-warning)" }} /> Key insights · {data.period.current.label} vs {data.period.previous.label}
                </h2>
                {can("analytics.view") && (
                  <Link href="/meeting" className="btn btn-secondary btn-sm">
                    <Presentation className="h-4 w-4" /> Board meeting pack
                  </Link>
                )}
              </div>
              <InsightList insights={ins.data.section.insights} limit={6} />
            </section>
          )}

          <Section title="Financial result">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Kpi label="Total Income" value={data.current.kpis.totalIncome} change={data.comparison.totalIncome} href={withRange("/daily-accounts", data.period.current.from, data.period.current.to)} hint="OPD + IPD collections + Lab + Pharmacy net sales + Diet + Other" emphasis />
              <Kpi label="Total Expenses" value={data.current.kpis.totalExpenses} change={data.comparison.totalExpenses} goodWhen="down" href={withRange("/expenses", data.period.current.from, data.period.current.to)} hint="Hospital expenses + Pharmacy purchases + Other expenses" emphasis />
              <Kpi label="Net Operating Result" value={data.current.kpis.netOperatingResult} change={data.comparison.netOperatingResult} hint="Total Income − Total Expenses" emphasis />
            </div>
          </Section>

          <Segments cur={data.current} prev={data.previous} from={data.period.current.from} to={data.period.current.to} />

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <Section title="Income">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {INCOME_STREAMS.map((s) => (
                    <Kpi key={s} label={STREAM_LABELS[s]} value={data.current.income[s]} change={data.comparison[s.toLowerCase()]} href={withRange(STREAM_HREF[s], data.period.current.from, data.period.current.to)} swatch={STREAM_COLORS[s]} />
                  ))}
                </div>
              </Section>
            </div>
            <Section title="Expenditure">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
                <Kpi label={EXPENSE_LABELS.HOSPITAL} value={data.current.expense.HOSPITAL} change={data.comparison.hospitalExpenses} goodWhen="down" href={withRange("/expenses?group=HOSPITAL", data.period.current.from, data.period.current.to)} />
                <Kpi label={EXPENSE_LABELS.PHARMACY_PURCHASE} value={data.current.expense.PHARMACY_PURCHASE} change={data.comparison.pharmacyPurchases} goodWhen="down" href={withRange("/pharmacy?tab=purchases", data.period.current.from, data.period.current.to)} />
                <Kpi label={EXPENSE_LABELS.OTHER} value={data.current.expense.OTHER} change={data.comparison.otherExpenses} goodWhen="down" href={withRange("/expenses?group=OTHER", data.period.current.from, data.period.current.to)} />
              </div>
            </Section>
          </div>

          <Section title="Operations">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Total patients" value={data.current.counts.patients} format="int" change={data.comparison.patients} hint="Distinct patients with OPD, IPD admission, Lab or Diet services" />
              <Kpi label="New consultations" value={data.current.counts.newConsultations} format="int" change={data.comparison.newConsultations} href={withRange("/opd?visitType=NEW", data.period.current.from, data.period.current.to)} />
              <Kpi label="Old consultations" value={data.current.counts.oldConsultations} format="int" change={data.comparison.oldConsultations} href={withRange("/opd?visitType=OLD", data.period.current.from, data.period.current.to)} />
              <Kpi label="IPD admissions" value={data.current.counts.admissions} format="int" change={data.comparison.admissions} href={withRange("/ipd", data.period.current.from, data.period.current.to)} />
              <Kpi label="Laboratory tests" value={data.current.counts.labTests} format="int" change={data.comparison.labTests} href={withRange("/lab", data.period.current.from, data.period.current.to)} />
              <Kpi label="Pharmacy transactions" value={data.current.counts.pharmacyTransactions} format="int" change={data.comparison.pharmacyTransactions} href={withRange("/pharmacy", data.period.current.from, data.period.current.to)} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Kpi label="Avg revenue per patient" value={data.current.kpis.revenuePerPatient} hint="Total Income ÷ distinct patients" />
              <Kpi label="Avg consultation revenue" value={data.current.kpis.avgConsultationRevenue} hint="OPD income ÷ consultations" />
              <Kpi label="Avg lab revenue / test" value={data.current.kpis.avgLabRevenuePerTest} hint="Lab income ÷ tests" />
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChartCard
                title={data.period.current.from === data.period.current.to ? "Income — last 14 days" : "Income by stream"}
                subtitle="Click a bar to see that day's accounts"
                table={{ columns: [{ key: "bucket", label: "Period" }, ...INCOME_STREAMS.map((s) => ({ key: s, label: STREAM_LABELS[s], format: "money" as const })), { key: "expenses", label: "Expenses", format: "money" as const }], rows: data.trend }}
              >
                <BarsChart
                  data={data.trend}
                  xKey="bucket"
                  stacked
                  granularity={data.trendGranularity}
                  series={INCOME_STREAMS.map((s) => ({ key: s, label: STREAM_LABELS[s], color: STREAM_COLORS[s] }))}
                  onBarClick={(row) => data.trendGranularity === "day" ? router.push(`/daily-accounts?date=${row.bucket}`) : router.push(withRange("/daily-accounts", String(row.bucket), data.trendGranularity === "week" ? addDays(String(row.bucket), 6) : String(row.bucket)))}
                />
              </ChartCard>
            </div>
            <ChartCard title="Revenue mix" subtitle="Click a segment to drill down" height={260}>
              <DonutChart
                data={INCOME_STREAMS.map((s) => ({ key: s, name: STREAM_LABELS[s], value: Math.max(0, data.current.income[s]), color: STREAM_COLORS[s] }))}
                onSliceClick={(d) => d.key && router.push(withRange(STREAM_HREF[d.key], data.period.current.from, data.period.current.to))}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Collections by payment mode" actions={can("accounts.view") ? <Link className="text-xs underline" href={`/daily-accounts?date=${data.period.current.to}`}>Reconcile</Link> : null}>
              <table className="table">
                <tbody>
                  {Object.entries(data.collectionsByMode).map(([k, v]) => (
                    <tr key={k}>
                      <td>{({ CASH: "Cash", CARD: "Card", UPI: "UPI", BANK: "Bank transfer", OTHER: "Other" } as Record<string, string>)[k] ?? k}</td>
                      <td className="num font-medium">{formatINR(v)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold">Total collected</td>
                    <td className="num font-semibold">{formatINR(Object.values(data.collectionsByMode).reduce((a, b) => a + b, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
            <Card title={`${data.period.current.label} vs ${data.period.previous.label}`}>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th className="num">Current</th>
                      <th className="num">Previous</th>
                      <th className="num">Change</th>
                      <th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ["Income", "totalIncome", "money"],
                        ["Expenses", "totalExpenses", "money"],
                        ["Net result", "netOperatingResult", "money"],
                        ["OPD", "opd", "money"],
                        ["IPD", "ipd", "money"],
                        ["Lab", "lab", "money"],
                        ["Hormonal Pharmacy", "pharmacy", "money"],
                        ["Patients", "patients", "int"],
                        ["Consultations", "consultations", "int"],
                        ["Lab tests", "labTests", "int"],
                      ] as const
                    ).map(([label, key, f]) => {
                      const c = data.comparison[key];
                      const fmt = (v: number) => (f === "money" ? formatINR(v) : formatNumber(v));
                      return (
                        <tr key={key}>
                          <td>{label}</td>
                          <td className="num">{fmt(c.current)}</td>
                          <td className="num muted">{fmt(c.previous)}</td>
                          <td className="num">{(c.diff > 0 ? "+" : "") + fmt(c.diff)}</td>
                          <td className="num">{c.pct === null ? <span className="muted" title="Previous period was zero — % change is undefined">n/a</span> : formatPct(c.pct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          {ins.data && (
            <Section title={`Comparison · ${data.period.current.label} vs ${data.period.previous.label}`}>
              <div className="grid gap-4">
                {ins.data.section.comparisons.map((c) => (
                  <ComparisonCard key={c.id} c={c} curLabel={data.period.current.label} prevLabel={data.period.previous.label} />
                ))}
              </div>
            </Section>
          )}
          <p className="text-xs muted">
            Figures use the transaction date and include only active records (voided, superseded and reversed entries are excluded). Pharmacy purchases are counted once, as expenditure; see Analytics → Pharmacy for gross margin.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The two businesses side by side: the hospital without the Hormonal Pharmacy, and the pharmacy
 * on its own (Sale − Purchase). Together they add up to the Financial result above.
 */
function Segments({ cur, prev, from, to }: { cur: Summary; prev: Summary; from: string; to: string }) {
  const seg = (x: Summary) => {
    const hospIncome = INCOME_STREAMS.filter((s) => s !== "PHARMACY").reduce((a, s) => a + x.income[s], 0);
    const hospExp = x.expense.HOSPITAL + x.expense.OTHER;
    const phSales = x.income.PHARMACY;
    const phBuy = x.expense.PHARMACY_PURCHASE;
    return { hospIncome, hospExp, hospNet: hospIncome - hospExp, phSales, phBuy, phProfit: phSales - phBuy, phPct: pctOf(phSales - phBuy, phSales) };
  };
  const a = seg(cur);
  const b = seg(prev);
  return (
    <Section title="By segment">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-3 sm:p-4">
          <h3 className="mb-2 text-sm font-semibold">Hospital (without Hormonal Pharmacy)</h3>
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="Income" value={a.hospIncome} change={compare(a.hospIncome, b.hospIncome)} href={withRange("/daily-accounts", from, to)} />
            <Kpi label="Expenses" value={a.hospExp} change={compare(a.hospExp, b.hospExp)} goodWhen="down" href={withRange("/expenses", from, to)} />
            <Kpi label="Net" value={a.hospNet} change={compare(a.hospNet, b.hospNet)} emphasis />
          </div>
        </div>
        <div className="card p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Hormonal Pharmacy (Sale − Purchase)</h3>
            <Link href="/hormonal-pharmacy" className="text-xs underline">
              Monthly accounts
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="Net sales" value={a.phSales} change={compare(a.phSales, b.phSales)} href="/hormonal-pharmacy" />
            <Kpi label="Purchases" value={a.phBuy} change={compare(a.phBuy, b.phBuy)} goodWhen="down" href={withRange("/pharmacy?tab=purchases", from, to)} />
            <Kpi label={`Profit${a.phPct === null ? "" : ` · ${a.phPct.toFixed(1)}%`}`} value={a.phProfit} change={compare(a.phProfit, b.phProfit)} emphasis />
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs muted">
        Wellness: the partner&apos;s revenue share and wellness salaries are booked as hospital expenses (department Wellness). Wellness package receipts are manual and not recorded here.
      </p>
    </Section>
  );
}

