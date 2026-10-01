/** Income, expenses and profit/loss of AED Hospital and Hormonal Pharmacy as separate entities. */
import { Prisma } from "@prisma/client";
import { addMonths, endOfMonth, isISODate, startOfMonth, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { AED_STREAMS, buildMonth, entityInsights, totals, type EntityKey } from "@/lib/entities";
import { toNum } from "@/lib/money";
import { requirePermission, type Actor } from "../authz";
import { prisma } from "../db";

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
    return { key, months: ms, totals: totals(ms), completeTotals: totals(complete), costs, insights: entityInsights(key, ms, costs) };
  }
  result.AED = entityOf("AED");
  result.HP = entityOf("HP");
  const combined = totals([...result.AED.months, ...result.HP.months]);
  return { from, to, toIsMonthEnd: to === endOfMonth(to), months, entities: result, combined };
}
