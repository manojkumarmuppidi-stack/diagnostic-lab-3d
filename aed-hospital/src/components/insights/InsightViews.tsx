"use client";
/**
 * Insight & comparison building blocks shared by module pages and the Board Meeting pack.
 * Charts follow the app's data-viz rules: one axis, current period in the brand series
 * colour vs previous period in a muted neutral, entity colours fixed by name (never by
 * rank), legends always shown, a table view for every chart, click to drill down.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, Lightbulb, Minus, PieChart as PieIcon, Table2, TrendingDown, TrendingUp, Info } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compare } from "@/lib/accounting";
import { fmtValue, type Comparison, type Insight, type KpiCompare, type Unit } from "@/lib/insights";
import { formatPct } from "@/lib/money";
import { cn } from "@/lib/client";
import { STREAM_COLORS } from "../charts/Charts";

const axisStyle = { fontSize: 11, fill: "var(--text-3)" };
const SLOTS = 8;

/** Colour follows the entity: slots are assigned by sorted key, so a filter never repaints survivors. */
export function colorMap(keys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  const known = keys.filter((k) => STREAM_COLORS[k]);
  for (const k of known) m.set(k, STREAM_COLORS[k]);
  [...keys.filter((k) => !STREAM_COLORS[k])].sort().forEach((k, i) => m.set(k, i < SLOTS ? `var(--series-${i + 1})` : "var(--text-3)"));
  return m;
}

// ─────────────────────────── KPI with comparison ───────────────────────────

export function KpiCompareCard({ k, prevLabel, big, present }: { k: KpiCompare; prevLabel: string; big?: boolean; present?: boolean }) {
  const c = k.current !== null && k.previous !== null ? compare(k.current, k.previous) : null;
  const isPct = k.unit === "pct";
  const diff = c ? c.diff : 0;
  const good = !c || diff === 0 || k.goodWhen === "none" ? null : (diff > 0) === (k.goodWhen !== "down");
  const Icon = !c || diff === 0 ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const color = good === null ? "var(--text-3)" : good ? "var(--good)" : "var(--bad)";
  const change = !c ? "—" : isPct ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)} pts` : c.pct === null ? (k.current ? "new" : "—") : formatPct(c.pct);
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border p-4", present ? "kpi-present" : "card")} style={present ? undefined : undefined}>
      <p className={cn("font-medium", present ? "text-[13px] uppercase tracking-[0.12em] text-2" : "text-xs text-2")}>{k.label}</p>
      <p className={cn("mt-1 font-semibold tabular-nums tracking-tight", big ? "text-3xl sm:text-4xl" : "text-2xl")} style={k.key === "netOperatingResult" && (k.current ?? 0) < 0 ? { color: "var(--bad)" } : undefined}>
        {fmtValue(k.current, k.unit, !big)}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs">
        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {change}
        </span>
        <span className="muted">
          vs {fmtValue(k.previous, k.unit)} · {prevLabel}
        </span>
      </div>
    </div>
  );
}

export function KpiCompareGrid({ kpis, prevLabel, cols = "grid-cols-2 md:grid-cols-3 xl:grid-cols-6", present }: { kpis: KpiCompare[]; prevLabel: string; cols?: string; present?: boolean }) {
  return (
    <div className={cn("grid gap-3", cols)}>
      {kpis.map((k) => (
        <KpiCompareCard key={k.key} k={k} prevLabel={prevLabel} present={present} />
      ))}
    </div>
  );
}

// ─────────────────────────── insights ───────────────────────────

const TONE = {
  positive: { icon: TrendingUp, color: "var(--status-good)", label: "Positive" },
  negative: { icon: TrendingDown, color: "var(--status-critical)", label: "Needs attention" },
  neutral: { icon: Info, color: "var(--series-1)", label: "Observation" },
};

export function InsightList({ insights, empty = "No significant changes versus the comparison period.", present, limit }: { insights: Insight[]; empty?: string; present?: boolean; limit?: number }) {
  const list = limit ? insights.slice(0, limit) : insights;
  if (!list.length) return <p className="text-sm muted">{empty}</p>;
  return (
    <ul className={cn("grid gap-2", present ? "sm:grid-cols-2" : "")}>
      {list.map((i) => {
        const t = TONE[i.tone];
        const body = (
          <div className={cn("flex h-full items-start gap-3 rounded-xl border p-3", present ? "insight-present" : "")} style={{ borderColor: "var(--border)", borderLeft: `4px solid ${t.color}` }}>
            <t.icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: t.color }} aria-label={t.label} />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-snug">{i.headline}</p>
              <p className="mt-0.5 text-xs text-2">{i.detail}</p>
            </div>
          </div>
        );
        return <li key={i.id}>{i.href ? <Link href={i.href}>{body}</Link> : body}</li>;
      })}
    </ul>
  );
}

// ─────────────────────────── charts ───────────────────────────

function TooltipBox({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string; payload?: Record<string, unknown> }[]; label?: string; unit: Unit }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as { current?: number; previous?: number } | undefined;
  const c = row && typeof row.current === "number" && typeof row.previous === "number" ? compare(row.current, row.previous) : null;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg" style={{ minWidth: 170 }}>
      {label !== undefined && <p className="mb-1 font-semibold">{label}</p>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-2">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-medium tabular-nums">{fmtValue(Number(p.value), unit, false)}</span>
        </div>
      ))}
      {c && payload.length > 1 && (
        <div className="mt-1 border-t pt-1 text-2" style={{ borderColor: "var(--border)" }}>
          Change {c.diff > 0 ? "+" : ""}
          {fmtValue(c.diff, unit, false)} {c.pct !== null ? `(${formatPct(c.pct)})` : ""}
        </div>
      )}
    </div>
  );
}

/** Horizontal grouped bars: current (brand colour) vs previous (muted), names on the axis. */
export function ComparisonBars({ c, curLabel, prevLabel, onSelect }: { c: Comparison; curLabel: string; prevLabel: string; onSelect?: (key: string) => void }) {
  const rows = c.rows.filter((r) => r.current || r.previous);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtValue(v, c.unit)} />
        <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={130} interval={0} />
        <Tooltip content={<TooltipBox unit={c.unit} />} cursor={{ fill: "color-mix(in srgb, var(--text-3) 10%, transparent)" }} />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-2)" }} iconType="square" formatter={(v: string) => <span style={{ color: "var(--text-2)" }}>{v}</span>} />
        <Bar dataKey="previous" name={prevLabel} fill="var(--prev-bar)" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} onClick={(d: { payload?: { key: string } }) => d.payload && onSelect?.(d.payload.key)} style={{ cursor: onSelect ? "pointer" : undefined }} />
        <Bar dataKey="current" name={curLabel} fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} onClick={(d: { payload?: { key: string } }) => d.payload && onSelect?.(d.payload.key)} style={{ cursor: onSelect ? "pointer" : undefined }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Pie of the current period's share; small slices fold into "Other" (max 7 slices). */
export function SharePie({ c, onSelect, which = "current" }: { c: Comparison; onSelect?: (key: string) => void; which?: "current" | "previous" }) {
  const data = useMemo(() => {
    const rows = c.rows.map((r) => ({ key: r.key, name: r.name, value: Math.max(0, r[which]) })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const head = rows.slice(0, 6);
    const rest = rows.slice(6).reduce((a, r) => a + r.value, 0);
    return rest > 0 ? [...head, { key: "__other", name: "Other", value: rest }] : head;
  }, [c.rows, which]);
  // Colours come from the whole row set (sorted by key), not the displayed rank, so they stay stable.
  const colors = useMemo(() => colorMap(c.rows.filter((r) => r.current > 0 || r.previous > 0).slice(0, 8).map((r) => r.key)), [c.rows]);
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <p className="py-10 text-center text-sm muted">No data</p>;
  return (
    <div className="flex h-full flex-col items-center gap-3 sm:flex-row">
      <div className="h-[190px] w-full sm:h-full sm:w-[40%]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="0%" outerRadius="92%" stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} onClick={(d: { key?: string }) => d.key && d.key !== "__other" && onSelect?.(d.key)} style={{ cursor: onSelect ? "pointer" : undefined }}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.key === "__other" ? "var(--other-slice)" : colors.get(d.key) ?? "var(--other-slice)"} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox unit={c.unit} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1 text-sm sm:w-[60%]">
        {data.map((d) => (
          <li key={d.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.key === "__other" ? "var(--other-slice)" : colors.get(d.key) ?? "var(--other-slice)" }} />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <b>{((d.value / total) * 100).toFixed(1)}%</b> <span className="text-xs muted">{fmtValue(d.value, c.unit)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonTable({ c, curLabel, prevLabel }: { c: Comparison; curLabel: string; prevLabel: string }) {
  const totCur = c.rows.reduce((a, r) => a + r.current, 0);
  const totPrev = c.rows.reduce((a, r) => a + r.previous, 0);
  return (
    <div className="max-h-[340px] overflow-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{c.noun[0].toUpperCase() + c.noun.slice(1)}</th>
            <th className="num">{curLabel}</th>
            <th className="num">{prevLabel}</th>
            <th className="num">Change</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => {
            const d = compare(r.current, r.previous);
            return (
              <tr key={r.key}>
                <td>{r.name}</td>
                <td className="num">{fmtValue(r.current, c.unit, false)}</td>
                <td className="num muted">{fmtValue(r.previous, c.unit, false)}</td>
                <td className="num">{d.pct === null ? (r.current ? "new" : "—") : formatPct(d.pct)}</td>
                <td className="num">{totCur ? `${((r.current / totCur) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            );
          })}
          <tr className="font-semibold">
            <td>Total</td>
            <td className="num">{fmtValue(totCur, c.unit, false)}</td>
            <td className="num">{fmtValue(totPrev, c.unit, false)}</td>
            <td className="num">{compare(totCur, totPrev).pct === null ? "—" : formatPct(compare(totCur, totPrev).pct)}</td>
            <td className="num">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type View = "both" | "bars" | "pie" | "table";

/** Card with comparison bars + share pie side by side, plus a table view. */
export function ComparisonCard({ c, curLabel, prevLabel, defaultView = "both", present }: { c: Comparison; curLabel: string; prevLabel: string; defaultView?: View; present?: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View>(defaultView);
  const nonEmpty = c.rows.filter((r) => r.current || r.previous);
  const onSelect = c.href ? (key: string) => router.push(c.href!.replace("{key}", encodeURIComponent(key))) : undefined;
  const barsH = Math.max(200, nonEmpty.length * 38 + 60);
  const btn = (v: View, Icon: typeof BarChart3, label: string) => (
    <button key={v} onClick={() => setView(v)} aria-pressed={view === v} title={label} className={cn("rounded-md p-1.5 transition", view === v ? "shadow-sm" : "opacity-60 hover:opacity-100")} style={view === v ? { background: "var(--surface-2)" } : undefined}>
      <Icon className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
  return (
    <section className={cn("flex flex-col rounded-2xl border", present ? "panel-present" : "card")}>
      <header className="flex items-center justify-between gap-2 px-4 pt-3">
        <h3 className="text-sm font-semibold">{c.title}</h3>
        <div className="flex items-center gap-0.5 no-print">
          {btn("both", Lightbulb, "Bars and pie")}
          {btn("bars", BarChart3, "Comparison bars")}
          {btn("pie", PieIcon, "Share pie")}
          {btn("table", Table2, "Table")}
        </div>
      </header>
      <div className="p-3">
        {!nonEmpty.length ? (
          <p className="py-10 text-center text-sm muted">No activity in either period</p>
        ) : view === "table" ? (
          <ComparisonTable c={c} curLabel={curLabel} prevLabel={prevLabel} />
        ) : view === "pie" ? (
          <div style={{ height: 240 }}>
            <SharePie c={c} onSelect={onSelect} />
          </div>
        ) : view === "bars" ? (
          <div style={{ height: barsH }}>
            <ComparisonBars c={c} curLabel={curLabel} prevLabel={prevLabel} onSelect={onSelect} />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3" style={{ height: barsH }}>
              <ComparisonBars c={c} curLabel={curLabel} prevLabel={prevLabel} onSelect={onSelect} />
            </div>
            <div className="lg:col-span-2" style={{ minHeight: 220 }}>
              <p className="mb-1 text-xs muted">Share of {curLabel.toLowerCase()}</p>
              <div style={{ height: Math.max(220, barsH - 30) }}>
                <SharePie c={c} onSelect={onSelect} />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export interface SectionData {
  key: string;
  title: string;
  kpis: KpiCompare[];
  comparisons: Comparison[];
  insights: Insight[];
  /** Laboratory only: every test with count and amount, both periods. */
  labTests?: { key: string; name: string; tests: number; prevTests: number; amount: number; prevAmount: number }[];
}

/** Full insight section: KPI deltas, key findings, then every breakdown as bars + pie. */
export function SectionView({ s, curLabel, prevLabel, compact }: { s: SectionData; curLabel: string; prevLabel: string; compact?: boolean }) {
  return (
    <div className="space-y-4">
      <KpiCompareGrid kpis={s.kpis} prevLabel={prevLabel} />
      <div className="card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="h-4 w-4" style={{ color: "var(--status-warning)" }} /> Key insights · {curLabel} vs {prevLabel}
        </h3>
        <InsightList insights={s.insights} limit={compact ? 4 : undefined} />
      </div>
      <div className="grid gap-4">
        {(compact ? s.comparisons.slice(0, 2) : s.comparisons).map((c) => (
          <ComparisonCard key={c.id} c={c} curLabel={curLabel} prevLabel={prevLabel} />
        ))}
      </div>
    </div>
  );
}
