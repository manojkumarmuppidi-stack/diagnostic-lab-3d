/**
 * Insight engine: turns "current vs previous" figures into plain-English findings
 * for dashboards and the board-meeting pack. Pure functions — unit tested.
 * Every insight states the numbers it is based on, so it can be checked.
 */
import { compare, pctOf } from "./accounting";
import { formatINR, formatINRCompact, formatNumber } from "./money";

export type Unit = "money" | "int" | "pct";
export type Tone = "positive" | "negative" | "neutral";

export interface KpiCompare {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  unit: Unit;
  /** Is an increase good ("up"), bad ("down") or neither? */
  goodWhen?: "up" | "down" | "none";
}

export interface ComparisonRow {
  key: string;
  name: string;
  current: number;
  previous: number;
}

export interface Comparison {
  id: string;
  title: string;
  unit: Unit;
  /** What one row is ("specialty", "investigation" …) — used in insight wording. */
  noun: string;
  rows: ComparisonRow[];
  goodWhen?: "up" | "down" | "none";
  /** Drill-down link template; "{key}" is replaced by the row key. */
  href?: string;
}

export interface Insight {
  id: string;
  tone: Tone;
  headline: string;
  detail: string;
  /** Larger = more important; used for ordering. */
  weight: number;
  href?: string;
}

export function fmtValue(v: number | null | undefined, unit: Unit, compact = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (unit === "money") return compact ? formatINRCompact(v) : formatINR(v);
  if (unit === "pct") return `${v.toFixed(1)}%`;
  return formatNumber(v);
}

function toneFor(diff: number, goodWhen: "up" | "down" | "none" = "up"): Tone {
  if (diff === 0 || goodWhen === "none") return "neutral";
  return (diff > 0) === (goodWhen === "up") ? "positive" : "negative";
}

const pctText = (p: number | null) => (p === null ? "" : `${p > 0 ? "+" : ""}${p.toFixed(1)}%`);

/** Headline movements of the top-line KPIs. */
export function insightsFromKpis(kpis: KpiCompare[], prevLabel: string, minPct = 5): Insight[] {
  const out: Insight[] = [];
  for (const k of kpis) {
    if (k.current === null || k.previous === null) continue;
    const c = compare(k.current, k.previous);
    if (k.unit === "pct") {
      const pts = Math.round((k.current - k.previous) * 10) / 10;
      if (Math.abs(pts) < 1) continue;
      out.push({
        id: `kpi-${k.key}`,
        tone: toneFor(pts, k.goodWhen),
        headline: `${k.label} ${pts > 0 ? "up" : "down"} ${Math.abs(pts).toFixed(1)} pts`,
        detail: `${fmtValue(k.current, "pct")} vs ${fmtValue(k.previous, "pct")} in ${prevLabel}.`,
        weight: Math.abs(pts) * 2,
      });
      continue;
    }
    if (c.pct === null) {
      if (k.current !== 0) {
        out.push({ id: `kpi-${k.key}`, tone: toneFor(c.diff, k.goodWhen), headline: `${k.label}: ${fmtValue(k.current, k.unit)} (none in ${prevLabel})`, detail: `No comparable figure in ${prevLabel}, so no % change is shown.`, weight: 5 });
      }
      continue;
    }
    if (Math.abs(c.pct) < minPct) continue;
    out.push({
      id: `kpi-${k.key}`,
      tone: toneFor(c.diff, k.goodWhen),
      headline: `${k.label} ${c.diff > 0 ? "up" : "down"} ${Math.abs(c.pct).toFixed(1)}%`,
      detail: `${fmtValue(k.current, k.unit)} vs ${fmtValue(k.previous, k.unit)} in ${prevLabel} (${c.diff > 0 ? "+" : "−"}${fmtValue(Math.abs(c.diff), k.unit)}).`,
      weight: Math.min(100, Math.abs(c.pct)) * (k.key === "totalIncome" || k.key === "netOperatingResult" ? 1.6 : 1),
    });
  }
  return out;
}

/** Biggest riser, biggest faller, concentration and mix shift inside one breakdown. */
export function insightsFromComparison(c: Comparison, prevLabel: string): Insight[] {
  const out: Insight[] = [];
  const rows = c.rows.filter((r) => r.current !== 0 || r.previous !== 0);
  if (rows.length < 2) return out;
  const totalCur = rows.reduce((a, r) => a + r.current, 0);
  const totalPrev = rows.reduce((a, r) => a + r.previous, 0);
  const link = (r: ComparisonRow) => (c.href ? c.href.replace("{key}", encodeURIComponent(r.key)) : undefined);
  const diffs = rows.map((r) => ({ r, d: r.current - r.previous, p: compare(r.current, r.previous).pct }));
  const riser = [...diffs].sort((a, b) => b.d - a.d)[0];
  const faller = [...diffs].sort((a, b) => a.d - b.d)[0];
  const scale = Math.max(1, Math.abs(totalPrev) || Math.abs(totalCur));

  if (riser && riser.d > 0) {
    out.push({
      id: `${c.id}-riser`,
      tone: toneFor(riser.d, c.goodWhen),
      headline: `${riser.r.name} led the growth in ${c.title.toLowerCase()}`,
      detail: `${riser.d > 0 ? "+" : ""}${fmtValue(riser.d, c.unit)}${riser.p !== null ? ` (${pctText(riser.p)})` : " (new this period)"}: ${fmtValue(riser.r.current, c.unit)} vs ${fmtValue(riser.r.previous, c.unit)} in ${prevLabel}.`,
      weight: (Math.abs(riser.d) / scale) * 60,
      href: link(riser.r),
    });
  }
  if (faller && faller.d < 0) {
    out.push({
      id: `${c.id}-faller`,
      tone: toneFor(faller.d, c.goodWhen),
      headline: `${faller.r.name} declined the most`,
      detail: `${fmtValue(faller.d, c.unit)}${faller.p !== null ? ` (${pctText(faller.p)})` : ""}: ${fmtValue(faller.r.current, c.unit)} vs ${fmtValue(faller.r.previous, c.unit)} in ${prevLabel}.`,
      weight: (Math.abs(faller.d) / scale) * 60,
      href: link(faller.r),
    });
  }
  if (totalCur > 0) {
    const top = [...rows].sort((a, b) => b.current - a.current)[0];
    const share = pctOf(top.current, totalCur) ?? 0;
    if (share >= 45) {
      out.push({
        id: `${c.id}-concentration`,
        tone: "neutral",
        headline: `${top.name} is ${share.toFixed(0)}% of ${c.title.toLowerCase()}`,
        detail: `High dependence on one ${c.noun}: ${fmtValue(top.current, c.unit)} of ${fmtValue(totalCur, c.unit)}.`,
        weight: share / 4,
        href: link(top),
      });
    }
  }
  if (totalCur > 0 && totalPrev > 0) {
    const shifts = rows
      .map((r) => ({ r, pts: ((r.current / totalCur) - (r.previous / totalPrev)) * 100 }))
      .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
    const s = shifts[0];
    if (s && Math.abs(s.pts) >= 3) {
      out.push({
        id: `${c.id}-mix`,
        tone: "neutral",
        headline: `Mix shift: ${s.r.name} ${s.pts > 0 ? "gained" : "lost"} ${Math.abs(s.pts).toFixed(1)} pts of share`,
        detail: `Now ${((s.r.current / totalCur) * 100).toFixed(1)}% of ${c.title.toLowerCase()}, was ${((s.r.previous / totalPrev) * 100).toFixed(1)}%.`,
        weight: Math.abs(s.pts),
        href: link(s.r),
      });
    }
  }
  const dropped = rows.filter((r) => r.previous > 0 && r.current === 0);
  if (dropped.length) {
    out.push({
      id: `${c.id}-dropped`,
      tone: c.goodWhen === "down" ? "positive" : "negative",
      headline: `${dropped.length} ${c.noun}${dropped.length > 1 ? "s" : ""} had activity before but none now`,
      detail: dropped.slice(0, 4).map((r) => r.name).join(", ") + (dropped.length > 4 ? "…" : ""),
      weight: 8 + dropped.length,
    });
  }
  return out;
}

/** Cross-metric findings that need two figures together. */
export function crossInsights(x: {
  incomeCur: number;
  incomePrev: number;
  expenseCur: number;
  expensePrev: number;
  prevLabel: string;
}): Insight[] {
  const out: Insight[] = [];
  const ip = compare(x.incomeCur, x.incomePrev).pct;
  const ep = compare(x.expenseCur, x.expensePrev).pct;
  if (ip !== null && ep !== null && Math.abs(ep - ip) >= 5) {
    const worse = ep > ip;
    out.push({
      id: "cross-cost-vs-revenue",
      tone: worse ? "negative" : "positive",
      headline: worse ? "Costs are growing faster than revenue" : "Revenue is growing faster than costs",
      detail: `Expenses ${pctText(ep)} vs income ${pctText(ip)} compared with ${x.prevLabel}.`,
      weight: Math.min(60, Math.abs(ep - ip) * 1.5),
    });
  }
  if (x.incomeCur > 0 && x.expenseCur > x.incomeCur) {
    out.push({
      id: "cross-loss",
      tone: "negative",
      headline: "Operating loss this period",
      detail: `Expenses ${fmtValue(x.expenseCur, "money")} exceed income ${fmtValue(x.incomeCur, "money")}.`,
      weight: 80,
    });
  }
  return out;
}

export function rankInsights(list: Insight[], max = 8): Insight[] {
  const seen = new Set<string>();
  return list
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);
}
