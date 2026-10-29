/**
 * Department-wise accounts: AED income (Hormonal Pharmacy excluded) grouped into the income
 * departments by the billed name of each line, month by month, with the items behind each
 * department and the billed names no department claims yet.
 */
import { Prisma } from "@prisma/client";
import { addMonths, isISODate, startOfMonth, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { addOnSplit, compileDepartments, departmentFor, expenseDepartmentFor, pharmacyDepartmentFor } from "@/lib/departments";
import { STREAM_LABELS, type IncomeStream } from "@/lib/accounting";
import { round2, toNum } from "@/lib/money";
import { requirePermission, type Actor } from "../authz";
import { prisma } from "../db";

interface Item {
  name: string;
  stream: string;
  count: number;
  total: number;
  byMonth: Record<string, number>;
}
interface Group {
  id: string;
  name: string;
  count: number;
  total: number;
  byMonth: Record<string, number>;
  items: Item[];
}

export async function departmentAccounts(actor: Actor, q: { from?: string | null; to?: string | null }) {
  requirePermission(actor, "analytics.view");
  const today = todayISO();
  const to = (q.to && isISODate(q.to) ? q.to : today) as ISODate;
  const from = (q.from && isISODate(q.from) ? q.from : `${today.slice(0, 4)}-01-01`) as ISODate;
  const [rules, rows, expenseRows, medicineRows] = await Promise.all([
    prisma.serviceDepartment
      .findMany({ where: { active: true } })
      .then((rs) => rs.map((r) => ({ ...r, addOnAmount: toNum(r.addOnAmount), pharmacyIncentivePct: toNum(r.pharmacyIncentivePct), partnerSharePct: toNum(r.partnerSharePct) }))),
    // Billed name per line: consultation type (OPD/SCP), lab test, diet service, IPD admission type.
    prisma.$queryRaw<{ m: string; stream: string; name: string | null; n: Prisma.Decimal; amount: Prisma.Decimal }[]>`
      SELECT to_char(v.date, 'YYYY-MM') AS m, v.stream,
             COALESCE(ct.name, li.name, ds.name, at.name, o.source) AS name,
             SUM(CASE WHEN v.source_table = 'LabTransaction' THEN v.units ELSE 1 END) AS n,
             SUM(v.amount) AS amount
        FROM v_income_line v
        LEFT JOIN "ConsultationType" ct ON v.source_table = 'Consultation' AND ct.id = v.item_id
        LEFT JOIN "LabInvestigation" li ON v.source_table = 'LabTransaction' AND li.id = v.item_id
        LEFT JOIN "DietService" ds ON v.source_table = 'DietTransaction' AND ds.id = v.item_id
        LEFT JOIN "AdmissionType" at ON v.source_table = 'IpdTransaction' AND at.id = v.item_id
        LEFT JOIN "OtherIncome" o ON v.source_table = 'OtherIncome' AND o.id = v.source_id
       WHERE v.stream <> 'PHARMACY' AND v.date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
       GROUP BY 1, 2, 3`,
    // Approved expenses by expense department and category (pending ones are not spent yet).
    prisma.$queryRaw<{ m: string; dept: string | null; category: string; amount: Prisma.Decimal }[]>`
      SELECT to_char(e.date, 'YYYY-MM') AS m, d.name AS dept, c.name AS category, SUM(e.amount) AS amount
        FROM "Expense" e
        LEFT JOIN "Department" d ON d.id = e."departmentId"
        JOIN "ExpenseCategory" c ON c.id = e."categoryId"
       WHERE e.status = 'ACTIVE' AND e.date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
       GROUP BY 1, 2, 3`,
    // Hormonal Pharmacy medicines sold (OneGlance Purchase/Sales report), for departments that earn their margin.
    prisma.$queryRaw<{ m: string; name: string; amount: Prisma.Decimal; taxable: Prisma.Decimal | null; cost: Prisma.Decimal | null; nocost: bigint }[]>`
      SELECT to_char(l.date, 'YYYY-MM') AS m, i.name, SUM(l.amount) AS amount,
             SUM(COALESCE(l.taxable, l.amount - COALESCE(l.tax, 0))) AS taxable, SUM(l.cost) AS cost,
             COUNT(*) FILTER (WHERE l.cost IS NULL) AS nocost
        FROM "PharmacyItemLine" l JOIN "PharmacyItem" i ON i.id = l."itemId"
       WHERE l.kind = 'SALE' AND l.status = 'ACTIVE' AND l.date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
       GROUP BY 1, 2`,
  ]);
  const months: string[] = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) months.push(m.slice(0, 7));
  const depts = compileDepartments(rules);
  const groups = new Map<string, Group>(depts.map((d) => [d.id, { id: d.id, name: d.name, count: 0, total: 0, byMonth: {}, items: [] }]));
  const unassigned = new Map<string, Group>();
  let grand = 0;
  const unassignedGroup = (stream: string) => {
    // Not in any department yet: grouped by stream, so the Admin sees what to map.
    const key = `unassigned:${stream}`;
    let g = unassigned.get(key);
    if (!g) unassigned.set(key, (g = { id: key, name: `${STREAM_LABELS[stream as IncomeStream] ?? stream} — not in a department`, count: 0, total: 0, byMonth: {}, items: [] }));
    return g;
  };
  const add = (g: Group, itemName: string, stream: string, m: string, count: number, amount: number) => {
    g.count += count;
    g.total = round2(g.total + amount);
    g.byMonth[m] = round2((g.byMonth[m] ?? 0) + amount);
    let it = g.items.find((x) => x.name === itemName && x.stream === stream);
    if (!it) g.items.push((it = { name: itemName, stream, count: 0, total: 0, byMonth: {} }));
    it.count += count;
    it.total = round2(it.total + amount);
    it.byMonth[m] = round2((it.byMonth[m] ?? 0) + amount);
  };
  for (const r of rows) {
    let amount = toNum(r.amount);
    const count = toNum(r.n);
    const itemName = r.name ?? `(${STREAM_LABELS[r.stream as IncomeStream] ?? r.stream}, no name)`;
    grand = round2(grand + amount);
    let placeBy = r.name;
    const split = addOnSplit(depts, r.name);
    if (split) {
      // "New Thyroid + Wellness Consultation": the add-on department takes its fixed amount per bill.
      const share = split.base ? Math.min(amount, round2(split.dept.addOnAmount * count)) : amount;
      add(groups.get(split.dept.id)!, split.base ? `${itemName} (₹${split.dept.addOnAmount.toLocaleString("en-IN")} per bill)` : itemName, r.stream, r.m, count, share);
      amount = round2(amount - share);
      if (!split.base || amount === 0) continue;
      placeBy = split.base;
    }
    const d = departmentFor(depts, r.stream, placeBy);
    add(d ? groups.get(d.id)! : unassignedGroup(r.stream), itemName, r.stream, r.m, count, amount);
  }
  const finish = (gs: Group[]) => gs.map((g) => ({ ...g, items: g.items.sort((a, b) => b.total - a.total) }));
  const departments = finish([...groups.values()]);
  const rest = finish([...unassigned.values()].sort((a, b) => b.total - a.total));
  const totals: Record<string, number> = {};
  for (const m of months) totals[m] = round2([...departments, ...rest].reduce((a, g) => a + (g.byMonth[m] ?? 0), 0));
  const profit = departmentProfit(depts, departments, months, expenseRows, medicineRows);
  return {
    from,
    to,
    months,
    departments,
    unassigned: rest,
    totals,
    grandTotal: grand,
    departmentsTotal: round2(departments.reduce((a, g) => a + g.total, 0)),
    ...profit,
  };
}

type Money = Record<string, number>;
const addTo = (o: Money, m: string, v: number) => (o[m] = round2((o[m] ?? 0) + v));
const sum = (o: Money) => round2(Object.values(o).reduce((a, v) => a + v, 0));

/**
 * Department profit, month by month: billed income + margin on the department's pharmacy medicines
 * (taxable sale value − purchase cost, both without GST) − its own expenses − the staff incentive on
 * those medicines (% of the billed amount). Expenses of departments no income department claims
 * (salaries of shared staff, rent, power …) are shared overheads, shown separately and not charged.
 * A partner's share (JJ Wellness 20%) is taken from the combined profit of its departments, per month,
 * and only when that month is in profit.
 */
function departmentProfit(
  depts: ReturnType<typeof compileDepartments>,
  departments: Group[],
  months: string[],
  expenseRows: { m: string; dept: string | null; category: string; amount: Prisma.Decimal }[],
  medicineRows: { m: string; name: string; amount: Prisma.Decimal; taxable: Prisma.Decimal | null; cost: Prisma.Decimal | null; nocost: bigint }[],
) {
  const pl = new Map(
    depts.map((d) => [
      d.id,
      {
        id: d.id,
        name: d.name,
        income: {} as Money,
        pharmacySales: {} as Money,
        pharmacyMargin: {} as Money,
        incentive: {} as Money,
        expenses: {} as Money,
        expenseItems: new Map<string, Money>(),
        medicines: new Map<string, { sales: number; margin: number }>(),
        missingCost: 0,
        incentivePct: d.pharmacyIncentivePct,
        costsMapped: d.expenseDepartments.length > 0,
      },
    ]),
  );
  for (const g of departments) for (const [m, v] of Object.entries(g.byMonth)) addTo(pl.get(g.id)!.income, m, v);
  const shared: Money = {};
  const sharedItems = new Map<string, Money>();
  for (const r of expenseRows) {
    const amount = toNum(r.amount);
    const d = expenseDepartmentFor(depts, r.dept);
    const label = `${r.dept ?? "No department"} · ${r.category}`;
    const items = d ? pl.get(d.id)!.expenseItems : sharedItems;
    if (!items.has(label)) items.set(label, {});
    addTo(items.get(label)!, r.m, amount);
    addTo(d ? pl.get(d.id)!.expenses : shared, r.m, amount);
  }
  for (const r of medicineRows) {
    const d = pharmacyDepartmentFor(depts, r.name);
    if (!d) continue;
    const p = pl.get(d.id)!;
    const sales = toNum(r.amount);
    const margin = r.cost === null ? 0 : round2(toNum(r.taxable) - toNum(r.cost));
    p.missingCost += Number(r.nocost);
    addTo(p.pharmacySales, r.m, sales);
    addTo(p.pharmacyMargin, r.m, margin);
    addTo(p.incentive, r.m, round2((sales * d.pharmacyIncentivePct) / 100));
    const med = p.medicines.get(r.name) ?? { sales: 0, margin: 0 };
    p.medicines.set(r.name, { sales: round2(med.sales + sales), margin: round2(med.margin + margin) });
  }
  const rows = [...pl.values()].map((p) => {
    const profit: Money = {};
    for (const m of months) profit[m] = round2((p.income[m] ?? 0) + (p.pharmacyMargin[m] ?? 0) - (p.expenses[m] ?? 0) - (p.incentive[m] ?? 0));
    const income = sum(p.income) + sum(p.pharmacyMargin);
    const total = sum(profit);
    return {
      id: p.id,
      name: p.name,
      income: p.income,
      pharmacySales: p.pharmacySales,
      pharmacyMargin: p.pharmacyMargin,
      incentive: p.incentive,
      incentivePct: p.incentivePct,
      costsMapped: p.costsMapped,
      expenses: p.expenses,
      profit,
      totals: { income: sum(p.income), pharmacySales: sum(p.pharmacySales), pharmacyMargin: sum(p.pharmacyMargin), expenses: sum(p.expenses), incentive: sum(p.incentive), profit: total },
      marginPct: income ? round2((total / income) * 100) : null,
      expenseItems: [...p.expenseItems.entries()].map(([name, byMonth]) => ({ name, byMonth, total: sum(byMonth) })).sort((a, b) => b.total - a.total),
      medicines: [...p.medicines.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sales - a.sales),
      missingCost: p.missingCost,
    };
  });
  const partners = new Map<string, { name: string; pct: number; departments: string[]; profit: Money }>();
  for (const d of depts) {
    if (!d.partnerName || !(d.partnerSharePct > 0)) continue;
    const key = d.partnerName.toLowerCase();
    const p = partners.get(key) ?? { name: d.partnerName, pct: d.partnerSharePct, departments: [], profit: {} };
    p.departments.push(d.name);
    const r = rows.find((x) => x.id === d.id)!;
    for (const m of months) addTo(p.profit, m, r.profit[m] ?? 0);
    partners.set(key, p);
  }
  return {
    profit: rows,
    sharedExpenses: { byMonth: shared, total: sum(shared), items: [...sharedItems.entries()].map(([name, byMonth]) => ({ name, byMonth, total: sum(byMonth) })).sort((a, b) => b.total - a.total) },
    partners: [...partners.values()].map((p) => {
      const share: Money = {};
      for (const m of months) share[m] = p.profit[m] > 0 ? round2((p.profit[m] * p.pct) / 100) : 0;
      return { ...p, share, totals: { profit: sum(p.profit), share: sum(share), aed: round2(sum(p.profit) - sum(share)) } };
    }),
  };
}
