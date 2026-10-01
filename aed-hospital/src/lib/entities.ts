/**
 * Two businesses, two sets of books:
 *  - AED Hospital: consultations (OPD), laboratory, IPD — plus diet and other hospital income.
 *  - Hormonal Pharmacy: a separate entity. Income = pharmacy sales net of returns; expenses = stock
 *    purchases plus any expense tagged to the Pharmacy department.
 * Pure helpers (no database) so the P&L arithmetic and the insights are unit tested.
 */
import { formatINRCompact } from "./money";

export type EntityKey = "AED" | "HP";
export const ENTITY_LABELS: Record<EntityKey, string> = { AED: "AED Hospital", HP: "Hormonal Pharmacy" };
export const ENTITY_SCOPE: Record<EntityKey, string> = {
  AED: "Consultations (OPD), Laboratory, IPD — with diet and other hospital income",
  HP: "Pharmacy sales net of returns; stock purchases and pharmacy-department expenses",
};
export const AED_STREAMS = ["OPD", "LAB", "IPD", "DIET", "OTHER"] as const;

export interface EntityMonth {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
  profit: number;
  marginPct: number | null;
  /** Expenses recorded but no income at all: the month is incomplete, not a real loss. */
  incomeMissing: boolean;
  byStream: Record<string, number>;
}

export interface Insight {
  tone: "good" | "bad" | "warn" | "info";
  text: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const mLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : null);
const money = (n: number) => formatINRCompact(n);
const list = (ms: string[]) => (ms.length <= 3 ? ms.map(mLabel).join(", ") : `${ms.slice(0, 2).map(mLabel).join(", ")} and ${ms.length - 2} more`);

export function buildMonth(month: string, income: number, expenses: number, byStream: Record<string, number> = {}): EntityMonth {
  const profit = r2(income - expenses);
  return { month, income: r2(income), expenses: r2(expenses), profit, marginPct: pct(profit, income), incomeMissing: income === 0 && expenses > 0, byStream };
}

export function totals(months: EntityMonth[]) {
  const income = r2(months.reduce((a, m) => a + m.income, 0));
  const expenses = r2(months.reduce((a, m) => a + m.expenses, 0));
  const profit = r2(income - expenses);
  return { income, expenses, profit, marginPct: pct(profit, income) };
}

/** Plain-language findings for one entity. `costs` = expense lines by category, largest first. */
export function entityInsights(key: EntityKey, months: EntityMonth[], costs: { name: string; amount: number }[], partialMonth?: string | null): Insight[] {
  const out: Insight[] = [];
  const name = ENTITY_LABELS[key];
  // A month still in progress is not compared with whole months (it would always look like the weakest).
  const partial = partialMonth ? months.find((m) => m.month === partialMonth && (m.income > 0 || m.expenses > 0)) : undefined;
  if (partial) out.push({ tone: "info", text: `${mLabel(partial.month)} is still in progress — left out of the best/weakest month and the comparison below.` });
  const complete = months.filter((m) => !m.incomeMissing && (m.income > 0 || m.expenses > 0) && m.month !== partial?.month);
  const missing = months.filter((m) => m.incomeMissing);
  const empty = months.filter((m) => m.income === 0 && m.expenses === 0);
  if (missing.length)
    out.push({
      tone: "warn",
      text: `${list(missing.map((m) => m.month))}: expenses are recorded (${money(missing.reduce((a, m) => a + m.expenses, 0))}) but no ${key === "AED" ? "OPD, lab or IPD" : "pharmacy sales"} income. Those months are left out of the result below — import their income first.`,
    });
  if (empty.length && empty.length < months.length && !(empty.length === 1 && empty[0].month === partialMonth)) out.push({ tone: "info", text: `${list(empty.map((m) => m.month))}: nothing recorded yet.` });
  if (!complete.length) {
    if (!missing.length) out.push({ tone: "info", text: `No ${name} figures for this period yet.` });
    return out;
  }
  const t = totals(complete);
  const span = complete.length === months.length ? "" : ` (${complete.length} month${complete.length === 1 ? "" : "s"} with income and expenses)`;
  out.push({
    tone: t.profit >= 0 ? "good" : "bad",
    text: `${t.profit >= 0 ? "Profit" : "Loss"} of ${money(Math.abs(t.profit))} on income of ${money(t.income)}${t.marginPct === null ? "" : ` — ${Math.abs(t.marginPct).toFixed(1)}% ${t.profit >= 0 ? "margin" : "loss"}`}${span}. Average ${money(t.income / complete.length)} income and ${money(t.expenses / complete.length)} expenses a month.`,
  });
  const losses = complete.filter((m) => m.profit < 0);
  if (losses.length && losses.length < complete.length)
    out.push({ tone: "bad", text: `Loss in ${losses.length} of ${complete.length} months: ${list(losses.map((m) => m.month))} (worst ${mLabel([...losses].sort((a, b) => a.profit - b.profit)[0].month)}, ${money(Math.min(...losses.map((m) => m.profit)))}).` });
  if (complete.length >= 2) {
    const best = [...complete].sort((a, b) => b.profit - a.profit)[0];
    const worst = [...complete].sort((a, b) => a.profit - b.profit)[0];
    out.push({ tone: "info", text: `Best month ${mLabel(best.month)} (${money(best.profit)}${best.marginPct === null ? "" : `, ${best.marginPct.toFixed(1)}%`}); weakest ${mLabel(worst.month)} (${money(worst.profit)}${worst.marginPct === null ? "" : `, ${worst.marginPct.toFixed(1)}%`}).` });
    const last = complete[complete.length - 1];
    const before = complete.slice(0, -1);
    const avgInc = before.reduce((a, m) => a + m.income, 0) / before.length;
    const avgExp = before.reduce((a, m) => a + m.expenses, 0) / before.length;
    const di = pct(last.income - avgInc, avgInc);
    const de = pct(last.expenses - avgExp, avgExp);
    if (di !== null && de !== null && (Math.abs(di) >= 10 || Math.abs(de) >= 10))
      out.push({
        tone: di >= de ? "good" : "warn",
        text: `${mLabel(last.month)} vs the earlier average: income ${di >= 0 ? "up" : "down"} ${Math.abs(di).toFixed(0)}%, expenses ${de >= 0 ? "up" : "down"} ${Math.abs(de).toFixed(0)}%.`,
      });
  }
  const expTotal = costs.reduce((a, c) => a + c.amount, 0);
  if (expTotal > 0) {
    const top = costs.slice(0, 3).map((c) => `${c.name} ${money(c.amount)} (${Math.round((c.amount / expTotal) * 100)}%)`);
    out.push({ tone: "info", text: `Biggest costs: ${top.join(", ")}.` });
    const sal = costs.find((c) => /salar/i.test(c.name));
    const inc = months.reduce((a, m) => a + m.income, 0);
    if (key === "AED" && sal && inc > 0) {
      const s = Math.round((sal.amount / inc) * 100);
      out.push({ tone: s > 50 ? "warn" : "info", text: `Salaries take ${s}% of AED income${s > 50 ? " — the main lever on profit" : ""}.` });
    }
  }
  if (key === "HP") {
    const build = complete.filter((m) => m.expenses > m.income * 1.1);
    if (build.length)
      out.push({ tone: "warn", text: `Purchases exceeded sales in ${list(build.map((m) => m.month))} — usually stock being built up, so those months understate profit (Sale − Purchase).` });
  }
  if (key === "AED") {
    const streams: Record<string, number> = {};
    for (const m of complete) for (const [k, v] of Object.entries(m.byStream)) streams[k] = (streams[k] ?? 0) + v;
    const inc = Object.values(streams).reduce((a, b) => a + b, 0);
    const parts = Object.entries(streams)
      .filter(([, v]) => v > 0 && Math.round((v / inc) * 100) >= 1)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${({ OPD: "Consultations", LAB: "Laboratory", IPD: "IPD", DIET: "Diet", OTHER: "Other" } as Record<string, string>)[k] ?? k} ${Math.round((v / inc) * 100)}%`);
    if (parts.length) out.push({ tone: "info", text: `Income mix: ${parts.join(", ")}.` });
  }
  return out;
}
