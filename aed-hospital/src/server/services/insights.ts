/**
 * Comparison + insight payloads for module pages and the Board Meeting pack.
 * Each section = KPIs (current vs previous), breakdown comparisons (bars / pies)
 * and generated insights. Figures come from the same analytics services as the
 * dashboard, so every number reconciles with Daily Accounts and Reports.
 */
import { Prisma } from "@prisma/client";
import { EXPENSE_LABELS, STREAM_LABELS, totalExpenses, totalIncome, AED_INCOME_STREAMS } from "@/lib/accounting";
import { addMonths, endOfMonth, startOfMonth, todayISO, toDbDate, formatMonth } from "@/lib/dates";
import { crossInsights, insightsFromComparison, insightsFromKpis, rankInsights, type Comparison, type Insight, type KpiCompare } from "@/lib/insights";
import { round2, toNum } from "@/lib/money";
import { defaultGranularity, resolvePeriod, type CompareMode, type DateRange, type PeriodPreset } from "@/lib/periods";
import { can, requireAnyPermission, requirePermission, type Actor } from "../authz";
import { prisma } from "../db";
import { getSettings } from "../settings";
import {
  expenseAnalytics,
  incomeByReconGroup,
  ipdAnalytics,
  labAnalytics,
  opdAnalytics,
  periodSummary,
  pharmacyAnalytics,
  pharmacyItemAnalytics,
  type Range,
} from "./analytics";

export type SectionKey = "overview" | "opd" | "ipd" | "lab" | "pharmacy" | "diet" | "expense";

export interface Section {
  key: SectionKey;
  title: string;
  kpis: KpiCompare[];
  comparisons: Comparison[];
  insights: Insight[];
}

export interface PeriodQuery {
  preset?: string;
  from?: string;
  to?: string;
  compareMode?: string;
  compareFrom?: string;
  compareTo?: string;
}

export async function resolve(q: PeriodQuery) {
  const settings = await getSettings();
  const hasRange = q.from && q.to;
  // A month-to-date range (1st → a day in the same month) compares with the same days of the previous month.
  if (hasRange && !q.preset && !q.compareFrom && q.from!.endsWith("-01") && q.from!.slice(0, 7) === q.to!.slice(0, 7)) {
    const pFrom = addMonths(q.from!, -1);
    const pTo = addMonths(q.to!, -1) > endOfMonth(pFrom) ? endOfMonth(pFrom) : addMonths(q.to!, -1);
    q = { ...q, compareFrom: pFrom, compareTo: q.to === endOfMonth(q.from!) ? endOfMonth(pFrom) : pTo };
  }
  return resolvePeriod({
    preset: ((hasRange && !q.preset) ? "custom" : (q.preset as PeriodPreset)) || "this_month",
    today: todayISO(),
    from: q.from,
    to: q.to,
    compareMode: (q.compareMode as CompareMode) || "like_for_like",
    fyStartMonth: settings.fiscalYearStartMonth,
    compareFrom: q.compareFrom,
    compareTo: q.compareTo,
  });
}

function rowsFrom<T>(cur: T[], prev: T[], key: (x: T) => string, name: (x: T) => string, val: (x: T) => number) {
  const m = new Map<string, { key: string; name: string; current: number; previous: number }>();
  for (const x of cur) m.set(key(x), { key: key(x), name: name(x), current: round2(val(x)), previous: 0 });
  for (const x of prev) {
    const e = m.get(key(x));
    if (e) e.previous = round2(val(x));
    else m.set(key(x), { key: key(x), name: name(x), current: 0, previous: round2(val(x)) });
  }
  return [...m.values()].sort((a, b) => b.current - a.current || b.previous - a.previous);
}

const top = <T>(rows: T[], n: number) => rows.slice(0, n);

function finish(key: SectionKey, title: string, kpis: KpiCompare[], comparisons: Comparison[], prevLabel: string, extra: Insight[] = []): Section {
  const insights = rankInsights([...insightsFromKpis(kpis, prevLabel), ...comparisons.flatMap((c) => insightsFromComparison(c, prevLabel)), ...extra], 8);
  return { key, title, kpis, comparisons, insights };
}

// ─────────────────────────── sections ───────────────────────────

async function overview(cur: Range, prev: Range, prevLabel: string): Promise<Section> {
  const [a, b, ma, mb] = await Promise.all([periodSummary(cur), periodSummary(prev), incomeByReconGroup(cur), incomeByReconGroup(prev)]);
  const kpis: KpiCompare[] = [
    { key: "totalIncome", label: "Total income", current: a.kpis.totalIncome, previous: b.kpis.totalIncome, unit: "money" },
    { key: "totalExpenses", label: "Total expenses", current: a.kpis.totalExpenses, previous: b.kpis.totalExpenses, unit: "money", goodWhen: "down" },
    { key: "netOperatingResult", label: "Net operating result", current: a.kpis.netOperatingResult, previous: b.kpis.netOperatingResult, unit: "money" },
    { key: "netMarginPct", label: "Net margin", current: a.kpis.netMarginPct, previous: b.kpis.netMarginPct, unit: "pct" },
    { key: "patients", label: "Patients", current: a.counts.patients, previous: b.counts.patients, unit: "int" },
    { key: "revenuePerPatient", label: "Revenue per patient", current: a.kpis.revenuePerPatient, previous: b.kpis.revenuePerPatient, unit: "money" },
    { key: "consultations", label: "Consultations", current: a.counts.consultations, previous: b.counts.consultations, unit: "int" },
    { key: "labTests", label: "Lab tests", current: a.counts.labTests, previous: b.counts.labTests, unit: "int" },
    { key: "admissions", label: "IPD admissions", current: a.counts.admissions, previous: b.counts.admissions, unit: "int" },
  ];
  const comparisons: Comparison[] = [
    { id: "income-stream", title: "Income by stream", noun: "stream", unit: "money", rows: AED_INCOME_STREAMS.map((s) => ({ key: s, name: STREAM_LABELS[s], current: a.income[s], previous: b.income[s] })) },
    { id: "expense-kind", title: "Expenditure", noun: "head", unit: "money", goodWhen: "down", rows: (["HOSPITAL", "OTHER"] as const).map((k) => ({ key: k, name: EXPENSE_LABELS[k], current: a.expense[k], previous: b.expense[k] })) },
    { id: "collections-mode", title: "Collections by payment mode", noun: "mode", unit: "money", goodWhen: "none", rows: ["CASH", "UPI", "CARD", "BANK", "OTHER"].map((k) => ({ key: k, name: k === "BANK" ? "Bank transfer" : k === "UPI" ? "UPI" : k[0] + k.slice(1).toLowerCase(), current: ma[k] ?? 0, previous: mb[k] ?? 0 })) },
  ];
  const cross = crossInsights({ incomeCur: totalIncome(a.income), incomePrev: totalIncome(b.income), expenseCur: totalExpenses(a.expense), expensePrev: totalExpenses(b.expense), prevLabel });
  return finish("overview", "Hospital overview", kpis, comparisons, prevLabel, cross);
}

async function opd(cur: Range, prev: Range, prevLabel: string): Promise<Section> {
  const g = defaultGranularity(cur.from, cur.to);
  const [a, b] = await Promise.all([opdAnalytics(cur, g), opdAnalytics(prev, g)]);
  const kpis: KpiCompare[] = [
    { key: "consultations", label: "Consultations", current: a.totals.total, previous: b.totals.total, unit: "int" },
    { key: "new", label: "New patients", current: a.totals.new, previous: b.totals.new, unit: "int" },
    { key: "old", label: "Follow-ups", current: a.totals.old, previous: b.totals.old, unit: "int" },
    { key: "newPct", label: "New-patient share", current: a.totals.newPct, previous: b.totals.newPct, unit: "pct" },
    { key: "revenue", label: "OPD revenue", current: a.totals.revenue, previous: b.totals.revenue, unit: "money" },
    { key: "avgRevenue", label: "Avg consultation revenue", current: a.totals.avgRevenue, previous: b.totals.avgRevenue, unit: "money" },
  ];
  const comparisons: Comparison[] = [
    { id: "opd-visit", title: "New vs follow-up visits", noun: "visit type", unit: "int", goodWhen: "none", rows: [{ key: "NEW", name: "New", current: a.totals.new, previous: b.totals.new }, { key: "OLD", name: "Follow-up", current: a.totals.old, previous: b.totals.old }], href: "/opd?visitType={key}" },
    { id: "opd-specialty-count", title: "Consultations by specialty", noun: "specialty", unit: "int", rows: rowsFrom(a.bySpecialty, b.bySpecialty, (x) => x.id, (x) => x.name, (x) => x.total), href: "/opd?specialtyId={key}" },
    { id: "opd-specialty-revenue", title: "OPD revenue by specialty", noun: "specialty", unit: "money", rows: rowsFrom(a.bySpecialty, b.bySpecialty, (x) => x.id, (x) => x.name, (x) => x.revenue), href: "/opd?specialtyId={key}" },
    { id: "opd-doctor", title: "OPD revenue by doctor", noun: "doctor", unit: "money", rows: top(rowsFrom(a.byDoctor, b.byDoctor, (x) => x.id ?? "none", (x) => x.name, (x) => x.revenue), 8), href: "/opd?doctorId={key}" },
    { id: "opd-type", title: "Consultations by type", noun: "type", unit: "int", rows: rowsFrom(a.byType, b.byType, (x) => x.id ?? "none", (x) => x.name, (x) => x.count) },
  ];
  return finish("opd", "OPD", kpis, comparisons, prevLabel);
}

async function lab(cur: Range, prev: Range, prevLabel: string): Promise<Section> {
  const g = defaultGranularity(cur.from, cur.to);
  const [a, b] = await Promise.all([labAnalytics(cur, g), labAnalytics(prev, g)]);
  const kpis: KpiCompare[] = [
    { key: "tests", label: "Tests performed", current: a.totals.tests, previous: b.totals.tests, unit: "int" },
    { key: "revenue", label: "Lab revenue", current: a.totals.revenue, previous: b.totals.revenue, unit: "money" },
    { key: "avgPerTest", label: "Avg revenue per test", current: a.totals.avgPerTest, previous: b.totals.avgPerTest, unit: "money" },
    { key: "perDay", label: "Tests per day", current: a.totals.avgTestsPerDay, previous: b.totals.avgTestsPerDay, unit: "int" },
  ];
  const comparisons: Comparison[] = [
    { id: "lab-revenue", title: "Revenue by investigation", noun: "investigation", unit: "money", rows: top(rowsFrom(a.investigations, b.investigations, (x) => x.id, (x) => x.name, (x) => x.revenue), 10), href: "/lab?investigationId={key}" },
    { id: "lab-volume", title: "Tests by investigation", noun: "investigation", unit: "int", rows: top(rowsFrom(a.investigations, b.investigations, (x) => x.id, (x) => x.name, (x) => x.tests), 16), href: "/lab?investigationId={key}" },
    { id: "lab-category", title: "Revenue by category", noun: "category", unit: "money", rows: rowsFrom(a.byCategory, b.byCategory, (x) => x.category, (x) => x.category, (x) => x.revenue), href: "/lab?category={key}" },
  ];
  return finish("lab", "Laboratory & diagnostics", kpis, comparisons, prevLabel);
}

async function ipd(cur: Range, prev: Range, prevLabel: string): Promise<Section> {
  const g = defaultGranularity(cur.from, cur.to);
  const [a, b] = await Promise.all([ipdAnalytics(cur, g), ipdAnalytics(prev, g)]);
  const kpis: KpiCompare[] = [
    { key: "admissions", label: "Admissions", current: a.totals.admissions, previous: b.totals.admissions, unit: "int" },
    { key: "collected", label: "IPD collections", current: a.totals.collected, previous: b.totals.collected, unit: "money" },
    { key: "billed", label: "Billed (net)", current: a.totals.billed, previous: b.totals.billed, unit: "money" },
    { key: "avg", label: "Avg admission value", current: a.totals.avgAdmissionValue, previous: b.totals.avgAdmissionValue, unit: "money" },
    { key: "outstanding", label: "Outstanding balance", current: a.totals.outstanding, previous: b.totals.outstanding, unit: "money", goodWhen: "down" },
  ];
  const comparisons: Comparison[] = [
    { id: "ipd-type-admissions", title: "Admissions by type", noun: "admission type", unit: "int", rows: rowsFrom(a.byType, b.byType, (x) => x.id, (x) => x.name, (x) => x.admissions), href: "/ipd?admissionTypeId={key}" },
    { id: "ipd-type-collected", title: "Collections by admission type", noun: "admission type", unit: "money", rows: rowsFrom(a.byType, b.byType, (x) => x.id, (x) => x.name, (x) => x.collected), href: "/ipd?admissionTypeId={key}" },
    {
      id: "ipd-kind",
      title: "Collections by kind",
      noun: "kind",
      unit: "money",
      goodWhen: "none",
      rows: [
        { key: "adv", name: "Advances", current: a.collectionsByKind.advances, previous: b.collectionsByKind.advances },
        { key: "pay", name: "Payments & settlements", current: a.collectionsByKind.payments, previous: b.collectionsByKind.payments },
        { key: "ref", name: "Refunds", current: a.collectionsByKind.refunds, previous: b.collectionsByKind.refunds },
      ],
    },
  ];
  return finish("ipd", "IPD", kpis, comparisons, prevLabel);
}

async function pharmacy(cur: Range, prev: Range, prevLabel: string): Promise<Section> {
  const g = defaultGranularity(cur.from, cur.to);
  const [a, b, ia, ib] = await Promise.all([pharmacyAnalytics(cur, g), pharmacyAnalytics(prev, g), pharmacyItemAnalytics(cur), pharmacyItemAnalytics(prev)]);
  // With medicine lines, margin is the real one (sale value − cost of units sold) and bills are real bills.
  const items = ia.hasData;
  const kpis: KpiCompare[] = [
    { key: "netSales", label: "Net sales", current: a.totals.netSales, previous: b.totals.netSales, unit: "money" },
    { key: "purchases", label: "Purchases", current: a.totals.purchases, previous: b.totals.purchases, unit: "money", goodWhen: "none" },
    items
      ? { key: "grossMargin", label: "Margin on medicines sold", current: ia.totals.margin, previous: ib.totals.margin, unit: "money" }
      : { key: "grossMargin", label: "Gross margin", current: a.totals.grossMargin, previous: b.totals.grossMargin, unit: "money" },
    items
      ? { key: "grossMarginPct", label: "Margin %", current: ia.totals.marginPct, previous: ib.totals.marginPct, unit: "pct" }
      : { key: "grossMarginPct", label: "Gross margin %", current: a.totals.grossMarginPct, previous: b.totals.grossMarginPct, unit: "pct" },
    { key: "returns", label: "Returns", current: a.totals.returns, previous: b.totals.returns, unit: "money", goodWhen: "down" },
    items
      ? { key: "bills", label: "Bills", current: ia.totals.bills, previous: ib.totals.bills, unit: "int" }
      : { key: "bills", label: "Bills", current: a.totals.transactions, previous: b.totals.transactions, unit: "int" },
    items
      ? { key: "avgSale", label: "Avg bill value", current: ia.totals.avgBill, previous: ib.totals.avgBill, unit: "money" }
      : { key: "avgSale", label: "Avg bill value", current: a.totals.avgSale, previous: b.totals.avgSale, unit: "money" },
  ];
  const comparisons: Comparison[] = [
    {
      id: "pharmacy-lines",
      title: "Hormonal Pharmacy sales, returns & purchases",
      noun: "line",
      unit: "money",
      goodWhen: "none",
      rows: [
        { key: "sales", name: "Sales (after discount)", current: a.totals.totalSales, previous: b.totals.totalSales },
        { key: "returns", name: "Returns", current: a.totals.returns, previous: b.totals.returns },
        { key: "purchases", name: "Purchases", current: a.totals.purchases, previous: b.totals.purchases },
      ],
    },
  ];
  if (items) {
    comparisons.push(
      { id: "pharmacy-medicine-revenue", title: "Sales value by medicine", noun: "medicine", unit: "money", rows: top(rowsFrom(ia.medicines, ib.medicines, (x) => x.id, (x) => x.name, (x) => x.revenue), 16) },
      { id: "pharmacy-medicine-units", title: "Units sold by medicine", noun: "medicine", unit: "int", rows: top(rowsFrom(ia.medicines, ib.medicines, (x) => x.id, (x) => x.name, (x) => x.units), 16) },
    );
  }
  return finish("pharmacy", "Hormonal Pharmacy", kpis, comparisons, prevLabel);
}

async function dietByService(r: Range) {
  const rows = await prisma.$queryRaw<{ id: string | null; name: string | null; cnt: bigint; revenue: Prisma.Decimal }[]>`
    SELECT s.id, s.name, COUNT(*) AS cnt, COALESCE(SUM(d."netAmount"), 0) AS revenue
      FROM "DietTransaction" d LEFT JOIN "DietService" s ON s.id = d."serviceId"
     WHERE d.status = 'ACTIVE' AND d.date BETWEEN ${toDbDate(r.from)} AND ${toDbDate(r.to)}
     GROUP BY 1, 2`;
  return rows.map((x) => ({ id: x.id ?? "none", name: x.name ?? "Unspecified", count: Number(x.cnt), revenue: toNum(x.revenue) }));
}

async function diet(cur: Range, prev: Range, prevLabel: string): Promise<Section> {
  const [a, b] = await Promise.all([dietByService(cur), dietByService(prev)]);
  const sum = (xs: { count: number; revenue: number }[], k: "count" | "revenue") => round2(xs.reduce((s, x) => s + x[k], 0));
  const kpis: KpiCompare[] = [
    { key: "revenue", label: "Diet revenue", current: sum(a, "revenue"), previous: sum(b, "revenue"), unit: "money" },
    { key: "sessions", label: "Sessions", current: sum(a, "count"), previous: sum(b, "count"), unit: "int" },
  ];
  const comparisons: Comparison[] = [
    { id: "diet-revenue", title: "Revenue by diet service", noun: "service", unit: "money", rows: rowsFrom(a, b, (x) => x.id, (x) => x.name, (x) => x.revenue), href: "/diet?serviceId={key}" },
    { id: "diet-count", title: "Sessions by diet service", noun: "service", unit: "int", rows: rowsFrom(a, b, (x) => x.id, (x) => x.name, (x) => x.count), href: "/diet?serviceId={key}" },
  ];
  return finish("diet", "Diet & nutrition", kpis, comparisons, prevLabel);
}

async function expense(cur: Range, prev: Range, prevLabel: string): Promise<Section> {
  const g = defaultGranularity(cur.from, cur.to);
  const [a, b] = await Promise.all([expenseAnalytics(cur, g), expenseAnalytics(prev, g)]);
  const kpis: KpiCompare[] = [
    { key: "total", label: "Total expenses", current: a.totals.total, previous: b.totals.total, unit: "money", goodWhen: "down" },
    { key: "hospital", label: "Hospital operating", current: a.totals.HOSPITAL, previous: b.totals.HOSPITAL, unit: "money", goodWhen: "down" },
    { key: "purchases", label: "Pharmacy purchases", current: a.totals.PHARMACY_PURCHASE, previous: b.totals.PHARMACY_PURCHASE, unit: "money", goodWhen: "none" },
    { key: "other", label: "Other expenses", current: a.totals.OTHER, previous: b.totals.OTHER, unit: "money", goodWhen: "down" },
    { key: "avgDaily", label: "Avg daily expense", current: a.totals.avgDaily, previous: b.totals.avgDaily, unit: "money", goodWhen: "down" },
  ];
  const comparisons: Comparison[] = [
    { id: "expense-category", title: "Expenses by category", noun: "category", unit: "money", goodWhen: "down", rows: top(rowsFrom(a.byCategory, b.byCategory, (x) => x.id, (x) => x.name, (x) => x.amount), 10), href: "/expenses?categoryId={key}" },
    { id: "expense-department", title: "Expenses by department", noun: "department", unit: "money", goodWhen: "down", rows: top(rowsFrom(a.byDepartment, b.byDepartment, (x) => x.id ?? "none", (x) => x.name, (x) => x.amount), 8), href: "/expenses?departmentId={key}" },
  ];
  return finish("expense", "Expenses", kpis, comparisons, prevLabel);
}

const BUILDERS: Record<SectionKey, { perm: Parameters<typeof can>[1]; build: (c: Range, p: Range, l: string) => Promise<Section> }> = {
  overview: { perm: "dashboard.view", build: overview },
  opd: { perm: "opd.view", build: opd },
  ipd: { perm: "ipd.view", build: ipd },
  lab: { perm: "lab.view", build: lab },
  pharmacy: { perm: "pharmacy.view", build: pharmacy },
  diet: { perm: "diet.view", build: diet },
  expense: { perm: "expense.view", build: expense },
};
export const SECTION_KEYS = Object.keys(BUILDERS) as SectionKey[];

/** One section for a module page (current filter range vs the preceding comparable range). */
export async function getSectionInsights(actor: Actor, key: SectionKey, q: PeriodQuery) {
  const b = BUILDERS[key];
  requirePermission(actor, b.perm);
  const period = await resolve(q);
  const section = await b.build(period.current, period.previous, period.previous.label);
  return { period, section };
}

/** Monthly trend for the board pack (last N months incl. the current one). */
async function monthlyTrend(endDate: string, months: number) {
  const out = [];
  const end = startOfMonth(endDate);
  for (let i = months - 1; i >= 0; i--) {
    const from = addMonths(end, -i);
    const to = i === 0 ? endDate : endOfMonth(from);
    const s = await periodSummary({ from, to });
    out.push({ month: from, label: formatMonth(from), ...s.income, income: s.kpis.totalIncome, expenses: s.kpis.totalExpenses, net: s.kpis.netOperatingResult, marginPct: s.kpis.netMarginPct ?? 0, patients: s.counts.patients, partial: i === 0 && endDate !== endOfMonth(from) });
  }
  return out;
}

/** The Board Meeting pack: every section the viewer may see, plus a 6-month trend and top findings. */
export async function getBoardPack(actor: Actor, q: PeriodQuery) {
  requireAnyPermission(actor, "analytics.view", "reports.view");
  const period = await resolve(q);
  const settings = await getSettings();
  const keys = SECTION_KEYS.filter((k) => can(actor, BUILDERS[k].perm));
  const sections = await Promise.all(keys.map((k) => BUILDERS[k].build(period.current, period.previous, period.previous.label)));
  const trend = await monthlyTrend(period.current.to, 6);
  const topInsights = rankInsights(sections.flatMap((s) => s.insights.map((i) => ({ ...i, id: `${s.key}:${i.id}`, headline: s.key === "overview" ? i.headline : `${s.title}: ${i.headline}` }))), 10);
  return { hospital: settings.hospitalName, address: settings.hospitalAddress, generatedAt: new Date().toISOString(), generatedBy: actor.name, period, sections, trend, topInsights };
}

export type { DateRange };
