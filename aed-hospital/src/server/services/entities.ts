/** Income, expenses and profit/loss of AED Hospital and Hormonal Pharmacy as separate entities. */
import { Prisma } from "@prisma/client";
import { addMonths, endOfMonth, isISODate, startOfMonth, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { AED_STREAMS, ENTITY_LABELS, buildMonth, entityInsights, mLabel, totals, type EntityKey } from "@/lib/entities";
import { toNum } from "@/lib/money";
import { requirePermission, type Actor } from "../authz";
import { prisma } from "../db";
import { getSettings } from "../settings";
import type { Report } from "./reports";

const D = toDbDate;

export async function entityAccounts(actor: Actor, q: { from?: string | null; to?: string | null }) {
  requirePermission(actor, "dashboard.view");
  const today = todayISO();
  const to = (q.to && isISODate(q.to) ? q.to : today) as ISODate;
  const from = (q.from && isISODate(q.from) ? q.from : `${today.slice(0, 4)}-01-01`) as ISODate;
  const [inc, exp] = await Promise.all([
    prisma.$queryRaw<{ m: string; stream: string; amount: Prisma.Decimal }[]>`
      SELECT to_char(date, 'YYYY-MM') AS m, stream, SUM(amount) AS amount FROM v_income_line
       WHERE date BETWEEN ${D(from)} AND ${D(to)} GROUP BY 1, 2`,
    // Pharmacy purchases and anything booked to the Pharmacy department belong to Hormonal Pharmacy.
    prisma.$queryRaw<{ m: string; entity: string; cat: string; amount: Prisma.Decimal }[]>`
      SELECT to_char(v.date, 'YYYY-MM') AS m,
             CASE WHEN v.source_table = 'PharmacyPurchase' OR d.name = 'Pharmacy' THEN 'HP' ELSE 'AED' END AS entity,
             CASE WHEN v.source_table = 'PharmacyPurchase' THEN 'Stock purchases' ELSE COALESCE(c.name, 'Other') END AS cat,
             SUM(v.amount) AS amount
        FROM v_expense_line v
        LEFT JOIN "Department" d ON d.id = v.department_id
        LEFT JOIN "ExpenseCategory" c ON c.id = v.category_id
       WHERE v.date BETWEEN ${D(from)} AND ${D(to)}
       GROUP BY 1, 2, 3`,
  ]);
  // The last month is in progress when the period stops before its end and that is today (or later).
  const partialMonth = to < endOfMonth(to) && to >= today ? to.slice(0, 7) : null;
  const months: string[] = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) months.push(m.slice(0, 7));
  const result = {} as Record<EntityKey, ReturnType<typeof entityOf>>;
  function entityOf(key: EntityKey) {
    const ms = months.map((m) => {
      const streams: Record<string, number> = {};
      for (const r of inc) if (r.m === m && (key === "HP" ? r.stream === "PHARMACY" : (AED_STREAMS as readonly string[]).includes(r.stream))) streams[r.stream] = (streams[r.stream] ?? 0) + toNum(r.amount);
      const income = Object.values(streams).reduce((a, b) => a + b, 0);
      const expenses = exp.filter((r) => r.m === m && r.entity === key).reduce((a, r) => a + toNum(r.amount), 0);
      return buildMonth(m, income, expenses, streams);
    });
    const costMap = new Map<string, number>();
    for (const r of exp) if (r.entity === key) costMap.set(r.cat, (costMap.get(r.cat) ?? 0) + toNum(r.amount));
    const costs = [...costMap.entries()].map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
    const complete = ms.filter((m) => !m.incomeMissing);
    return { key, months: ms, totals: totals(ms), completeTotals: totals(complete), costs, insights: entityInsights(key, ms, costs, partialMonth) };
  }
  result.AED = entityOf("AED");
  result.HP = entityOf("HP");
  const combined = totals([...result.AED.months, ...result.HP.months]);
  return { from, to, toIsMonthEnd: to === endOfMonth(to), partialMonth, months, entities: result, combined };
}

/** The AED vs Hormonal Pharmacy P&L as a shareable report (PDF): figures, month by month, costs and insights. */
export async function entityReport(actor: Actor, q: { from?: string | null; to?: string | null }): Promise<Report> {
  const d = await entityAccounts(actor, q);
  const settings = await getSettings();
  // The PDF font has no ₹ or minus sign.
  const plain = (s: string) => s.replace(/₹\s?/g, "Rs. ").replace(/−/g, "-");
  const kpis: Report["kpis"] = [];
  const tables: Report["tables"] = [];
  const notes: string[] = [];
  for (const k of ["AED", "HP"] as const) {
    const e = d.entities[k];
    const excluded = e.months.some((m) => m.incomeMissing);
    const t = excluded ? e.completeTotals : e.totals;
    kpis.push(
      { label: `${ENTITY_LABELS[k]} income`, value: t.income, type: "money" },
      { label: `${ENTITY_LABELS[k]} expenses`, value: t.expenses, type: "money" },
      { label: `${ENTITY_LABELS[k]} ${t.profit >= 0 ? "profit" : "loss"} · margin ${t.marginPct === null ? "—" : `${t.marginPct.toFixed(1)}%`}`, value: t.profit, type: "money" },
    );
    tables.push({
      title: `${ENTITY_LABELS[k]} — month by month`,
      columns: [
        { key: "month", label: "Month" },
        { key: "income", label: "Income", type: "money" },
        { key: "expenses", label: "Expenses", type: "money" },
        { key: "profit", label: "Profit / loss", type: "money" },
        { key: "margin", label: "Margin" },
      ],
      rows: e.months.map((m) => ({
        month: `${mLabel(m.month)}${m.month === d.partialMonth ? " (to date)" : ""}${m.incomeMissing ? " (income not recorded)" : ""}`,
        income: m.income,
        expenses: m.expenses,
        profit: m.incomeMissing ? null : m.profit,
        margin: m.incomeMissing || m.marginPct === null ? "—" : `${m.marginPct.toFixed(1)}%`,
      })),
      totals: { month: "Total", income: e.totals.income, expenses: e.totals.expenses, profit: e.totals.profit, margin: e.totals.marginPct === null ? "—" : `${e.totals.marginPct.toFixed(1)}%` },
    });
    tables.push({
      title: `${ENTITY_LABELS[k]} — where the money goes`,
      columns: [
        { key: "name", label: "Cost" },
        { key: "amount", label: "Amount", type: "money" },
        { key: "share", label: "Share" },
      ],
      rows: e.costs.slice(0, 10).map((c) => ({ name: c.name, amount: c.amount, share: e.totals.expenses ? `${Math.round((c.amount / e.totals.expenses) * 100)}%` : "" })),
    });
    for (const i of e.insights) notes.push(`${ENTITY_LABELS[k]}: ${plain(i.text)}`);
  }
  notes.push(`Both together: income Rs. ${Math.round(d.combined.income).toLocaleString("en-IN")}, expenses Rs. ${Math.round(d.combined.expenses).toLocaleString("en-IN")}, ${d.combined.profit >= 0 ? "profit" : "loss"} Rs. ${Math.round(Math.abs(d.combined.profit)).toLocaleString("en-IN")}.`);
  notes.push("AED Hospital = OPD, laboratory, IPD, diet and other hospital income, less hospital expenses. Hormonal Pharmacy is a separate entity: its profit is sales net of returns less stock purchases and pharmacy-department costs (Sale - Purchase).");
  return {
    type: "entities",
    title: "AED Hospital vs Hormonal Pharmacy — profit & loss",
    hospital: settings.hospitalName,
    address: settings.hospitalAddress,
    period: `${mLabel(d.from.slice(0, 7))} to ${mLabel(d.to.slice(0, 7))}${d.partialMonth ? ` (${mLabel(d.partialMonth)} to ${d.to.slice(8)} ${mLabel(d.partialMonth)})` : ""}`,
    from: d.from,
    to: d.to,
    generatedAt: new Date().toISOString(),
    generatedBy: actor.name,
    kpis,
    tables,
    notes,
    notesTitle: "What the numbers say",
  };
}
