/**
 * Department accounts: an analysis apart from the hospital's books. Each income department (USG scan
 * room, Cardiac, JJ Wellness …) gets the AED income billed under its names, plus margin on its pharmacy
 * medicines; its costs are the shares the Admin allocates to it (DepartmentCost: a JJ Wellness salary,
 * rent for its 500 sq ft, 10% of the power bill) plus the staff incentive on those medicines. Nothing
 * here changes the hospital's income or expenses.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { addDays, addMonths, endOfMonth, isISODate, startOfMonth, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { addOnSplit, compileDepartments, departmentFor, pharmacyDepartmentFor } from "@/lib/departments";
import { STREAM_LABELS, type IncomeStream } from "@/lib/accounting";
import { norm } from "@/lib/import/text";
import { round2, toNum } from "@/lib/money";
import { can, type Actor } from "../authz";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, forbidden, notFound } from "../errors";

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
type Compiled = ReturnType<typeof compileDepartments>;

async function loadDepartments() {
  const rules = await prisma.serviceDepartment.findMany({ where: { active: true } });
  return compileDepartments(
    rules.map((r) => ({ ...r, addOnAmount: toNum(r.addOnAmount), pharmacyIncentivePct: toNum(r.pharmacyIncentivePct), partnerSharePct: toNum(r.partnerSharePct) })),
  );
}

/**
 * Where one income line goes: [department id or null, amount] pairs. A combined bill
 * ("New Thyroid + Wellness Consultation") gives the add-on department its fixed amount per bill and
 * places the rest by the part before the "+".
 */
function place(depts: Compiled, stream: string, name: string | null, count: number, amount: number): { deptId: string | null; amount: number; label?: string }[] {
  const split = addOnSplit(depts, name);
  if (!split) return [{ deptId: departmentFor(depts, stream, name)?.id ?? null, amount }];
  const share = split.base ? Math.min(amount, round2(split.dept.addOnAmount * count)) : amount;
  const out: { deptId: string | null; amount: number; label?: string }[] = [
    { deptId: split.dept.id, amount: share, label: split.base ? `${name} (₹${split.dept.addOnAmount.toLocaleString("en-IN")} per bill)` : undefined },
  ];
  const rest = round2(amount - share);
  if (split.base && rest !== 0) out.push({ deptId: departmentFor(depts, stream, split.base)?.id ?? null, amount: rest });
  return out;
}

/**
 * Who sees what: analytics viewers see every department; a department head (User.headOfDepartmentId)
 * sees only the department they head.
 */
function scopeOf(actor: Actor): string | null {
  if (can(actor, "analytics.view")) return null;
  if (actor.headOfDepartmentId) return actor.headOfDepartmentId;
  throw forbidden("Department accounts need the analytics permission, or a login set as a department head");
}
function assertDepartmentVisible(actor: Actor, departmentId: string) {
  const own = scopeOf(actor);
  if (own && own !== departmentId) throw forbidden("You can see only the department you head");
}
/** Admins (master data) edit any department's costs; a head adds costs to their own department and edits those they added. */
function assertCanEditCost(actor: Actor, departmentId: string, createdById?: string) {
  if (can(actor, "masters.manage")) return;
  if (actor.headOfDepartmentId === departmentId && (!createdById || createdById === actor.id)) return;
  throw forbidden("Only an Admin, or the head of this department for the costs they added, can change this");
}

const MAX_DAYS = 62;
const daysIn = (month: string) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();

export async function departmentAccounts(actor: Actor, q: { from?: string | null; to?: string | null; granularity?: string | null }) {
  const own = scopeOf(actor);
  const byDay = q.granularity === "day";
  const today = todayISO();
  const to = (q.to && isISODate(q.to) ? q.to : today) as ISODate;
  const from = (q.from && isISODate(q.from) ? q.from : `${today.slice(0, 4)}-01-01`) as ISODate;
  if (byDay && Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > MAX_DAYS) throw badRequest(`Day by day covers at most ${MAX_DAYS} days`);
  const fmt = byDay ? "YYYY-MM-DD" : "YYYY-MM";
  const [depts, rows, costs, medicineRows, contributors] = await Promise.all([
    loadDepartments(),
    // Billed name per line: consultation type (OPD/SCP), lab test, diet service, IPD admission type.
    prisma.$queryRaw<{ m: string; stream: string; name: string | null; n: Prisma.Decimal; amount: Prisma.Decimal }[]>`
      SELECT to_char(v.date, ${fmt}) AS m, v.stream,
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
    prisma.departmentCost.findMany({ orderBy: [{ fromMonth: "asc" }, { label: "asc" }] }),
    // Hormonal Pharmacy medicines sold (OneGlance Purchase/Sales report), for departments that earn their margin.
    prisma.$queryRaw<{ m: string; name: string; amount: Prisma.Decimal; taxable: Prisma.Decimal | null; cost: Prisma.Decimal | null; nocost: bigint }[]>`
      SELECT to_char(l.date, ${fmt}) AS m, i.name, SUM(l.amount) AS amount,
             SUM(COALESCE(l.taxable, l.amount - COALESCE(l.tax, 0))) AS taxable, SUM(l.cost) AS cost,
             COUNT(*) FILTER (WHERE l.cost IS NULL) AS nocost
        FROM "PharmacyItemLine" l JOIN "PharmacyItem" i ON i.id = l."itemId"
       WHERE l.kind = 'SALE' AND l.status = 'ACTIVE' AND l.date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
       GROUP BY 1, 2`,
    prisma.departmentContributor.findMany({ where: { active: true }, include: { incomes: true }, orderBy: { name: "asc" } }),
  ]);
  // Columns: months, or days (monthly costs are then spread over the days of their month).
  const calendarMonths: string[] = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) calendarMonths.push(m.slice(0, 7));
  const months: string[] = [];
  if (byDay) for (let d = from; d <= to; d = addDays(d, 1)) months.push(d);
  else months.push(...calendarMonths);
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
    const amount = toNum(r.amount);
    const count = toNum(r.n);
    const itemName = r.name ?? `(${STREAM_LABELS[r.stream as IncomeStream] ?? r.stream}, no name)`;
    grand = round2(grand + amount);
    for (const p of place(depts, r.stream, r.name, count, amount))
      add(p.deptId ? groups.get(p.deptId)! : unassignedGroup(r.stream), p.label ?? itemName, r.stream, r.m, count, p.amount);
  }
  const finish = (gs: Group[]) => gs.map((g) => ({ ...g, items: g.items.sort((a, b) => b.total - a.total) }));
  const departments = finish([...groups.values()]);
  const rest = finish([...unassigned.values()].sort((a, b) => b.total - a.total));
  const totals: Record<string, number> = {};
  for (const m of months) totals[m] = round2([...departments, ...rest].reduce((a, g) => a + (g.byMonth[m] ?? 0), 0));
  const profit = await departmentProfit(depts, departments, months, calendarMonths, byDay, costs, medicineRows, contributors);
  const result = {
    from,
    to,
    granularity: byDay ? "day" : "month",
    months,
    calendarMonths,
    departments,
    unassigned: rest,
    totals,
    grandTotal: grand,
    departmentsTotal: round2(departments.reduce((a, g) => a + g.total, 0)),
    ...profit,
    headOf: own,
  };
  if (!own) return result;
  // A department head: their own department only, with no hospital-wide figures.
  const mine = departments.filter((g) => g.id === own);
  const ownName = mine[0]?.name;
  return {
    ...result,
    departments: mine,
    unassigned: [],
    totals: Object.fromEntries(months.map((m) => [m, mine[0]?.byMonth[m] ?? 0])),
    grandTotal: mine[0]?.total ?? 0,
    departmentsTotal: mine[0]?.total ?? 0,
    statements: profit.statements.filter((x) => x.id === own),
    partners: profit.partners.filter((p) => ownName && p.departments.includes(ownName)),
  };
}

type Money = Record<string, number>;
const addTo = (o: Money, m: string, v: number) => (o[m] = round2((o[m] ?? 0) + v));
const sum = (o: Money) => round2(Object.values(o).reduce((a, v) => a + v, 0));

/** Hospital expenses booked in these categories (as category or subcategory), per month. */
async function categoryTotals(ids: string[], months: string[]) {
  const out = new Map<string, Money>();
  if (!ids.length || !months.length) return out;
  const rows = await prisma.$queryRaw<{ m: string; cid: string; amount: Prisma.Decimal }[]>`
    SELECT to_char(e.date, 'YYYY-MM') AS m, x.cid, SUM(e.amount) AS amount
      FROM "Expense" e CROSS JOIN LATERAL (VALUES (e."categoryId"), (e."subcategoryId")) AS x(cid)
     WHERE e.status = 'ACTIVE' AND x.cid = ANY(${ids}) AND e.date BETWEEN ${toDbDate(`${months[0]}-01` as ISODate)} AND ${toDbDate(endOfMonth(`${months[months.length - 1]}-01` as ISODate))}
     GROUP BY 1, 2`;
  for (const r of rows) {
    if (!out.has(r.cid)) out.set(r.cid, {});
    addTo(out.get(r.cid)!, r.m, toNum(r.amount));
  }
  return out;
}

const inMonths = (c: { fromMonth: string; toMonth: string | null }, m: string) => m >= c.fromMonth && (!c.toMonth || m <= c.toMonth);

/**
 * Each department's statement, month by month — income: billed lines + margin on its pharmacy
 * medicines (taxable sale value − purchase cost, both without GST); costs: the shares allocated to it
 * (fixed ₹ per month, or % of the hospital's expenses in a category that month) + the staff incentive
 * on its medicines (% of the billed amount); profit = income − costs. A partner's share (JJ Wellness
 * 20%) is taken from the combined profit of its departments, per month, only when that month is in profit.
 */
async function departmentProfit(
  depts: Compiled,
  departments: Group[],
  months: string[],
  calendarMonths: string[],
  byDay: boolean,
  costs: {
    id: string;
    departmentId: string;
    label: string;
    kind: string;
    amount: Prisma.Decimal;
    percent: Prisma.Decimal;
    categoryId: string | null;
    fromMonth: string;
    toMonth: string | null;
  }[],
  medicineRows: { m: string; name: string; amount: Prisma.Decimal; taxable: Prisma.Decimal | null; cost: Prisma.Decimal | null; nocost: bigint }[],
  contributors: { id: string; departmentId: string; name: string; incentivePct: Prisma.Decimal; incomes: { month: string; amount: Prisma.Decimal }[] }[],
) {
  const categoryIds = [...new Set(costs.filter((c) => c.kind === "SHARE" && c.categoryId).map((c) => c.categoryId!))];
  const [byCategory, categories] = await Promise.all([
    categoryTotals(categoryIds, calendarMonths),
    prisma.expenseCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const statements = depts.map((d) => {
    const g = departments.find((x) => x.id === d.id)!;
    const income: Money = { ...g.byMonth };
    // Pharmacy medicines this department earns the margin on (JJ Wellness: GLP injections).
    const sales: Money = {};
    const margin: Money = {};
    const incentive: Money = {};
    const medicines = new Map<string, { sales: number; margin: number }>();
    let missingCost = 0;
    for (const r of medicineRows) {
      if (pharmacyDepartmentFor(depts, r.name)?.id !== d.id) continue;
      const s = toNum(r.amount);
      const mg = r.cost === null ? 0 : round2(toNum(r.taxable) - toNum(r.cost));
      missingCost += Number(r.nocost);
      addTo(sales, r.m, s);
      addTo(margin, r.m, mg);
      addTo(income, r.m, mg);
      addTo(incentive, r.m, round2((s * d.pharmacyIncentivePct) / 100));
      const med = medicines.get(r.name) ?? { sales: 0, margin: 0 };
      medicines.set(r.name, { sales: round2(med.sales + s), margin: round2(med.margin + mg) });
    }
    const incomeLines = g.items.map((it) => ({ name: it.name, stream: it.stream, count: it.count, byMonth: it.byMonth, total: it.total }));
    if (medicines.size)
      incomeLines.push({
        name: `Injection margin (sales ${formatShort(sum(sales))}, without GST, after purchase cost)`,
        stream: "PHARMACY",
        count: 0,
        byMonth: margin,
        total: sum(margin),
      });
    const costLines: { id: string | null; label: string; basis: string; byMonth: Money; total: number }[] = [];
    for (const c of costs.filter((x) => x.departmentId === d.id)) {
      const byMonth: Money = {};
      for (const m of months) {
        const month = m.slice(0, 7);
        if (!inMonths(c, month)) continue;
        let v: number;
        // INCOME: a % of the department's own billed income in that column (incentives); not of the injection margin.
        if (c.kind === "INCOME") v = round2(((g.byMonth[m] ?? 0) * toNum(c.percent)) / 100);
        else {
          const monthly = c.kind === "SHARE" ? ((byCategory.get(c.categoryId ?? "")?.[month] ?? 0) * toNum(c.percent)) / 100 : toNum(c.amount);
          v = round2(byDay ? monthly / daysIn(month) : monthly);
        }
        if (v) byMonth[m] = v;
      }
      const basis =
        c.kind === "SHARE"
          ? `${toNum(c.percent)}% of ${catName.get(c.categoryId ?? "") ?? "a deleted category"}`
          : c.kind === "INCOME"
            ? `${toNum(c.percent)}% of ${d.name}'s billed income (not the injection margin)`
            : `₹${toNum(c.amount).toLocaleString("en-IN")} a month`;
      costLines.push({ id: c.id, label: c.label, basis: `${basis} · ${c.fromMonth}${c.toMonth ? ` to ${c.toMonth}` : " onwards"}`, byMonth, total: sum(byMonth) });
    }
    // People who bring income in: their incentive is a % of the income they generated that month.
    const people = contributors
      .filter((c) => c.departmentId === d.id)
      .map((c) => {
        const pct = toNum(c.incentivePct);
        const generated: Money = {};
        for (const i of c.incomes) if (calendarMonths.includes(i.month)) generated[i.month] = toNum(i.amount);
        const pay: Money = {};
        for (const m of months) {
          const month = m.slice(0, 7);
          const monthly = ((generated[month] ?? 0) * pct) / 100;
          const v = round2(byDay ? monthly / daysIn(month) : monthly);
          if (v) pay[m] = v;
        }
        return { id: c.id, name: c.name, incentivePct: pct, generated, totalGenerated: sum(generated), incentive: pay, totalIncentive: sum(pay) };
      });
    for (const p of people)
      if (p.totalIncentive)
        costLines.push({ id: null, label: `Incentive — ${p.name}`, basis: `${p.incentivePct}% of the income they generated`, byMonth: p.incentive, total: p.totalIncentive });
    if (sum(incentive))
      costLines.push({
        id: null,
        label: `Staff incentive ${d.pharmacyIncentivePct}% of injection sales`,
        basis: "calculated from the pharmacy's medicine-wise sales",
        byMonth: incentive,
        total: sum(incentive),
      });
    const costTotal: Money = {};
    for (const l of costLines) for (const [m, v] of Object.entries(l.byMonth)) addTo(costTotal, m, v);
    const profit: Money = {};
    for (const m of months) profit[m] = round2((income[m] ?? 0) - (costTotal[m] ?? 0));
    const totals = { income: sum(income), costs: sum(costTotal), profit: sum(profit), pharmacySales: sum(sales) };
    return {
      id: d.id,
      name: d.name,
      incomeLines: incomeLines.sort((a, b) => b.total - a.total),
      costLines,
      income,
      costs: costTotal,
      profit,
      totals,
      marginPct: totals.income ? round2((totals.profit / totals.income) * 100) : null,
      medicines: [...medicines.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sales - a.sales),
      missingCost,
      costsEntered: costLines.some((l) => l.id),
      contributors: people.map((p) => ({ ...p, sharePct: totals.income ? round2((p.totalGenerated / totals.income) * 100) : null })),
    };
  });
  const partners = new Map<string, { name: string; pct: number; departments: string[]; profit: Money }>();
  for (const d of depts) {
    if (!d.partnerName || !(d.partnerSharePct > 0)) continue;
    const key = d.partnerName.toLowerCase();
    const p = partners.get(key) ?? { name: d.partnerName, pct: d.partnerSharePct, departments: [], profit: {} };
    p.departments.push(d.name);
    const st = statements.find((x) => x.id === d.id)!;
    for (const m of months) addTo(p.profit, m, st.profit[m] ?? 0);
    partners.set(key, p);
  }
  return {
    statements,
    // The partner's share is agreed per month, so it is not worked out day by day.
    partners: byDay
      ? []
      : [...partners.values()].map((p) => {
          const share: Money = {};
          for (const m of months) share[m] = p.profit[m] > 0 ? round2((p.profit[m] * p.pct) / 100) : 0;
          return { ...p, share, totals: { profit: sum(p.profit), share: sum(share), aed: round2(sum(p.profit) - sum(share)) } };
        }),
  };
}

const formatShort = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

// ─────────────────────────── allocated costs ───────────────────────────

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const costInput = z
  .object({
    departmentId: z.string().min(1),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(["FIXED", "SHARE", "INCOME"]),
    amount: z.coerce.number().min(0).max(99_99_99_999).default(0),
    percent: z.coerce.number().min(0).max(100).default(0),
    categoryId: z.string().nullable().optional(),
    fromMonth: z.string().regex(MONTH, "Choose the first month"),
    toMonth: z.string().regex(MONTH).nullable().optional(),
  })
  .refine((c) => !c.toMonth || c.toMonth >= c.fromMonth, { message: "The last month is before the first month", path: ["toMonth"] })
  .refine((c) => (c.kind === "FIXED" ? c.amount > 0 : c.kind === "INCOME" ? c.percent > 0 : c.percent > 0 && !!c.categoryId), {
    message: "Enter the amount, or the %, and for a share of hospital spending the expense category",
    path: ["amount"],
  });

export async function listDepartmentCostOptions(actor: Actor) {
  const own = scopeOf(actor);
  const [departments, categories] = await Promise.all([
    prisma.serviceDepartment.findMany({ where: { active: true, ...(own ? { id: own } : {}) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, parentId: true } }),
  ]);
  return { departments, categories };
}

export async function saveDepartmentCost(actor: Actor, id: string | null, raw: unknown) {
  const parsed = costInput.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the cost");
  const c = parsed.data;
  assertCanEditCost(actor, c.departmentId);
  if (!(await prisma.serviceDepartment.findUnique({ where: { id: c.departmentId } }))) throw notFound("Department not found");
  if (c.kind === "SHARE" && !(await prisma.expenseCategory.findUnique({ where: { id: c.categoryId! } }))) throw badRequest("Expense category not found");
  const data = {
    ...c,
    amount: c.kind === "FIXED" ? c.amount : 0,
    percent: c.kind === "FIXED" ? 0 : c.percent,
    categoryId: c.kind === "SHARE" ? c.categoryId! : null,
    toMonth: c.toMonth || null,
  };
  return prisma.$transaction(async (tx) => {
    const before = id ? await tx.departmentCost.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound("Cost not found");
    if (before) assertCanEditCost(actor, before.departmentId, before.createdById);
    const saved = id ? await tx.departmentCost.update({ where: { id }, data }) : await tx.departmentCost.create({ data: { ...data, createdById: actor.id } });
    await audit(tx, actor, { action: id ? "DEPT_COST_UPDATE" : "DEPT_COST_CREATE", entityType: "DepartmentCost", entityId: saved.id, before: before ?? undefined, after: saved });
    return saved;
  });
}

export async function deleteDepartmentCost(actor: Actor, id: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.departmentCost.findUnique({ where: { id } });
    if (!before) throw notFound("Cost not found");
    assertCanEditCost(actor, before.departmentId, before.createdById);
    await tx.departmentCost.delete({ where: { id } });
    await audit(tx, actor, { action: "DEPT_COST_DELETE", entityType: "DepartmentCost", entityId: id, before });
    return { ok: true };
  });
}

export async function listDepartmentCosts(actor: Actor, departmentId: string) {
  assertDepartmentVisible(actor, departmentId);
  const rows = await prisma.departmentCost.findMany({ where: { departmentId }, orderBy: [{ fromMonth: "asc" }, { label: "asc" }] });
  return rows.map((r) => ({ ...r, amount: toNum(r.amount), percent: toNum(r.percent) }));
}

// ─────────────────────────── patient-wise income ───────────────────────────

/** One department's income patient by patient (billed lines; pharmacy margin is not patient-wise). */
export async function departmentPatients(actor: Actor, q: { departmentId?: string | null; from?: string | null; to?: string | null }) {
  assertDepartmentVisible(actor, q.departmentId ?? "");
  const today = todayISO();
  const to = (q.to && isISODate(q.to) ? q.to : today) as ISODate;
  const from = (q.from && isISODate(q.from) ? q.from : `${today.slice(0, 4)}-01-01`) as ISODate;
  const depts = await loadDepartments();
  const dept = depts.find((d) => d.id === q.departmentId);
  if (!dept) throw notFound("Department not found");
  const rows = await prisma.$queryRaw<
    { stream: string; name: string | null; patient: string | null; code: string | null; pname: string | null; ref: string | null; n: Prisma.Decimal; amount: Prisma.Decimal }[]
  >`
    SELECT v.stream, COALESCE(ct.name, li.name, ds.name, at.name, o.source) AS name, v.patient_key AS patient,
           p."patientCode" AS code, p.name AS pname, o.reference AS ref,
           SUM(CASE WHEN v.source_table = 'LabTransaction' THEN v.units ELSE 1 END) AS n, SUM(v.amount) AS amount
      FROM v_income_line v
      LEFT JOIN "ConsultationType" ct ON v.source_table = 'Consultation' AND ct.id = v.item_id
      LEFT JOIN "LabInvestigation" li ON v.source_table = 'LabTransaction' AND li.id = v.item_id
      LEFT JOIN "DietService" ds ON v.source_table = 'DietTransaction' AND ds.id = v.item_id
      LEFT JOIN "AdmissionType" at ON v.source_table = 'IpdTransaction' AND at.id = v.item_id
      LEFT JOIN "OtherIncome" o ON v.source_table = 'OtherIncome' AND o.id = v.source_id
      LEFT JOIN "Patient" p ON p.id = v.patient_key
     WHERE v.stream <> 'PHARMACY' AND v.date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
     GROUP BY 1, 2, 3, 4, 5, 6`;
  // JJ Wellness package payments carry the patient ID in their reference ("JJW-58900"; "JJW-ROW12" when the row had none).
  const refCodeOf = (ref: string | null) => /^JJW-(?!ROW\d)([^\s-]+)/.exec(ref ?? "")?.[1] ?? null;
  const codes = [...new Set(rows.map((r) => refCodeOf(r.ref)).filter(Boolean) as string[])];
  const byCode = new Map((await prisma.patient.findMany({ where: { patientCode: { in: codes } }, select: { patientCode: true, name: true } })).map((p) => [p.patientCode, p.name]));
  const patients = new Map<string, { key: string; code: string | null; name: string; bills: number; total: number; items: Record<string, number> }>();
  for (const r of rows) {
    for (const part of place(depts, r.stream, r.name, toNum(r.n), toNum(r.amount))) {
      if (part.deptId !== dept.id || !part.amount) continue;
      const refCode = refCodeOf(r.ref);
      const code = r.code ?? refCode;
      const name = r.pname ?? (refCode ? byCode.get(refCode) : null) ?? (r.patient?.startsWith("name:") ? r.patient.slice(5) : null) ?? "(no patient)";
      const key = code ?? r.patient ?? name;
      const p = patients.get(key) ?? { key, code, name, bills: 0, total: 0, items: {} };
      p.bills += toNum(r.n);
      p.total = round2(p.total + part.amount);
      const label = r.name ?? r.stream;
      p.items[label] = round2((p.items[label] ?? 0) + part.amount);
      patients.set(key, p);
    }
  }
  const list = [...patients.values()].sort((a, b) => b.total - a.total);
  return { department: dept.name, from, to, patients: list, total: round2(list.reduce((a, p) => a + p.total, 0)) };
}

// ─────────────────────────── contributors and their incentives ───────────────────────────

const contributorInput = z.object({
  departmentId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  incentivePct: z.coerce.number().min(0).max(100).default(0),
  active: z.boolean().default(true),
});

export async function saveContributor(actor: Actor, id: string | null, raw: unknown) {
  requireAdmin(actor);
  const parsed = contributorInput.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the person");
  const c = parsed.data;
  if (!(await prisma.serviceDepartment.findUnique({ where: { id: c.departmentId } }))) throw notFound("Department not found");
  return prisma.$transaction(async (tx) => {
    const before = id ? await tx.departmentContributor.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound("Person not found");
    const saved = id ? await tx.departmentContributor.update({ where: { id }, data: c }) : await tx.departmentContributor.create({ data: { ...c, createdById: actor.id } });
    await audit(tx, actor, {
      action: id ? "DEPT_CONTRIBUTOR_UPDATE" : "DEPT_CONTRIBUTOR_CREATE",
      entityType: "DepartmentContributor",
      entityId: saved.id,
      before: before ?? undefined,
      after: saved,
    });
    return saved;
  });
}

export async function deleteContributor(actor: Actor, id: string) {
  requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const before = await tx.departmentContributor.findUnique({ where: { id }, include: { incomes: true } });
    if (!before) throw notFound("Person not found");
    await tx.departmentContributor.delete({ where: { id } });
    await audit(tx, actor, { action: "DEPT_CONTRIBUTOR_DELETE", entityType: "DepartmentContributor", entityId: id, before });
    return { ok: true };
  });
}

/** The income a person generated in one month (empty or 0 clears it). */
export async function setContributorIncome(actor: Actor, id: string, raw: unknown) {
  requireAdmin(actor);
  const { month, amount } = z.object({ month: z.string().regex(MONTH, "Month as 2026-04"), amount: z.coerce.number().min(0).max(99_99_99_999).nullable() }).parse(raw);
  return prisma.$transaction(async (tx) => {
    if (!(await tx.departmentContributor.findUnique({ where: { id } }))) throw notFound("Person not found");
    const before = await tx.contributorIncome.findUnique({ where: { contributorId_month: { contributorId: id, month } } });
    const after = amount
      ? await tx.contributorIncome.upsert({ where: { contributorId_month: { contributorId: id, month } }, create: { contributorId: id, month, amount }, update: { amount } })
      : before
        ? (await tx.contributorIncome.delete({ where: { id: before.id } }), null)
        : null;
    await audit(tx, actor, {
      action: "DEPT_CONTRIBUTOR_INCOME",
      entityType: "DepartmentContributor",
      entityId: id,
      before: before ?? undefined,
      after: after ?? { month, amount: null },
    });
    return { ok: true };
  });
}

function requireAdmin(actor: Actor) {
  if (!can(actor, "masters.manage")) throw forbidden("Only an Admin can change incentives");
}

// ─────────────────────────── import costs and people from Excel ───────────────────────────

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-04", "Apr 2026", "April 2026", "04/2026" or an Excel date → "2026-04"; null when it is not a month. */
export function monthOf(v: unknown): string | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^([a-z]{3})[a-z]*[\s'-]*(\d{2}|\d{4})$/.exec(s);
  if (m && MONTH_NAMES.includes(m[1])) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${String(MONTH_NAMES.indexOf(m[1]) + 1).padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${m[1].padStart(2, "0")}`;
  return null;
}

const amountOf = (v: unknown) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * One workbook books a department's costs and people:
 *  - a sheet with "What is it | Amount per month | From month | Until month" (and optionally
 *    "% of department income" instead of an amount, for incentives): monthly costs (salaries, other
 *    expenses, incentives); a row with the same name and first month is updated, not repeated;
 *  - a sheet with "Person | Incentive % | <one column per month>": people who bring income, with the
 *    income they generated each month.
 */
export async function importDepartmentWorkbook(actor: Actor, departmentId: string | null, fileName: string, buf: Buffer) {
  // The Admin imports for any department; a department head imports costs for their own department.
  const admin = can(actor, "masters.manage");
  if (!admin && !actor.headOfDepartmentId) throw forbidden("Only an Admin or a department head can import department costs");
  const all = await prisma.serviceDepartment.findMany({ where: { active: true }, select: { id: true, name: true } });
  const dept = departmentId ? all.find((d) => d.id === departmentId) : null;
  if (departmentId && !dept) throw notFound("Department not found");
  // A "Department" column books each row to the department it names (one sheet for every department).
  const byName = new Map(all.map((d) => [norm(d.name), d]));
  const findDept = (v: unknown) => {
    const n = norm(v);
    return byName.get(n) ?? all.find((d) => norm(d.name).startsWith(n) && n.length >= 3) ?? null;
  };
  const { readSpreadsheet } = await import("../spreadsheet");
  const sheets = await readSpreadsheet(fileName, buf);
  const key = (h: string) => norm(h);
  const costs: { departmentId: string; label: string; amount: number; percent: number; fromMonth: string; toMonth: string | null; row: number }[] = [];
  const people: { name: string; pct: number; incomes: [string, number | null][]; row: number }[] = [];
  const errors: string[] = [];
  // Month-grid sheets: one row per cost, one column per month (the department's monthly expenditure sheet).
  const grid = new Map<string, { departmentId: string; label: string; months: Map<string, number>; from: string; to: string }>();
  for (const sh of sheets) {
    const hs = sh.headers.map(key);
    const col = (...names: string[]) => sh.headers[hs.findIndex((h) => names.map(key).includes(h))];
    const labelCol = col("what is it", "label", "cost", "description");
    const amountCol = col("amount per month", "amount", "monthly amount");
    const fromCol = col("from month", "from");
    const personCol = col("person", "name");
    const catCol = col("category", "expense head", "head", "type");
    const monthCols = sh.headers.map((h) => [h, monthOf(h)] as const).filter(([, m]) => m) as [string, string][];
    if (catCol && monthCols.length && !amountCol && !personCol) {
      // The department: "Department: Physiotherapy" above the table, else the tab's name, else the statement it was uploaded from.
      const named = (sh.preamble ?? []).map((l) => /department\s*[:\-–]\s*(.+)/i.exec(l)?.[1]?.trim()).find(Boolean) ?? null;
      const fromSheet = named ? findDept(named) : findDept(sh.name);
      if (named && !fromSheet) {
        errors.push(`${sh.name}: no department called "${named}"`);
        continue;
      }
      const hasAmounts = sh.rows.some(
        (r) =>
          !/^(grand )?total/i.test(String(r.values[catCol] ?? "")) &&
          monthCols.some(([h]) => {
            const a = amountOf(r.values[h]);
            return a !== null && a !== 0;
          }),
      );
      // Blank tabs (e.g. the other departments' tabs of the shared workbook) are skipped.
      if (!hasAmounts) continue;
      if (fromSheet && dept && fromSheet.id !== dept.id) {
        errors.push(`${sh.name} is for ${fromSheet.name}, not ${dept.name}: upload it from ${fromSheet.name}'s statement or with "Import costs for all departments"`);
        continue;
      }
      const target = fromSheet ?? dept;
      if (!target) {
        errors.push(`${sh.name}: write "Department: <name>" above the table`);
        continue;
      }
      const nameCol = col("name / item", "name item", "employee / item", "employee item", "item", "details", "what is it", "particulars");
      const months = monthCols.map(([, m]) => m).sort();
      for (const r of sh.rows) {
        const cat = String(r.values[catCol] ?? "").trim();
        const name = nameCol ? String(r.values[nameCol] ?? "").trim() : "";
        if (!cat && !name) continue;
        if (/^(grand )?total/i.test(cat) || /^(grand )?total/i.test(name)) continue;
        const label = gridLabel(cat, name);
        for (const [h, m] of monthCols) {
          const a = amountOf(r.values[h]);
          if (a === null || a === 0) continue;
          if (Number.isNaN(a) || a < 0) {
            errors.push(`${sh.name} row ${r.rowNumber}, ${h}: not an amount`);
            continue;
          }
          const k = `${target.id}|${label}`;
          const g = grid.get(k) ?? { departmentId: target.id, label: label.slice(0, 120), months: new Map(), from: months[0], to: months[months.length - 1] };
          g.months.set(m, round2((g.months.get(m) ?? 0) + a));
          grid.set(k, g);
        }
      }
      continue;
    }
    if (labelCol && amountCol && fromCol) {
      const untilCol = col("until month", "until", "to month", "to");
      const pctCol = col("% of department income", "percent of department income", "% of income");
      const deptCol = col("department", "dept");
      const typeCol = col("type", "cost type", "kind");
      for (const r of sh.rows) {
        let label = String(r.values[labelCol] ?? "").trim();
        if (!label) continue;
        const named = deptCol ? String(r.values[deptCol] ?? "").trim() : "";
        const target = named ? findDept(named) : dept;
        if (!target) {
          errors.push(named ? `${sh.name} row ${r.rowNumber}: no department called "${named}"` : `${sh.name} row ${r.rowNumber}: choose the department`);
          continue;
        }
        // "Salary" + "Niswanth" → "Salary — Niswanth", so costs group by kind on the statement.
        const type = typeCol ? String(r.values[typeCol] ?? "").trim() : "";
        if (type && !norm(label).startsWith(norm(type))) label = `${type} — ${label}`;
        const amount = amountOf(r.values[amountCol]);
        const percent = pctCol ? amountOf(r.values[pctCol]) : null;
        const fromMonth = monthOf(r.values[fromCol]);
        const toMonth = untilCol ? monthOf(r.values[untilCol]) : null;
        const hasAmount = amount !== null && !Number.isNaN(amount) && amount > 0;
        const hasPct = percent !== null && !Number.isNaN(percent) && percent > 0 && percent <= 100;
        if (!fromMonth || hasAmount === hasPct) {
          errors.push(`${sh.name} row ${r.rowNumber}: needs a first month and either an amount or a % of department income`);
          continue;
        }
        if (toMonth && toMonth < fromMonth) {
          errors.push(`${sh.name} row ${r.rowNumber}: last month is before the first month`);
          continue;
        }
        costs.push({
          departmentId: target.id,
          label: label.slice(0, 120),
          amount: hasAmount ? round2(amount!) : 0,
          percent: hasPct ? round2(percent!) : 0,
          fromMonth,
          toMonth,
          row: r.rowNumber,
        });
      }
    } else if (personCol) {
      const pctCol = col("incentive %", "incentive", "incentive percent");
      const monthCols = sh.headers.map((h) => [h, monthOf(h)] as const).filter(([, m]) => m) as [string, string][];
      for (const r of sh.rows) {
        const name = String(r.values[personCol] ?? "").trim();
        if (!name || /^total$/i.test(name)) continue;
        const pct = pctCol ? (amountOf(r.values[pctCol]) ?? 0) : 0;
        if (Number.isNaN(pct) || pct < 0 || pct > 100) {
          errors.push(`${sh.name} row ${r.rowNumber}: incentive % must be 0–100`);
          continue;
        }
        const incomes: [string, number | null][] = [];
        for (const [h, m] of monthCols) {
          const a = amountOf(r.values[h]);
          if (Number.isNaN(a) || (a !== null && a < 0)) errors.push(`${sh.name} row ${r.rowNumber}, ${h}: not an amount`);
          else incomes.push([m, a]);
        }
        people.push({ name: name.slice(0, 80), pct: round2(pct), incomes, row: r.rowNumber });
      }
    }
  }
  if (errors.length) throw badRequest(`Nothing was saved. Fix these rows: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? ` (and ${errors.length - 8} more)` : ""}`);
  if (!costs.length && !people.length && !grid.size)
    throw badRequest(
      'No amounts found. In the monthly expenditure sheet, type the names/items and the rupees paid under each month; or use a sheet with "What is it | Amount per month | From month | Until month".',
    );
  if (people.length && !dept) throw badRequest("People and their income generated are imported from that department's statement (its Import from Excel button).");
  if (!admin) {
    const targets = new Set([...costs.map((c) => c.departmentId), ...[...grid.values()].map((g) => g.departmentId)]);
    if (people.length || [...targets].some((t) => t !== actor.headOfDepartmentId)) throw forbidden("You can import costs only for the department you head");
  }
  return prisma.$transaction(async (tx) => {
    let added = 0;
    let updated = 0;
    // A month-grid replaces what was there for the same cost in the months it covers, so a corrected
    // sheet can be uploaded again without counting anything twice. Equal amounts in a row become one range.
    for (const g of grid.values()) {
      const old = await tx.departmentCost.findMany({
        where: { departmentId: g.departmentId, label: g.label, fromMonth: { lte: g.to }, OR: [{ toMonth: null }, { toMonth: { gte: g.from } }] },
      });
      if (!admin && old.some((o) => o.createdById !== actor.id)) throw forbidden(`"${g.label}" was entered by the Admin for these months — ask the Admin to change it`);
      if (old.length) await tx.departmentCost.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      updated += old.length;
      for (const r of monthRanges(g.months)) {
        await tx.departmentCost.create({
          data: { departmentId: g.departmentId, label: g.label, kind: "FIXED", amount: r.amount, percent: 0, fromMonth: r.from, toMonth: r.to, createdById: actor.id },
        });
        added++;
      }
    }
    for (const c of costs) {
      const existing = await tx.departmentCost.findFirst({ where: { departmentId: c.departmentId, label: c.label, fromMonth: c.fromMonth } });
      const data = { kind: c.percent ? "INCOME" : "FIXED", amount: c.amount, percent: c.percent, categoryId: null, toMonth: c.toMonth };
      if (existing) {
        await tx.departmentCost.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await tx.departmentCost.create({ data: { ...data, departmentId: c.departmentId, label: c.label, fromMonth: c.fromMonth, createdById: actor.id } });
        added++;
      }
    }
    let incomeMonths = 0;
    for (const p of people) {
      const existing = await tx.departmentContributor.findFirst({ where: { departmentId: dept!.id, name: p.name } });
      const person = existing
        ? await tx.departmentContributor.update({ where: { id: existing.id }, data: { incentivePct: p.pct, active: true } })
        : await tx.departmentContributor.create({ data: { departmentId: dept!.id, name: p.name, incentivePct: p.pct, createdById: actor.id } });
      for (const [month, amount] of p.incomes) {
        if (amount) {
          await tx.contributorIncome.upsert({
            where: { contributorId_month: { contributorId: person.id, month } },
            create: { contributorId: person.id, month, amount },
            update: { amount },
          });
          incomeMonths++;
        } else await tx.contributorIncome.deleteMany({ where: { contributorId: person.id, month } });
      }
    }
    const perDepartment = [...new Set([...costs.map((c) => c.departmentId), ...[...grid.values()].map((g) => g.departmentId)])].map((id) => ({
      name: all.find((d) => d.id === id)!.name,
      rows: costs.filter((c) => c.departmentId === id).length + [...grid.values()].filter((g) => g.departmentId === id).length,
    }));
    const result = {
      department: dept?.name ?? (perDepartment.length === 1 ? perDepartment[0].name : "All departments"),
      costsAdded: added,
      costsUpdated: updated,
      people: people.length,
      incomeMonths,
      departments: perDepartment,
    };
    await audit(tx, actor, { action: "DEPT_IMPORT", entityType: "ServiceDepartment", entityId: dept?.id ?? "all", after: { fileName, ...result } });
    return result;
  });
}

/** "Salaries" + "Ravi" → "Salary — Ravi"; the kind in front makes costs group by kind on the statement. */
export function gridLabel(category: string, name: string): string {
  const c = norm(category);
  const kind = /salar/.test(c)
    ? "Salary"
    : /repair|maint/.test(c)
      ? "Repair & maintenance"
      : /consum/.test(c)
        ? "Consumables"
        : /grocer/.test(c)
          ? "Groceries"
          : /equip/.test(c)
            ? "Equipment"
            : /incentive/.test(c)
              ? "Incentive"
              : /other|specify/.test(c) || !c
                ? "Other"
                : category.trim();
  return name ? `${kind} — ${name}` : kind;
}

/** Months with amounts → ranges of consecutive months with the same amount. */
export function monthRanges(months: Map<string, number>): { from: string; to: string; amount: number }[] {
  const next = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  };
  const out: { from: string; to: string; amount: number }[] = [];
  for (const m of [...months.keys()].sort()) {
    const amount = months.get(m)!;
    const last = out[out.length - 1];
    if (last && last.amount === amount && next(last.to) === m) last.to = m;
    else out.push({ from: m, to: m, amount });
  }
  return out;
}
