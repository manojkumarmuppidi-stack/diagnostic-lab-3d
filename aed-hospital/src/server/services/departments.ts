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
  return compileDepartments(rules.map((r) => ({ ...r, addOnAmount: toNum(r.addOnAmount), pharmacyIncentivePct: toNum(r.pharmacyIncentivePct), partnerSharePct: toNum(r.partnerSharePct) })));
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
  const [depts, rows, costs, medicineRows] = await Promise.all([
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
    for (const p of place(depts, r.stream, r.name, count, amount)) add(p.deptId ? groups.get(p.deptId)! : unassignedGroup(r.stream), p.label ?? itemName, r.stream, r.m, count, p.amount);
  }
  const finish = (gs: Group[]) => gs.map((g) => ({ ...g, items: g.items.sort((a, b) => b.total - a.total) }));
  const departments = finish([...groups.values()]);
  const rest = finish([...unassigned.values()].sort((a, b) => b.total - a.total));
  const totals: Record<string, number> = {};
  for (const m of months) totals[m] = round2([...departments, ...rest].reduce((a, g) => a + (g.byMonth[m] ?? 0), 0));
  const profit = await departmentProfit(depts, departments, months, calendarMonths, byDay, costs, medicineRows);
  const result = {
    from,
    to,
    granularity: byDay ? "day" : "month",
    months,
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
  costs: { id: string; departmentId: string; label: string; kind: string; amount: Prisma.Decimal; percent: Prisma.Decimal; categoryId: string | null; fromMonth: string; toMonth: string | null }[],
  medicineRows: { m: string; name: string; amount: Prisma.Decimal; taxable: Prisma.Decimal | null; cost: Prisma.Decimal | null; nocost: bigint }[],
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
    if (medicines.size) incomeLines.push({ name: `Injection margin (sales ${formatShort(sum(sales))}, without GST, after purchase cost)`, stream: "PHARMACY", count: 0, byMonth: margin, total: sum(margin) });
    const costLines: { id: string | null; label: string; basis: string; byMonth: Money; total: number }[] = [];
    for (const c of costs.filter((x) => x.departmentId === d.id)) {
      const byMonth: Money = {};
      for (const m of months) {
        const month = m.slice(0, 7);
        if (!inMonths(c, month)) continue;
        const monthly = c.kind === "SHARE" ? ((byCategory.get(c.categoryId ?? "")?.[month] ?? 0) * toNum(c.percent)) / 100 : toNum(c.amount);
        const v = round2(byDay ? monthly / daysIn(month) : monthly);
        if (v) byMonth[m] = v;
      }
      const basis = c.kind === "SHARE" ? `${toNum(c.percent)}% of ${catName.get(c.categoryId ?? "") ?? "a deleted category"}` : `₹${toNum(c.amount).toLocaleString("en-IN")} a month`;
      costLines.push({ id: c.id, label: c.label, basis: `${basis} · ${c.fromMonth}${c.toMonth ? ` to ${c.toMonth}` : " onwards"}`, byMonth, total: sum(byMonth) });
    }
    if (sum(incentive)) costLines.push({ id: null, label: `Staff incentive ${d.pharmacyIncentivePct}% of injection sales`, basis: "calculated from the pharmacy's medicine-wise sales", byMonth: incentive, total: sum(incentive) });
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
    partners: byDay ? [] : [...partners.values()].map((p) => {
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
    kind: z.enum(["FIXED", "SHARE"]),
    amount: z.coerce.number().min(0).max(99_99_99_999).default(0),
    percent: z.coerce.number().min(0).max(100).default(0),
    categoryId: z.string().nullable().optional(),
    fromMonth: z.string().regex(MONTH, "Choose the first month"),
    toMonth: z.string().regex(MONTH).nullable().optional(),
  })
  .refine((c) => !c.toMonth || c.toMonth >= c.fromMonth, { message: "The last month is before the first month", path: ["toMonth"] })
  .refine((c) => (c.kind === "FIXED" ? c.amount > 0 : c.percent > 0 && !!c.categoryId), { message: "Enter the amount, or the % and the expense category", path: ["amount"] });

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
  const data = { ...c, amount: c.kind === "FIXED" ? c.amount : 0, percent: c.kind === "SHARE" ? c.percent : 0, categoryId: c.kind === "SHARE" ? c.categoryId! : null, toMonth: c.toMonth || null };
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
  const rows = await prisma.$queryRaw<{ stream: string; name: string | null; patient: string | null; code: string | null; pname: string | null; ref: string | null; n: Prisma.Decimal; amount: Prisma.Decimal }[]>`
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
