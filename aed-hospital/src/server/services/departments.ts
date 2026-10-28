/**
 * Department-wise accounts: AED income (Hormonal Pharmacy excluded) grouped into the income
 * departments by the billed name of each line, month by month, with the items behind each
 * department and the billed names no department claims yet.
 */
import { Prisma } from "@prisma/client";
import { addMonths, isISODate, startOfMonth, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { compileDepartments, departmentFor } from "@/lib/departments";
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
  const [rules, rows] = await Promise.all([
    prisma.serviceDepartment.findMany({ where: { active: true } }),
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
  ]);
  const months: string[] = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) months.push(m.slice(0, 7));
  const depts = compileDepartments(rules);
  const groups = new Map<string, Group>(depts.map((d) => [d.id, { id: d.id, name: d.name, count: 0, total: 0, byMonth: {}, items: [] }]));
  const unassigned = new Map<string, Group>();
  let grand = 0;
  for (const r of rows) {
    const amount = toNum(r.amount);
    const count = toNum(r.n);
    const itemName = r.name ?? `(${STREAM_LABELS[r.stream as IncomeStream] ?? r.stream}, no name)`;
    grand = round2(grand + amount);
    const d = departmentFor(depts, r.stream, r.name);
    let g: Group;
    if (d) g = groups.get(d.id)!;
    else {
      // Not in any department yet: grouped by stream, so the Admin sees what to map.
      const key = `unassigned:${r.stream}`;
      g = unassigned.get(key) ?? { id: key, name: `${STREAM_LABELS[r.stream as IncomeStream] ?? r.stream} — not in a department`, count: 0, total: 0, byMonth: {}, items: [] };
      unassigned.set(key, g);
    }
    g.count += count;
    g.total = round2(g.total + amount);
    g.byMonth[r.m] = round2((g.byMonth[r.m] ?? 0) + amount);
    let it = g.items.find((x) => x.name === itemName && x.stream === r.stream);
    if (!it) g.items.push((it = { name: itemName, stream: r.stream, count: 0, total: 0, byMonth: {} }));
    it.count += count;
    it.total = round2(it.total + amount);
    it.byMonth[r.m] = round2((it.byMonth[r.m] ?? 0) + amount);
  }
  const finish = (gs: Group[]) => gs.map((g) => ({ ...g, items: g.items.sort((a, b) => b.total - a.total) }));
  const departments = finish([...groups.values()]);
  const rest = finish([...unassigned.values()].sort((a, b) => b.total - a.total));
  const totals: Record<string, number> = {};
  for (const m of months) totals[m] = round2([...departments, ...rest].reduce((a, g) => a + (g.byMonth[m] ?? 0), 0));
  return {
    from,
    to,
    months,
    departments,
    unassigned: rest,
    totals,
    grandTotal: grand,
    departmentsTotal: round2(departments.reduce((a, g) => a + g.total, 0)),
  };
}
