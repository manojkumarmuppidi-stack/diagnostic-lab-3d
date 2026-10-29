"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Department accounts: collapsible sections, the grouping of income and cost lines, and the insights
 * and graphs for one department and for all departments. Everything here is worked out from the
 * statement the server already sent; nothing is fetched.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
import { mLabel } from "@/lib/entities";
import { formatINR, formatINRCompact } from "@/lib/money";
import { BarsChart, ChartCard, DonutChart, SLOT, TrendChart } from "@/components/charts/Charts";

/** Column heading: "Oct 2026" for a month, "5 Oct" for a day. */
export const colLabel = (k: string) => (k.length > 7 ? `${Number(k.slice(8))} ${mLabel(k.slice(0, 7)).split(" ")[0]}` : mLabel(k));

/** A card whose body opens and closes, so the page stays short. */
export function Section({
  title,
  subtitle,
  defaultOpen = false,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button type="button" className="flex min-w-0 items-start gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            <span className="block text-sm font-semibold">{title}</span>
            {subtitle && <span className="block text-xs muted">{subtitle}</span>}
          </span>
        </button>
        {open && actions}
      </header>
      {open && (
        <div className="border-t px-4 py-4" style={{ borderColor: "var(--border)" }}>
          {children}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────── grouping ───────────────────────────

export interface LineGroup {
  key: string;
  label: string;
  lines: any[];
  byMonth: Record<string, number>;
  total: number;
  count: number;
}

const SOURCE_LABELS: Record<string, string> = {
  PHARMACY: "Injections — margin",
  LAB: "Tests",
  OPD: "Consultations",
  SCP: "Sugar control plans & short admissions",
  IPD: "Admissions",
  DIET: "Diet",
  OTHER: "Packages & other income",
};

function group(lines: any[], keyOf: (l: any) => [string, string], value: (l: any) => number): LineGroup[] {
  const groups = new Map<string, LineGroup>();
  for (const l of lines) {
    const [key, label] = keyOf(l);
    const g: LineGroup = groups.get(key) ?? { key, label, lines: [], byMonth: {}, total: 0, count: 0 };
    g.lines.push(l);
    g.total += value(l);
    g.count += l.count ?? 0;
    for (const [m, v] of Object.entries(l.byMonth as Record<string, number>)) g.byMonth[m] = (g.byMonth[m] ?? 0) + v;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

/** Income lines by source (packages, injections, tests …). */
export const incomeGroups = (lines: any[]) =>
  group(
    lines,
    (l) => {
      const key = l.stream === "OPD" && /per bill\)$/.test(l.name) ? "OPD-share" : l.stream;
      return [key, key === "OPD-share" ? "Wellness share of combined consultation bills" : (SOURCE_LABELS[l.stream] ?? l.stream)];
    },
    (l) => l.total,
  );

/** Cost lines by kind: salaries, incentives, space & utilities, other. */
export function costCategory(label: string): [string, string] {
  if (/^salary/i.test(label)) return ["salaries", "Salaries"];
  if (/incentive/i.test(label)) return ["incentives", "Incentives"];
  if (/first-floor|space|rent|electric|power|water|maintenance/i.test(label)) return ["space", "Space, rent & utilities"];
  return ["other", "Other costs"];
}
export const costGroups = (lines: any[]) =>
  group(
    lines,
    (l) => costCategory(l.label),
    (l) => l.total,
  );

// ─────────────────────────── insights ───────────────────────────

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(0)}%`;

function Insights({ items }: { items: { tone: "good" | "bad" | "info"; text: ReactNode }[] }) {
  if (!items.length) return <p className="text-sm muted">Not enough data in this period for insights.</p>;
  const color = { good: "var(--status-good)", bad: "var(--status-bad)", info: "var(--series-1)" };
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" style={{ color: color[it.tone] }} />
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Plain-language findings for one department's statement. */
export function departmentInsights(st: any, months: string[], partner?: any) {
  const out: { tone: "good" | "bad" | "info"; text: ReactNode }[] = [];
  const active = months.filter((m) => (st.income[m] ?? 0) || (st.costs[m] ?? 0));
  if (!active.length) return out;
  const t = st.totals;
  out.push({
    tone: t.profit >= 0 ? "good" : "bad",
    text: (
      <>
        {t.profit >= 0 ? "Made" : "Lost"} <b>{formatINR(Math.abs(t.profit))}</b> in the period: income {formatINR(t.income)}, costs {formatINR(t.costs)}
        {t.income ? (
          <>
            {" "}
            — {fmtPct(pct(t.profit, t.income))} margin, ₹{Math.round(pct(t.costs, t.income))} of cost for every ₹100 earned
          </>
        ) : null}
        .
      </>
    ),
  });
  const byProfit = [...active].sort((a, b) => (st.profit[b] ?? 0) - (st.profit[a] ?? 0));
  if (active.length > 1)
    out.push({
      tone: "info",
      text: (
        <>
          Best month <b>{colLabel(byProfit[0])}</b> ({formatINR(st.profit[byProfit[0]] ?? 0)}); weakest <b>{colLabel(byProfit[byProfit.length - 1])}</b> (
          {formatINR(st.profit[byProfit[byProfit.length - 1]] ?? 0)}).
        </>
      ),
    });
  const losses = active.filter((m) => (st.profit[m] ?? 0) < 0);
  if (losses.length)
    out.push({
      tone: "bad",
      text: (
        <>
          Loss in {losses.length} month{losses.length === 1 ? "" : "s"}: {losses.map(colLabel).join(", ")}.
        </>
      ),
    });
  // Latest full month against the average of the months before it.
  if (active.length >= 3) {
    const last = active[active.length - 1];
    const before = active.slice(0, -1);
    const avg = before.reduce((a, m) => a + (st.income[m] ?? 0), 0) / before.length;
    const change = pct((st.income[last] ?? 0) - avg, avg);
    if (avg && Math.abs(change) >= 10)
      out.push({
        tone: change > 0 ? "good" : "bad",
        text: (
          <>
            Income in <b>{colLabel(last)}</b> is {fmtPct(Math.abs(change))} {change > 0 ? "above" : "below"} the average of the earlier months (
            {formatINRCompact(st.income[last] ?? 0)} vs {formatINRCompact(avg)}){last === months[months.length - 1] ? " — the latest month may still be incomplete" : ""}.
          </>
        ),
      });
  }
  const inc = incomeGroups(st.incomeLines);
  if (inc.length && t.income)
    out.push({
      tone: "info",
      text: (
        <>
          Biggest income source: <b>{inc[0].label}</b> — {fmtPct(pct(inc[0].total, t.income))} of income ({formatINR(inc[0].total)}).
        </>
      ),
    });
  const cg = costGroups(st.costLines);
  if (cg.length && t.costs)
    out.push({
      tone: "info",
      text: (
        <>
          Biggest cost: <b>{cg[0].label}</b> — {fmtPct(pct(cg[0].total, t.costs))} of costs ({formatINR(cg[0].total)}).
        </>
      ),
    });
  if (!st.costsEntered) out.push({ tone: "bad", text: <>No costs entered yet, so the profit here is income only. Add its salaries, rent share and other costs.</> });
  if (partner && partner.totals.share)
    out.push({
      tone: "info",
      text: (
        <>
          {partner.name}&apos;s {partner.pct}% share for the period: <b>{formatINR(partner.totals.share)}</b>; AED keeps {formatINR(partner.totals.aed)}.
        </>
      ),
    });
  return out;
}

/** Insights and graphs for one department, each in its own dropdown. */
export function DepartmentInsights({ st, months, partner }: { st: any; months: string[]; partner?: any }) {
  const rows = months.map((m) => ({
    period: colLabel(m),
    income: st.income[m] ?? 0,
    costs: st.costs[m] ?? 0,
    profit: st.profit[m] ?? 0,
    margin: st.income[m] ? Math.round(pct(st.profit[m] ?? 0, st.income[m])) : 0,
  }));
  const inc = incomeGroups(st.incomeLines).map((g, i) => ({ name: g.label, value: Math.round(g.total), color: SLOT(i) }));
  const cost = costGroups(st.costLines).map((g, i) => ({ name: g.label, value: Math.round(g.total), color: SLOT(i + 3) }));
  const items = departmentInsights(st, months, partner);
  return (
    <>
      <Section title={`Insights — ${st.name}`} subtitle={`${items.length} findings for the period`} defaultOpen>
        <Insights items={items} />
      </Section>
      <Section title="Graph: income and costs, month by month" subtitle="Is the department covering its costs every month?">
        <ChartCard
          title="Income vs costs"
          height={300}
          table={{
            columns: [
              { key: "period", label: "Period", format: "text" },
              { key: "income", label: "Income", format: "money" },
              { key: "costs", label: "Costs", format: "money" },
              { key: "profit", label: "Profit", format: "money" },
            ],
            rows,
          }}
        >
          <BarsChart
            data={rows}
            xKey="period"
            series={[
              { key: "income", label: "Income", color: SLOT(0) },
              { key: "costs", label: "Costs", color: SLOT(3) },
            ]}
          />
        </ChartCard>
      </Section>
      <Section title="Graph: profit and margin trend" subtitle="Profit each period, and profit as a % of income">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Profit"
            height={260}
            table={{
              columns: [
                { key: "period", label: "Period", format: "text" },
                { key: "profit", label: "Profit", format: "money" },
              ],
              rows,
            }}
          >
            <BarsChart
              data={rows}
              xKey="period"
              series={[{ key: "profit", label: "Profit", color: SLOT(1) }]}
              colorByRow={(r) => (Number(r.profit) < 0 ? "var(--status-bad)" : SLOT(1))}
            />
          </ChartCard>
          <ChartCard
            title="Margin %"
            height={260}
            table={{
              columns: [
                { key: "period", label: "Period", format: "text" },
                { key: "margin", label: "Margin %", format: "int" },
              ],
              rows,
            }}
          >
            <TrendChart data={rows} xKey="period" format="int" series={[{ key: "margin", label: "Margin %", color: SLOT(2) }]} />
          </ChartCard>
        </div>
      </Section>
      <Section title="Graph: where the income comes from, and where it goes" subtitle="Income by source and costs by kind for the period">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Income by source"
            height={240}
            table={{
              columns: [
                { key: "name", label: "Source", format: "text" },
                { key: "value", label: "Income", format: "money" },
              ],
              rows: inc,
            }}
          >
            {inc.length ? <DonutChart data={inc} /> : <p className="text-sm muted">No income in this period.</p>}
          </ChartCard>
          <ChartCard
            title="Costs by kind"
            height={240}
            table={{
              columns: [
                { key: "name", label: "Kind", format: "text" },
                { key: "value", label: "Costs", format: "money" },
              ],
              rows: cost,
            }}
          >
            {cost.length ? <DonutChart data={cost} /> : <p className="text-sm muted">No costs in this period.</p>}
          </ChartCard>
        </div>
      </Section>
      {partner && (
        <Section title={`Graph: ${partner.name} ${partner.pct}% share and what AED keeps`} subtitle="Month by month">
          {(() => {
            const pr = months.map((m) => ({ period: colLabel(m), share: partner.share[m] ?? 0, aed: Math.round((partner.profit[m] ?? 0) - (partner.share[m] ?? 0)) }));
            return (
              <ChartCard
                title={`${partner.name} share vs AED`}
                height={280}
                table={{
                  columns: [
                    { key: "period", label: "Period", format: "text" },
                    { key: "share", label: `${partner.name} share`, format: "money" },
                    { key: "aed", label: "AED keeps", format: "money" },
                  ],
                  rows: pr,
                }}
              >
                <BarsChart
                  data={pr}
                  xKey="period"
                  stacked
                  series={[
                    { key: "aed", label: "AED keeps", color: SLOT(0) },
                    { key: "share", label: `${partner.name} share`, color: SLOT(4) },
                  ]}
                />
              </ChartCard>
            );
          })()}
        </Section>
      )}
    </>
  );
}

/** Findings and graphs comparing every department. */
export function AllDepartmentsInsights({ data }: { data: any }) {
  const sts = data.statements.filter((s: any) => s.totals.income || s.totals.costs);
  const items: { tone: "good" | "bad" | "info"; text: ReactNode }[] = [];
  if (sts.length) {
    // Only departments with their costs entered are compared on profit; the rest would look better than they are.
    const withCosts = sts.filter((s: any) => s.costsEntered && s.totals.income);
    if (withCosts.length) {
      const byProfit = [...withCosts].sort((a: any, b: any) => b.totals.profit - a.totals.profit);
      items.push({
        tone: "good",
        text: (
          <>
            Most profitable (with costs entered): <b>{byProfit[0].name}</b> ({formatINR(byProfit[0].totals.profit)}).
          </>
        ),
      });
      const byMargin = [...withCosts].sort((a: any, b: any) => (a.marginPct ?? 0) - (b.marginPct ?? 0));
      items.push({
        tone: "info",
        text: (
          <>
            Lowest margin (with costs entered): <b>{byMargin[0].name}</b> ({fmtPct(byMargin[0].marginPct ?? 0)}).
          </>
        ),
      });
    }
    const losing = sts.filter((s: any) => s.totals.profit < 0);
    if (losing.length) items.push({ tone: "bad", text: <>Making a loss: {losing.map((s: any) => `${s.name} (${formatINR(s.totals.profit)})`).join(", ")}.</> });
    const noCosts = sts.filter((s: any) => !s.costsEntered);
    if (noCosts.length)
      items.push({
        tone: "bad",
        text: <>No costs entered yet for {noCosts.map((s: any) => s.name).join(", ")} — their profit is income only, so they look better than they are.</>,
      });
    const income = sts.reduce((a: number, s: any) => a + s.totals.income, 0);
    const top = [...sts].sort((a: any, b: any) => b.totals.income - a.totals.income)[0];
    if (income)
      items.push({
        tone: "info",
        text: (
          <>
            Largest income: <b>{top.name}</b> — {fmtPct(pct(top.totals.income, income))} of all department income.
          </>
        ),
      });
  }
  const rows = data.statements.map((s: any) => ({ name: s.name, income: Math.round(s.totals.income), costs: Math.round(s.totals.costs), profit: Math.round(s.totals.profit) }));
  return (
    <>
      <Section title="Insights — all departments" subtitle="Which departments are doing well, and which need attention" defaultOpen>
        <Insights items={items} />
      </Section>
      <Section title="Graph: profit by department" subtitle="For the period, before hospital-wide common costs">
        <ChartCard
          title="Profit by department"
          height={Math.max(240, rows.length * 34)}
          table={{
            columns: [
              { key: "name", label: "Department", format: "text" },
              { key: "profit", label: "Profit", format: "money" },
            ],
            rows,
          }}
        >
          <BarsChart
            data={rows}
            xKey="name"
            horizontal
            series={[{ key: "profit", label: "Profit", color: SLOT(1) }]}
            colorByRow={(r) => (Number(r.profit) < 0 ? "var(--status-bad)" : SLOT(1))}
          />
        </ChartCard>
      </Section>
      <Section title="Graph: income and costs by department">
        <ChartCard
          title="Income vs costs by department"
          height={Math.max(260, rows.length * 44)}
          table={{
            columns: [
              { key: "name", label: "Department", format: "text" },
              { key: "income", label: "Income", format: "money" },
              { key: "costs", label: "Costs", format: "money" },
            ],
            rows,
          }}
        >
          <BarsChart
            data={rows}
            xKey="name"
            horizontal
            series={[
              { key: "income", label: "Income", color: SLOT(0) },
              { key: "costs", label: "Costs", color: SLOT(3) },
            ]}
          />
        </ChartCard>
      </Section>
    </>
  );
}
