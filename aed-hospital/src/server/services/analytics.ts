/**
 * Analytics queries. All income/expense figures come from the SQL views
 * v_income_line / v_expense_line (ACTIVE rows only, transaction date based),
 * so dashboards, reports and drill-downs always agree. See ACCOUNTING_RULES.md.
 */
import { Prisma } from "@prisma/client";
import {
  compare,
  derivedKpis,
  emptyExpense,
  emptyIncome,
  pharmacyMetrics,
  safeDiv,
  totalExpenses,
  totalIncome,
  type Counts,
  type ExpenseByKind,
  type IncomeByStream,
} from "@/lib/accounting";
import { daysBetweenInclusive, eachDay, fromDbDate, startOfMonth, startOfWeek, toDbDate, type ISODate } from "@/lib/dates";
import { round2, toNum } from "@/lib/money";
import type { Granularity } from "@/lib/periods";
import { prisma } from "../db";

export interface Range {
  from: ISODate;
  to: ISODate;
  label?: string;
}

export interface IncomeFilters {
  doctorId?: string;
  specialtyId?: string;
  departmentId?: string;
  stream?: string;
}

const D = (s: ISODate) => toDbDate(s);

function incomeWhere(r: Range, f: IncomeFilters = {}) {
  const parts = [Prisma.sql`date BETWEEN ${D(r.from)} AND ${D(r.to)}`];
  if (f.doctorId) parts.push(Prisma.sql`doctor_id = ${f.doctorId}`);
  if (f.specialtyId) parts.push(Prisma.sql`specialty_id = ${f.specialtyId}`);
  if (f.departmentId) parts.push(Prisma.sql`department_id = ${f.departmentId}`);
  if (f.stream) parts.push(Prisma.sql`stream = ${f.stream}`);
  return Prisma.join(parts, " AND ");
}

/** SQL expression bucketing a date column by day / ISO week (Monday) / month. */
function bucketExpr(g: Granularity, column = "date") {
  const col = Prisma.raw(column);
  if (g === "month") return Prisma.sql`date_trunc('month', ${col})::date`;
  if (g === "week") return Prisma.sql`date_trunc('week', ${col})::date`;
  return Prisma.sql`${col}`;
}

/** All bucket start dates in the range, so charts show zero-value gaps. */
export function bucketsFor(r: Range, g: Granularity): ISODate[] {
  const days = eachDay(r.from, r.to);
  const key = (d: ISODate) => (g === "month" ? startOfMonth(d) : g === "week" ? startOfWeek(d) : d);
  return [...new Set(days.map(key))];
}

const iso = (d: Date | string) => fromDbDate(d instanceof Date ? d : new Date(d));

// ─────────────────────────── core summaries ───────────────────────────

export async function incomeByStream(r: Range, f: IncomeFilters = {}): Promise<IncomeByStream> {
  const rows = await prisma.$queryRaw<{ stream: keyof IncomeByStream; amount: Prisma.Decimal }[]>`
    SELECT stream, COALESCE(SUM(amount), 0) AS amount FROM v_income_line WHERE ${incomeWhere(r, f)} GROUP BY stream`;
  const out = emptyIncome();
  for (const row of rows) out[row.stream] = toNum(row.amount);
  return out;
}

export async function expenseByKind(r: Range): Promise<ExpenseByKind> {
  const rows = await prisma.$queryRaw<{ kind: keyof ExpenseByKind; amount: Prisma.Decimal }[]>`
    SELECT kind, COALESCE(SUM(amount), 0) AS amount FROM v_expense_line
     WHERE date BETWEEN ${D(r.from)} AND ${D(r.to)} GROUP BY kind`;
  const out = emptyExpense();
  for (const row of rows) out[row.kind] = toNum(row.amount);
  return out;
}

export async function operationalCounts(r: Range): Promise<Counts> {
  const [row] = await prisma.$queryRaw<
    { new_c: bigint; old_c: bigint; adm: bigint; tests: bigint | null; pharm: bigint; patients: bigint }[]
  >`
    SELECT
      (SELECT COUNT(*) FROM "Consultation" WHERE status = 'ACTIVE' AND "visitType" = 'NEW' AND date BETWEEN ${D(r.from)} AND ${D(r.to)}) AS new_c,
      (SELECT COUNT(*) FROM "Consultation" WHERE status = 'ACTIVE' AND "visitType" = 'OLD' AND date BETWEEN ${D(r.from)} AND ${D(r.to)}) AS old_c,
      (SELECT COUNT(*) FROM "IpdAdmission" WHERE status = 'ACTIVE' AND "admissionDate" BETWEEN ${D(r.from)} AND ${D(r.to)}) AS adm,
      (SELECT COALESCE(SUM(quantity), 0) FROM "LabTransaction" WHERE status = 'ACTIVE' AND date BETWEEN ${D(r.from)} AND ${D(r.to)}) AS tests,
      (SELECT COUNT(*) FROM "PharmacySale" WHERE status = 'ACTIVE' AND date BETWEEN ${D(r.from)} AND ${D(r.to)}) AS pharm,
      (SELECT COUNT(DISTINCT k) FROM (
          SELECT patient_key AS k FROM v_income_line
           WHERE stream IN ('OPD', 'LAB', 'DIET') AND patient_key IS NOT NULL AND date BETWEEN ${D(r.from)} AND ${D(r.to)}
          UNION
          SELECT COALESCE("patientId", 'name:' || lower(trim("patientName"))) FROM "IpdAdmission"
           WHERE status = 'ACTIVE' AND "admissionDate" BETWEEN ${D(r.from)} AND ${D(r.to)}
             AND COALESCE("patientId", "patientName") IS NOT NULL
      ) p) AS patients`;
  const newC = Number(row.new_c);
  const oldC = Number(row.old_c);
  return {
    patients: Number(row.patients),
    consultations: newC + oldC,
    newConsultations: newC,
    oldConsultations: oldC,
    admissions: Number(row.adm),
    labTests: Number(row.tests ?? 0),
    pharmacyTransactions: Number(row.pharm),
  };
}

export async function periodSummary(r: Range) {
  const [income, expense, counts] = await Promise.all([incomeByStream(r), expenseByKind(r), operationalCounts(r)]);
  return { range: r, income, expense, counts, kpis: derivedKpis(income, expense, counts) };
}
export type PeriodSummary = Awaited<ReturnType<typeof periodSummary>>;

/** Metric-by-metric comparison between two periods (absolute + % with zero-base handling). */
export function compareSummaries(cur: PeriodSummary, prev: PeriodSummary) {
  const pairs: Record<string, [number, number]> = {
    totalIncome: [totalIncome(cur.income), totalIncome(prev.income)],
    totalExpenses: [totalExpenses(cur.expense), totalExpenses(prev.expense)],
    netOperatingResult: [cur.kpis.netOperatingResult, prev.kpis.netOperatingResult],
    opd: [cur.income.OPD, prev.income.OPD],
    ipd: [cur.income.IPD, prev.income.IPD],
    lab: [cur.income.LAB, prev.income.LAB],
    pharmacy: [cur.income.PHARMACY, prev.income.PHARMACY],
    diet: [cur.income.DIET, prev.income.DIET],
    other: [cur.income.OTHER, prev.income.OTHER],
    hospitalExpenses: [cur.expense.HOSPITAL, prev.expense.HOSPITAL],
    pharmacyPurchases: [cur.expense.PHARMACY_PURCHASE, prev.expense.PHARMACY_PURCHASE],
    otherExpenses: [cur.expense.OTHER, prev.expense.OTHER],
    patients: [cur.counts.patients, prev.counts.patients],
    consultations: [cur.counts.consultations, prev.counts.consultations],
    newConsultations: [cur.counts.newConsultations, prev.counts.newConsultations],
    oldConsultations: [cur.counts.oldConsultations, prev.counts.oldConsultations],
    admissions: [cur.counts.admissions, prev.counts.admissions],
    labTests: [cur.counts.labTests, prev.counts.labTests],
    pharmacyTransactions: [cur.counts.pharmacyTransactions, prev.counts.pharmacyTransactions],
  };
  return Object.fromEntries(Object.entries(pairs).map(([k, [a, b]]) => [k, compare(a, b)]));
}

// ─────────────────────────── payment modes ───────────────────────────

export async function incomeByReconGroup(r: Range) {
  const rows = await prisma.$queryRaw<{ grp: string; amount: Prisma.Decimal; lines: bigint }[]>`
    SELECT COALESCE(pm."reconGroup"::text, 'OTHER') AS grp, COALESCE(SUM(v.amount), 0) AS amount, COUNT(*) AS lines
      FROM v_income_line v LEFT JOIN "PaymentMode" pm ON pm.id = v.payment_mode_id
     WHERE v.date BETWEEN ${D(r.from)} AND ${D(r.to)}
     GROUP BY 1`;
  const out: Record<string, number> = { CASH: 0, CARD: 0, UPI: 0, BANK: 0, OTHER: 0 };
  for (const row of rows) out[row.grp] = toNum(row.amount);
  return out;
}

export async function expenseByReconGroup(r: Range) {
  const rows = await prisma.$queryRaw<{ grp: string; amount: Prisma.Decimal }[]>`
    SELECT COALESCE(pm."reconGroup"::text, 'OTHER') AS grp, COALESCE(SUM(v.amount), 0) AS amount
      FROM v_expense_line v LEFT JOIN "PaymentMode" pm ON pm.id = v.payment_mode_id
     WHERE v.date BETWEEN ${D(r.from)} AND ${D(r.to)}
     GROUP BY 1`;
  const out: Record<string, number> = { CASH: 0, CARD: 0, UPI: 0, BANK: 0, OTHER: 0 };
  for (const row of rows) out[row.grp] = toNum(row.amount);
  return out;
}

export async function incomeByStreamAndGroup(r: Range) {
  const rows = await prisma.$queryRaw<{ stream: string; grp: string; amount: Prisma.Decimal }[]>`
    SELECT v.stream, COALESCE(pm."reconGroup"::text, 'OTHER') AS grp, COALESCE(SUM(v.amount), 0) AS amount
      FROM v_income_line v LEFT JOIN "PaymentMode" pm ON pm.id = v.payment_mode_id
     WHERE v.date BETWEEN ${D(r.from)} AND ${D(r.to)}
     GROUP BY 1, 2`;
  return rows.map((x) => ({ stream: x.stream, group: x.grp, amount: toNum(x.amount) }));
}

// ─────────────────────────── time series ───────────────────────────

export async function incomeSeries(r: Range, g: Granularity, f: IncomeFilters = {}) {
  const rows = await prisma.$queryRaw<{ bucket: Date; stream: string; amount: Prisma.Decimal }[]>`
    SELECT ${bucketExpr(g)} AS bucket, stream, COALESCE(SUM(amount), 0) AS amount
      FROM v_income_line WHERE ${incomeWhere(r, f)} GROUP BY 1, 2 ORDER BY 1`;
  const expenseRows = await prisma.$queryRaw<{ bucket: Date; amount: Prisma.Decimal }[]>`
    SELECT ${bucketExpr(g)} AS bucket, COALESCE(SUM(amount), 0) AS amount
      FROM v_expense_line WHERE date BETWEEN ${D(r.from)} AND ${D(r.to)} GROUP BY 1 ORDER BY 1`;
  type Bucket = IncomeByStream & { expenses: number };
  const map = new Map<ISODate, Bucket>();
  for (const b of bucketsFor(r, g)) map.set(b, { ...emptyIncome(), expenses: 0 });
  for (const row of rows) {
    const m = map.get(iso(row.bucket));
    if (m) m[row.stream as keyof IncomeByStream] = toNum(row.amount);
  }
  for (const row of expenseRows) {
    const m = map.get(iso(row.bucket));
    if (m) m.expenses = toNum(row.amount);
  }
  return [...map.entries()].map(([bucket, v]) => {
    const income = round2(v.OPD + v.IPD + v.LAB + v.PHARMACY + v.DIET + v.OTHER);
    return { bucket, ...v, income, net: round2(income - v.expenses) };
  });
}

// ─────────────────────────── module analytics ───────────────────────────

export async function revenueAnalytics(r: Range, g: Granularity, f: IncomeFilters) {
  const [series, byStream, byDoctor, bySpecialty] = await Promise.all([
    incomeSeries(r, g, f),
    incomeByStream(r, f),
    prisma.$queryRaw<{ id: string | null; name: string | null; amount: Prisma.Decimal }[]>`
      SELECT v.doctor_id AS id, d.name, SUM(v.amount) AS amount FROM v_income_line v LEFT JOIN "Doctor" d ON d.id = v.doctor_id
       WHERE ${incomeWhere(r, f)} AND v.doctor_id IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`,
    prisma.$queryRaw<{ id: string | null; name: string | null; amount: Prisma.Decimal }[]>`
      SELECT v.specialty_id AS id, s.name, SUM(v.amount) AS amount FROM v_income_line v LEFT JOIN "Specialty" s ON s.id = v.specialty_id
       WHERE ${incomeWhere(r, f)} AND v.specialty_id IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC`,
  ]);
  return {
    series,
    byStream,
    total: totalIncome(byStream),
    byDoctor: byDoctor.map((x) => ({ id: x.id, name: x.name ?? "—", amount: toNum(x.amount) })),
    bySpecialty: bySpecialty.map((x) => ({ id: x.id, name: x.name ?? "—", amount: toNum(x.amount) })),
  };
}

export async function opdAnalytics(r: Range, g: Granularity, f: IncomeFilters = {}) {
  const extra = [
    f.doctorId ? Prisma.sql`AND c."doctorId" = ${f.doctorId}` : Prisma.empty,
    f.specialtyId ? Prisma.sql`AND c."specialtyId" = ${f.specialtyId}` : Prisma.empty,
  ];
  const base = Prisma.sql`c.status = 'ACTIVE' AND c.date BETWEEN ${D(r.from)} AND ${D(r.to)} ${extra[0]} ${extra[1]}`;
  const [bySpecialty, byDoctor, byType, trend] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; new_c: bigint; old_c: bigint; revenue: Prisma.Decimal }[]>`
      SELECT s.id, s.name,
             COUNT(*) FILTER (WHERE c."visitType" = 'NEW') AS new_c,
             COUNT(*) FILTER (WHERE c."visitType" = 'OLD') AS old_c,
             COALESCE(SUM(c."netAmount"), 0) AS revenue
        FROM "Consultation" c JOIN "Specialty" s ON s.id = c."specialtyId"
       WHERE ${base} GROUP BY s.id, s.name, s."sortOrder" ORDER BY s."sortOrder", s.name`,
    prisma.$queryRaw<{ id: string | null; name: string | null; new_c: bigint; old_c: bigint; revenue: Prisma.Decimal }[]>`
      SELECT d.id, d.name,
             COUNT(*) FILTER (WHERE c."visitType" = 'NEW') AS new_c,
             COUNT(*) FILTER (WHERE c."visitType" = 'OLD') AS old_c,
             COALESCE(SUM(c."netAmount"), 0) AS revenue
        FROM "Consultation" c LEFT JOIN "Doctor" d ON d.id = c."doctorId"
       WHERE ${base} GROUP BY d.id, d.name ORDER BY revenue DESC`,
    prisma.$queryRaw<{ id: string | null; name: string | null; cnt: bigint; revenue: Prisma.Decimal }[]>`
      SELECT t.id, t.name, COUNT(*) AS cnt, COALESCE(SUM(c."netAmount"), 0) AS revenue
        FROM "Consultation" c LEFT JOIN "ConsultationType" t ON t.id = c."consultationTypeId"
       WHERE ${base} GROUP BY t.id, t.name ORDER BY cnt DESC`,
    prisma.$queryRaw<{ bucket: Date; new_c: bigint; old_c: bigint; revenue: Prisma.Decimal }[]>`
      SELECT ${bucketExpr(g)} AS bucket,
             COUNT(*) FILTER (WHERE "visitType" = 'NEW') AS new_c,
             COUNT(*) FILTER (WHERE "visitType" = 'OLD') AS old_c,
             COALESCE(SUM("netAmount"), 0) AS revenue
        FROM "Consultation" c WHERE ${base} GROUP BY 1 ORDER BY 1`,
  ]);
  const trendMap = new Map(bucketsFor(r, g).map((b) => [b, { bucket: b, new: 0, old: 0, total: 0, revenue: 0 }]));
  for (const t of trend) {
    const m = trendMap.get(iso(t.bucket));
    if (m) Object.assign(m, { new: Number(t.new_c), old: Number(t.old_c), total: Number(t.new_c) + Number(t.old_c), revenue: toNum(t.revenue) });
  }
  const specialties = bySpecialty.map((s) => ({ id: s.id, name: s.name, new: Number(s.new_c), old: Number(s.old_c), total: Number(s.new_c) + Number(s.old_c), revenue: toNum(s.revenue) }));
  const totalNew = specialties.reduce((a, s) => a + s.new, 0);
  const totalOld = specialties.reduce((a, s) => a + s.old, 0);
  const revenue = round2(specialties.reduce((a, s) => a + s.revenue, 0));
  return {
    totals: {
      new: totalNew,
      old: totalOld,
      total: totalNew + totalOld,
      revenue,
      avgRevenue: safeDiv(revenue, totalNew + totalOld),
      newPct: safeDiv(totalNew * 100, totalNew + totalOld),
    },
    bySpecialty: specialties,
    byDoctor: byDoctor.map((s) => ({ id: s.id, name: s.name ?? "Unassigned", new: Number(s.new_c), old: Number(s.old_c), total: Number(s.new_c) + Number(s.old_c), revenue: toNum(s.revenue) })),
    byType: byType.map((t) => ({ id: t.id, name: t.name ?? "Unspecified", count: Number(t.cnt), revenue: toNum(t.revenue) })),
    trend: [...trendMap.values()],
  };
}

export async function labAnalytics(r: Range, g: Granularity, f: { doctorId?: string; departmentId?: string } = {}) {
  const extra = Prisma.sql`${f.doctorId ? Prisma.sql`AND l."referringDoctorId" = ${f.doctorId}` : Prisma.empty} ${f.departmentId ? Prisma.sql`AND l."departmentId" = ${f.departmentId}` : Prisma.empty}`;
  const base = Prisma.sql`l.status = 'ACTIVE' AND l.date BETWEEN ${D(r.from)} AND ${D(r.to)} ${extra}`;
  const [byInv, trend, byCategory] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; category: string; tests: bigint; revenue: Prisma.Decimal }[]>`
      SELECT i.id, i.name, i.category, COALESCE(SUM(l.quantity), 0) AS tests, COALESCE(SUM(l."netAmount"), 0) AS revenue
        FROM "LabTransaction" l JOIN "LabInvestigation" i ON i.id = l."investigationId"
       WHERE ${base} GROUP BY i.id, i.name, i.category`,
    prisma.$queryRaw<{ bucket: Date; tests: bigint; revenue: Prisma.Decimal }[]>`
      SELECT ${bucketExpr(g)} AS bucket, COALESCE(SUM(quantity), 0) AS tests, COALESCE(SUM("netAmount"), 0) AS revenue
        FROM "LabTransaction" l WHERE ${base} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ category: string; tests: bigint; revenue: Prisma.Decimal }[]>`
      SELECT i.category, COALESCE(SUM(l.quantity), 0) AS tests, COALESCE(SUM(l."netAmount"), 0) AS revenue
        FROM "LabTransaction" l JOIN "LabInvestigation" i ON i.id = l."investigationId"
       WHERE ${base} GROUP BY 1 ORDER BY 3 DESC`,
  ]);
  const investigations = byInv.map((x) => {
    const tests = Number(x.tests);
    const revenue = toNum(x.revenue);
    return { id: x.id, name: x.name, category: x.category, tests, revenue, avg: safeDiv(revenue, tests) };
  });
  const trendMap = new Map(bucketsFor(r, g).map((b) => [b, { bucket: b, tests: 0, revenue: 0 }]));
  for (const t of trend) {
    const m = trendMap.get(iso(t.bucket));
    if (m) Object.assign(m, { tests: Number(t.tests), revenue: toNum(t.revenue) });
  }
  const tests = investigations.reduce((a, x) => a + x.tests, 0);
  const revenue = round2(investigations.reduce((a, x) => a + x.revenue, 0));
  return {
    totals: { tests, revenue, avgPerTest: safeDiv(revenue, tests), avgTestsPerDay: safeDiv(tests, daysBetweenInclusive(r.from, r.to)) },
    investigations,
    byCategory: byCategory.map((c) => ({ category: c.category, tests: Number(c.tests), revenue: toNum(c.revenue) })),
    trend: [...trendMap.values()],
  };
}

/** One investigation's counts per bucket, e.g. "ECGs per week this month". */
export async function labTestTrend(r: Range, g: Granularity, investigationId: string, f: { doctorId?: string; departmentId?: string } = {}) {
  const extra = Prisma.sql`${f.doctorId ? Prisma.sql`AND l."referringDoctorId" = ${f.doctorId}` : Prisma.empty} ${f.departmentId ? Prisma.sql`AND l."departmentId" = ${f.departmentId}` : Prisma.empty}`;
  const [inv, rows] = await Promise.all([
    prisma.labInvestigation.findUnique({ where: { id: investigationId }, select: { id: true, name: true, category: true } }),
    prisma.$queryRaw<{ bucket: Date; tests: bigint; revenue: Prisma.Decimal; patients: bigint }[]>`
      SELECT ${bucketExpr(g)} AS bucket, COALESCE(SUM(quantity), 0) AS tests, COALESCE(SUM("netAmount"), 0) AS revenue,
             COUNT(DISTINCT COALESCE(l."patientId", l.id)) AS patients
        FROM "LabTransaction" l
       WHERE l.status = 'ACTIVE' AND l."investigationId" = ${investigationId} AND l.date BETWEEN ${D(r.from)} AND ${D(r.to)} ${extra}
       GROUP BY 1 ORDER BY 1`,
  ]);
  if (!inv) return null;
  const trend = new Map(bucketsFor(r, g).map((b) => [b, { bucket: b, tests: 0, revenue: 0 }]));
  for (const t of rows) {
    const m = trend.get(iso(t.bucket));
    if (m) Object.assign(m, { tests: Number(t.tests), revenue: toNum(t.revenue) });
  }
  const series = [...trend.values()];
  const tests = series.reduce((a, x) => a + x.tests, 0);
  const revenue = round2(series.reduce((a, x) => a + x.revenue, 0));
  const busiest = series.reduce<(typeof series)[number] | null>((a, x) => (x.tests > (a?.tests ?? 0) ? x : a), null);
  return { ...inv, tests, revenue, avgPerBucket: safeDiv(tests, series.length), busiest, trend: series };
}

export async function ipdAnalytics(r: Range, g: Granularity, f: { doctorId?: string } = {}) {
  const docA = f.doctorId ? Prisma.sql`AND a."doctorId" = ${f.doctorId}` : Prisma.empty;
  const docV = f.doctorId ? Prisma.sql`AND v.doctor_id = ${f.doctorId}` : Prisma.empty;
  const [byType, collections, trend, outstanding] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; cnt: bigint; billed: Prisma.Decimal }[]>`
      SELECT t.id, t.name, COUNT(a.id) AS cnt, COALESCE(SUM(a."netAmount"), 0) AS billed
        FROM "AdmissionType" t LEFT JOIN "IpdAdmission" a
          ON a."admissionTypeId" = t.id AND a.status = 'ACTIVE' AND a."admissionDate" BETWEEN ${D(r.from)} AND ${D(r.to)} ${docA}
       GROUP BY t.id, t.name ORDER BY t.name`,
    prisma.$queryRaw<{ id: string; amount: Prisma.Decimal; sub: string }[]>`
      SELECT v.item_id AS id, v.sub_kind AS sub, COALESCE(SUM(v.amount), 0) AS amount FROM v_income_line v
       WHERE v.stream = 'IPD' AND v.date BETWEEN ${D(r.from)} AND ${D(r.to)} ${docV} GROUP BY 1, 2`,
    prisma.$queryRaw<{ bucket: Date; cnt: bigint; billed: Prisma.Decimal }[]>`
      SELECT ${bucketExpr(g, 'a."admissionDate"')} AS bucket,
             COUNT(*) AS cnt, COALESCE(SUM(a."netAmount"), 0) AS billed
        FROM "IpdAdmission" a WHERE a.status = 'ACTIVE' AND a."admissionDate" BETWEEN ${D(r.from)} AND ${D(r.to)} ${docA} GROUP BY 1 ORDER BY 1`,
    outstandingIpd(r.to, f.doctorId),
  ]);
  const collectedByType = new Map<string, number>();
  const bySub: Record<string, number> = { ADVANCE: 0, PAYMENT: 0, FINAL_SETTLEMENT: 0, REFUND: 0 };
  for (const c of collections) {
    collectedByType.set(c.id, round2((collectedByType.get(c.id) ?? 0) + toNum(c.amount)));
    bySub[c.sub] = round2((bySub[c.sub] ?? 0) + toNum(c.amount));
  }
  const types = byType.map((t) => ({ id: t.id, name: t.name, admissions: Number(t.cnt), billed: toNum(t.billed), collected: collectedByType.get(t.id) ?? 0 }));
  const admissions = types.reduce((a, t) => a + t.admissions, 0);
  const billed = round2(types.reduce((a, t) => a + t.billed, 0));
  const collected = round2([...collectedByType.values()].reduce((a, b) => a + b, 0));
  const trendMap = new Map(bucketsFor(r, g).map((b) => [b, { bucket: b, admissions: 0, billed: 0 }]));
  for (const t of trend) {
    const m = trendMap.get(iso(t.bucket));
    if (m) Object.assign(m, { admissions: Number(t.cnt), billed: toNum(t.billed) });
  }
  return {
    totals: { admissions, billed, collected, avgAdmissionValue: safeDiv(billed, admissions), outstanding: outstanding.total, outstandingCount: outstanding.count },
    byType: types,
    collectionsByKind: { advances: bySub.ADVANCE, payments: round2(bySub.PAYMENT + bySub.FINAL_SETTLEMENT), refunds: round2(-bySub.REFUND) },
    trend: [...trendMap.values()],
    outstandingList: outstanding.list,
  };
}

/** Outstanding IPD balance (billed − collected) for all ACTIVE admissions admitted on or before `asOf`. */
export async function outstandingIpd(asOf: ISODate, doctorId?: string) {
  const rows = await prisma.$queryRaw<{ id: string; patient_name: string | null; admission_date: Date; billed: Prisma.Decimal; collected: Prisma.Decimal }[]>`
    SELECT a.id, a."patientName" AS patient_name, a."admissionDate" AS admission_date, a."netAmount" AS billed,
           COALESCE(SUM(CASE WHEN t.type = 'REFUND' THEN -t.amount ELSE t.amount END) FILTER (WHERE t.status = 'ACTIVE' AND t.date <= ${D(asOf)}), 0) AS collected
      FROM "IpdAdmission" a LEFT JOIN "IpdTransaction" t ON t."admissionId" = a.id
     WHERE a.status = 'ACTIVE' AND a."admissionDate" <= ${D(asOf)} ${doctorId ? Prisma.sql`AND a."doctorId" = ${doctorId}` : Prisma.empty}
     GROUP BY a.id
    HAVING a."netAmount" - COALESCE(SUM(CASE WHEN t.type = 'REFUND' THEN -t.amount ELSE t.amount END) FILTER (WHERE t.status = 'ACTIVE' AND t.date <= ${D(asOf)}), 0) > 0
     ORDER BY a."admissionDate"`;
  const list = rows.map((x) => ({ id: x.id, patientName: x.patient_name, admissionDate: iso(x.admission_date), billed: toNum(x.billed), collected: toNum(x.collected), balance: round2(toNum(x.billed) - toNum(x.collected)) }));
  return { total: round2(list.reduce((a, x) => a + x.balance, 0)), count: list.length, list: list.slice(0, 50) };
}

export async function pharmacyAnalytics(r: Range, g: Granularity) {
  const [salesAgg, returnsAgg, purchasesAgg, trend] = await Promise.all([
    prisma.pharmacySale.aggregate({ where: { status: "ACTIVE", date: { gte: D(r.from), lte: D(r.to) } }, _sum: { grossAmount: true, discount: true, netAmount: true }, _count: true }),
    prisma.pharmacyReturn.aggregate({ where: { status: "ACTIVE", date: { gte: D(r.from), lte: D(r.to) } }, _sum: { amount: true }, _count: true }),
    prisma.pharmacyPurchase.aggregate({ where: { status: "ACTIVE", date: { gte: D(r.from), lte: D(r.to) } }, _sum: { amount: true }, _count: true }),
    prisma.$queryRaw<{ bucket: Date; sales: Prisma.Decimal; returns: Prisma.Decimal; purchases: Prisma.Decimal }[]>`
      SELECT bucket, SUM(sales) AS sales, SUM(returns) AS returns, SUM(purchases) AS purchases FROM (
        SELECT ${bucketExpr(g)} AS bucket, "netAmount" AS sales, 0 AS returns, 0 AS purchases FROM "PharmacySale" WHERE status = 'ACTIVE' AND date BETWEEN ${D(r.from)} AND ${D(r.to)}
        UNION ALL SELECT ${bucketExpr(g)}, 0, amount, 0 FROM "PharmacyReturn" WHERE status = 'ACTIVE' AND date BETWEEN ${D(r.from)} AND ${D(r.to)}
        UNION ALL SELECT ${bucketExpr(g)}, 0, 0, amount FROM "PharmacyPurchase" WHERE status = 'ACTIVE' AND date BETWEEN ${D(r.from)} AND ${D(r.to)}
      ) x GROUP BY bucket ORDER BY bucket`,
  ]);
  const metrics = pharmacyMetrics({
    grossSales: toNum(salesAgg._sum.grossAmount),
    discount: toNum(salesAgg._sum.discount),
    returns: toNum(returnsAgg._sum.amount),
    purchases: toNum(purchasesAgg._sum.amount),
  });
  const trendMap = new Map(bucketsFor(r, g).map((b) => [b, { bucket: b, sales: 0, returns: 0, netSales: 0, purchases: 0 }]));
  for (const t of trend) {
    const m = trendMap.get(iso(t.bucket));
    if (m) {
      const sales = toNum(t.sales);
      const returns = toNum(t.returns);
      Object.assign(m, { sales, returns, netSales: round2(sales - returns), purchases: toNum(t.purchases) });
    }
  }
  return {
    totals: {
      grossSales: toNum(salesAgg._sum.grossAmount),
      discount: toNum(salesAgg._sum.discount),
      ...metrics,
      transactions: salesAgg._count,
      returnCount: returnsAgg._count,
      purchaseCount: purchasesAgg._count,
      avgSale: safeDiv(toNum(salesAgg._sum.netAmount), salesAgg._count),
    },
    trend: [...trendMap.values()],
  };
}

export async function expenseAnalytics(r: Range, g: Granularity, f: { departmentId?: string; categoryId?: string } = {}) {
  const ef = Prisma.sql`${f.departmentId ? Prisma.sql`AND e."departmentId" = ${f.departmentId}` : Prisma.empty} ${f.categoryId ? Prisma.sql`AND e."categoryId" = ${f.categoryId}` : Prisma.empty}`;
  const [byKind, byCategory, byDepartment, byMonth, series, largest] = await Promise.all([
    expenseByKind(r),
    prisma.$queryRaw<{ id: string; name: string; grp: string; amount: Prisma.Decimal; cnt: bigint }[]>`
      SELECT c.id, c.name, c."group"::text AS grp, SUM(e.amount) AS amount, COUNT(*) AS cnt
        FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId"
       WHERE e.status = 'ACTIVE' AND e.date BETWEEN ${D(r.from)} AND ${D(r.to)} ${ef} GROUP BY 1, 2, 3 ORDER BY 4 DESC`,
    prisma.$queryRaw<{ id: string | null; name: string | null; amount: Prisma.Decimal }[]>`
      SELECT d.id, d.name, SUM(e.amount) AS amount FROM "Expense" e LEFT JOIN "Department" d ON d.id = e."departmentId"
       WHERE e.status = 'ACTIVE' AND e.date BETWEEN ${D(r.from)} AND ${D(r.to)} ${ef} GROUP BY 1, 2 ORDER BY 3 DESC`,
    prisma.$queryRaw<{ bucket: Date; amount: Prisma.Decimal }[]>`
      SELECT date_trunc('month', date)::date AS bucket, SUM(amount) AS amount FROM v_expense_line
       WHERE date BETWEEN ${D(r.from)} AND ${D(r.to)} GROUP BY 1 ORDER BY 1`,
    incomeSeries(r, g),
    prisma.expense.findMany({
      where: { status: "ACTIVE", date: { gte: D(r.from), lte: D(r.to) } },
      orderBy: { amount: "desc" },
      take: 10,
      include: { category: true },
    }),
  ]);
  const total = totalExpenses(byKind);
  return {
    totals: { total, ...byKind, avgDaily: safeDiv(total, daysBetweenInclusive(r.from, r.to)) },
    byCategory: byCategory.map((c) => ({ id: c.id, name: c.name, group: c.grp, amount: toNum(c.amount), count: Number(c.cnt) })),
    byDepartment: byDepartment.map((d) => ({ id: d.id, name: d.name ?? "Unassigned", amount: toNum(d.amount) })),
    byMonth: byMonth.map((m) => ({ bucket: iso(m.bucket), amount: toNum(m.amount) })),
    incomeVsExpense: series.map((s) => ({ bucket: s.bucket, income: s.income, expenses: s.expenses, net: s.net })),
    largest: largest.map((e) => ({ id: e.id, date: iso(e.date), description: e.description, category: e.category.name, amount: toNum(e.amount) })),
  };
}

export async function profitabilityAnalytics(r: Range, g: Granularity) {
  const [summary, series] = await Promise.all([periodSummary(r), incomeSeries(r, g)]);
  return { ...summary, totals: { income: totalIncome(summary.income), expenses: totalExpenses(summary.expense) }, series };
}
