/**
 * Report builders. Every report is a plain structure (KPIs + tables) rendered to
 * HTML (UI), Excel, CSV or PDF by src/server/exporters.ts — so all formats agree.
 */
import { z } from "zod";
import { EXPENSE_LABELS, STREAM_LABELS, totalExpenses, totalIncome, compare, safeDiv, AED_INCOME_STREAMS } from "@/lib/accounting";
import { addDays, addMonths, endOfMonth, formatDate, formatMonth, isISODate, startOfMonth, startOfWeek, todayISO, type ISODate } from "@/lib/dates";
import { round2 } from "@/lib/money";
import { defaultGranularity, precedingRange, type Granularity } from "@/lib/periods";
import { requirePermission, type Actor } from "../authz";
import { getSettings } from "../settings";
import {
  expenseAnalytics,
  incomeByReconGroup,
  incomeSeries,
  ipdAnalytics,
  labAnalytics,
  opdAnalytics,
  periodSummary,
  pharmacyAnalytics,
  type PeriodSummary,
} from "./analytics";
import { prisma } from "../db";
import { toDbDate } from "@/lib/dates";
import { toNum } from "@/lib/money";


export type ColType = "text" | "money" | "int" | "pct" | "date";
export interface ReportColumn {
  key: string;
  label: string;
  type?: ColType;
}
export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}
export interface Report {
  type: string;
  title: string;
  hospital: string;
  address: string;
  period: string;
  from: ISODate;
  to: ISODate;
  generatedAt: string;
  generatedBy: string;
  kpis: { label: string; value: number | null; type: ColType }[];
  tables: ReportTable[];
  notes: string[];
  /** Heading for the notes section in PDFs (default "Definitions"). */
  notesTitle?: string;
}

export const REPORT_TYPES = [
  { key: "daily", label: "Daily Report", single: true },
  { key: "weekly", label: "Weekly Report" },
  { key: "monthly", label: "Monthly Report" },
  { key: "department", label: "Department Report" },
  { key: "opd", label: "OPD Report" },
  { key: "ipd", label: "IPD Report" },
  { key: "lab", label: "Laboratory Report" },
  { key: "pharmacy", label: "Hormonal Pharmacy Report" },
  { key: "expense", label: "Expense Report" },
  { key: "income-vs-expense", label: "Income vs Expense Report" },
  { key: "profitability", label: "Profitability Report" },
  { key: "consultation", label: "Consultation Report" },
  { key: "historical", label: "Historical Comparison Report" },
] as const;
export type ReportType = (typeof REPORT_TYPES)[number]["key"];

const q = z.object({
  from: z.string().refine(isISODate).optional(),
  to: z.string().refine(isISODate).optional(),
  date: z.string().refine(isISODate).optional(),
  granularity: z.enum(["day", "week", "month"]).optional(),
});

const INCOME_DEF = "Total Income (AED Hospital) = OPD + IPD collections + Lab + Diet + Other income. Hormonal Pharmacy is a separate entity with its own report.";
const EXPENSE_DEF = "Total Expenses (AED Hospital) = Hospital operating expenses + Other expenses. Pharmacy stock purchases and pharmacy staff are the Hormonal Pharmacy's.";
const NET_DEF = "Net Operating Result = Total Income - Total Expenses (collections basis, transaction date). Monthly items such as salaries and rent are spread over the days of their month.";

function incomeTable(cur: PeriodSummary, prev?: PeriodSummary): ReportTable {
  const rows = AED_INCOME_STREAMS.map((s) => {
    const c = compare(cur.income[s], prev?.income[s] ?? 0);
    return { head: STREAM_LABELS[s], amount: cur.income[s], ...(prev ? { previous: c.previous, diff: c.diff, pct: c.pct } : {}) };
  });
  const ti = totalIncome(cur.income);
  const c = compare(ti, prev ? totalIncome(prev.income) : 0);
  return {
    title: "Income",
    columns: [
      { key: "head", label: "Income Head" },
      { key: "amount", label: "Current", type: "money" },
      ...(prev ? ([{ key: "previous", label: "Previous", type: "money" }, { key: "diff", label: "Change", type: "money" }, { key: "pct", label: "Change %", type: "pct" }] as ReportColumn[]) : []),
    ],
    rows,
    totals: { head: "Total Income", amount: ti, ...(prev ? { previous: c.previous, diff: c.diff, pct: c.pct } : {}) },
  };
}

function expenseTable(cur: PeriodSummary, prev?: PeriodSummary): ReportTable {
  // AED Hospital only; the Hormonal Pharmacy has its own report.
  const kinds = ["HOSPITAL", "OTHER"] as const;
  const rows = kinds.map((k) => {
    const c = compare(cur.expense[k], prev?.expense[k] ?? 0);
    return { head: EXPENSE_LABELS[k], amount: cur.expense[k], ...(prev ? { previous: c.previous, diff: c.diff, pct: c.pct } : {}) };
  });
  const te = totalExpenses(cur.expense);
  const c = compare(te, prev ? totalExpenses(prev.expense) : 0);
  const net = compare(cur.kpis.netOperatingResult, prev?.kpis.netOperatingResult ?? 0);
  return {
    title: "Expenditure & Net Result",
    columns: [
      { key: "head", label: "Head" },
      { key: "amount", label: "Current", type: "money" },
      ...(prev ? ([{ key: "previous", label: "Previous", type: "money" }, { key: "diff", label: "Change", type: "money" }, { key: "pct", label: "Change %", type: "pct" }] as ReportColumn[]) : []),
    ],
    rows: [...rows, { head: "Total Expenses", amount: te, ...(prev ? { previous: c.previous, diff: c.diff, pct: c.pct } : {}) }],
    totals: { head: "Net Operating Result", amount: cur.kpis.netOperatingResult, ...(prev ? { previous: net.previous, diff: net.diff, pct: net.pct } : {}) },
  };
}

function countsTable(cur: PeriodSummary, prev?: PeriodSummary): ReportTable {
  const items: [string, number, number | undefined][] = [
    ["Patients (distinct)", cur.counts.patients, prev?.counts.patients],
    ["New consultations", cur.counts.newConsultations, prev?.counts.newConsultations],
    ["Old consultations", cur.counts.oldConsultations, prev?.counts.oldConsultations],
    ["Total consultations", cur.counts.consultations, prev?.counts.consultations],
    ["IPD admissions", cur.counts.admissions, prev?.counts.admissions],
    ["Laboratory tests", cur.counts.labTests, prev?.counts.labTests],
    ["Pharmacy transactions", cur.counts.pharmacyTransactions, prev?.counts.pharmacyTransactions],
  ];
  return {
    title: "Operational Volumes",
    columns: [{ key: "head", label: "Metric" }, { key: "value", label: "Current", type: "int" }, ...(prev ? ([{ key: "previous", label: "Previous", type: "int" }, { key: "pct", label: "Change %", type: "pct" }] as ReportColumn[]) : [])],
    rows: items.map(([head, v, p]) => ({ head, value: v, ...(prev ? { previous: p, pct: compare(v, p ?? 0).pct } : {}) })),
  };
}

function kpisOf(s: PeriodSummary): Report["kpis"] {
  return [
    { label: "Total Income", value: s.kpis.totalIncome, type: "money" },
    { label: "Total Expenses", value: s.kpis.totalExpenses, type: "money" },
    { label: "Net Operating Result", value: s.kpis.netOperatingResult, type: "money" },
    { label: "Net Margin %", value: s.kpis.netMarginPct, type: "pct" },
    { label: "Patients", value: s.counts.patients, type: "int" },
    { label: "Revenue / Patient", value: s.kpis.revenuePerPatient, type: "money" },
  ];
}

async function seriesTable(from: ISODate, to: ISODate, g: Granularity, title = "Trend"): Promise<ReportTable> {
  const series = await incomeSeries({ from, to }, g);
  const label = (b: string) => (g === "month" ? formatMonth(b) : g === "week" ? `Wk of ${formatDate(b)}` : formatDate(b));
  const rows = series.map((s) => ({ period: label(s.bucket), OPD: s.OPD, IPD: s.IPD, LAB: s.LAB, PHARMACY: s.PHARMACY, DIET: s.DIET, OTHER: s.OTHER, income: s.income, expenses: s.expenses, net: s.net }));
  const sumKey = (k: keyof (typeof rows)[number]) => round2(rows.reduce((a, r) => a + (r[k] as number), 0));
  return {
    title,
    columns: [
      { key: "period", label: g === "day" ? "Date" : "Period" },
      ...AED_INCOME_STREAMS.map((s) => ({ key: s, label: STREAM_LABELS[s], type: "money" as const })),
      { key: "income", label: "Total Income", type: "money" },
      { key: "expenses", label: "Expenses", type: "money" },
      { key: "net", label: "Net Result", type: "money" },
    ],
    rows,
    totals: { period: "Total", ...Object.fromEntries(AED_INCOME_STREAMS.map((s) => [s, sumKey(s)])), income: sumKey("income"), expenses: sumKey("expenses"), net: sumKey("net") },
  };
}

export async function buildReport(actor: Actor, type: ReportType, raw: Record<string, string | undefined>): Promise<Report> {
  requirePermission(actor, "reports.view");
  const params = q.parse(raw);
  const settings = await getSettings();
  const today = todayISO();
  let from = params.from ?? startOfMonth(today);
  let to = params.to ?? today;
  if (type === "daily") from = to = params.date ?? params.to ?? today;
  if (type === "weekly" && !params.from) {
    from = startOfWeek(params.date ?? today);
    to = addDays(from, 6);
  }
  if (type === "monthly" && !params.from) {
    from = startOfMonth(params.date ?? today);
    to = endOfMonth(from);
  }
  if (type === "historical" && !params.from) {
    from = addMonths(startOfMonth(today), -11);
    to = today;
  }
  if (from > to) [from, to] = [to, from];
  const g: Granularity = params.granularity ?? (type === "historical" ? "month" : defaultGranularity(from, to));
  const r = { from, to };
  const base: Omit<Report, "kpis" | "tables" | "notes"> = {
    type,
    title: REPORT_TYPES.find((t) => t.key === type)!.label,
    hospital: settings.hospitalName,
    address: settings.hospitalAddress,
    period: from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`,
    from,
    to,
    generatedAt: new Date().toISOString(),
    generatedBy: actor.name,
  };
  const notes = [INCOME_DEF, EXPENSE_DEF, NET_DEF];

  switch (type) {
    case "daily": {
      const [cur, modes] = await Promise.all([periodSummary(r), incomeByReconGroup(r)]);
      const day = await prisma.dailyAccount.findUnique({ where: { date: toDbDate(from) }, include: { reconciliations: true } });
      const modeRows = (["CASH", "CARD", "UPI", "BANK", "OTHER"] as const).map((m) => {
        const rec = day?.reconciliations.find((x) => x.reconGroup === m);
        return { mode: m, expected: modes[m], actual: rec ? toNum(rec.actual) : null, variance: rec ? toNum(rec.variance) : null, explanation: rec?.explanation ?? "" };
      });
      return {
        ...base,
        kpis: kpisOf(cur),
        tables: [
          incomeTable(cur),
          expenseTable(cur),
          { title: `Collections by Payment Mode (day status: ${day?.status ?? "OPEN"})`, columns: [{ key: "mode", label: "Mode" }, { key: "expected", label: "Expected", type: "money" }, { key: "actual", label: "Actual", type: "money" }, { key: "variance", label: "Variance", type: "money" }, { key: "explanation", label: "Explanation" }], rows: modeRows, totals: { mode: "Total", expected: round2(Object.values(modes).reduce((a, b) => a + b, 0)) } },
          countsTable(cur),
        ],
        notes,
      };
    }
    case "weekly":
    case "monthly":
    case "profitability":
    case "department": {
      const prevRange = type === "monthly" && !params.from ? { from: addMonths(from, -1), to: endOfMonth(addMonths(from, -1)) } : precedingRange(r);
      const [cur, prev] = await Promise.all([periodSummary(r), periodSummary(prevRange)]);
      const tables: ReportTable[] = [incomeTable(cur, prev), expenseTable(cur, prev), countsTable(cur, prev)];
      if (type === "department") {
        const [lab, exp] = await Promise.all([labAnalytics(r, g), expenseAnalytics(r, g)]);
        tables.push(
          { title: "Laboratory by Category", columns: [{ key: "category", label: "Category" }, { key: "tests", label: "Tests", type: "int" }, { key: "revenue", label: "Revenue", type: "money" }], rows: lab.byCategory },
          { title: "Expenses by Department", columns: [{ key: "name", label: "Department" }, { key: "amount", label: "Amount", type: "money" }], rows: exp.byDepartment, totals: { name: "Total", amount: round2(exp.byDepartment.reduce((a, d) => a + d.amount, 0)) } },
        );
      } else if (type === "profitability") {
        tables.push({
          title: "Profitability Ratios",
          columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value", type: "money" }, { key: "formula", label: "Definition" }],
          rows: [
            { metric: "Net margin %", value: cur.kpis.netMarginPct, formula: "Net Operating Result ÷ Total Income × 100" },
            { metric: "Revenue per patient", value: cur.kpis.revenuePerPatient, formula: "Total Income ÷ distinct patients" },
            { metric: "Expense per patient", value: cur.kpis.expensePerPatient, formula: "Total Expenses ÷ distinct patients" },
            { metric: "Revenue per consultation", value: cur.kpis.avgConsultationRevenue, formula: "OPD income ÷ consultations" },
            { metric: "Revenue per IPD admission", value: cur.kpis.revenuePerAdmission, formula: "IPD collections ÷ admissions in period" },
            { metric: "Revenue per lab test", value: cur.kpis.avgLabRevenuePerTest, formula: "Lab income ÷ tests (quantity)" },
          ],
        });
        tables.push(await seriesTable(from, to, g));
      } else {
        tables.push(await seriesTable(from, to, "day", "Daily Breakdown"));
      }
      return { ...base, period: `${base.period} (compared with ${formatDate(prevRange.from)} – ${formatDate(prevRange.to)})`, kpis: kpisOf(cur), tables, notes };
    }
    case "opd":
    case "consultation": {
      const a = await opdAnalytics(r, g);
      return {
        ...base,
        kpis: [
          { label: "Total Consultations", value: a.totals.total, type: "int" },
          { label: "New", value: a.totals.new, type: "int" },
          { label: "Old", value: a.totals.old, type: "int" },
          { label: "New %", value: a.totals.newPct, type: "pct" },
          { label: "OPD Revenue", value: a.totals.revenue, type: "money" },
          { label: "Avg Consultation Revenue", value: a.totals.avgRevenue, type: "money" },
        ],
        tables: [
          { title: "By Specialty", columns: [{ key: "name", label: "Specialty" }, { key: "new", label: "New", type: "int" }, { key: "old", label: "Old", type: "int" }, { key: "total", label: "Total", type: "int" }, { key: "revenue", label: "Revenue", type: "money" }], rows: a.bySpecialty, totals: { name: "Total", new: a.totals.new, old: a.totals.old, total: a.totals.total, revenue: a.totals.revenue } },
          { title: "By Doctor", columns: [{ key: "name", label: "Doctor" }, { key: "new", label: "New", type: "int" }, { key: "old", label: "Old", type: "int" }, { key: "total", label: "Total", type: "int" }, { key: "revenue", label: "Revenue", type: "money" }], rows: a.byDoctor },
          ...(type === "opd" ? [{ title: "By Consultation Type", columns: [{ key: "name", label: "Type" }, { key: "count", label: "Count", type: "int" as const }, { key: "revenue", label: "Revenue", type: "money" as const }], rows: a.byType }] : []),
          { title: "Trend", columns: [{ key: "bucket", label: "Period", type: "date" }, { key: "new", label: "New", type: "int" }, { key: "old", label: "Old", type: "int" }, { key: "total", label: "Total", type: "int" }, { key: "revenue", label: "Revenue", type: "money" }], rows: a.trend },
        ],
        notes: ["Consultation counts include only ACTIVE (not voided/superseded/reversed) records.", "New % = New ÷ Total consultations × 100."],
      };
    }
    case "ipd": {
      const a = await ipdAnalytics(r, g);
      return {
        ...base,
        kpis: [
          { label: "Admissions", value: a.totals.admissions, type: "int" },
          { label: "Billed (net)", value: a.totals.billed, type: "money" },
          { label: "Collected", value: a.totals.collected, type: "money" },
          { label: "Avg Admission Value", value: a.totals.avgAdmissionValue, type: "money" },
          { label: "Outstanding (all open)", value: a.totals.outstanding, type: "money" },
        ],
        tables: [
          { title: "By Admission Type", columns: [{ key: "name", label: "Type" }, { key: "admissions", label: "Admissions", type: "int" }, { key: "billed", label: "Billed", type: "money" }, { key: "collected", label: "Collected in Period", type: "money" }], rows: a.byType },
          { title: "Collections", columns: [{ key: "k", label: "Kind" }, { key: "v", label: "Amount", type: "money" }], rows: [{ k: "Advances", v: a.collectionsByKind.advances }, { k: "Payments & settlements", v: a.collectionsByKind.payments }, { k: "Refunds", v: -a.collectionsByKind.refunds }], totals: { k: "IPD income", v: a.totals.collected } },
          { title: "Outstanding Balances", columns: [{ key: "admissionDate", label: "Admitted", type: "date" }, { key: "patientName", label: "Patient" }, { key: "billed", label: "Billed", type: "money" }, { key: "collected", label: "Collected", type: "money" }, { key: "balance", label: "Balance", type: "money" }], rows: a.outstandingList },
        ],
        notes: ["IPD income is recognised when money is collected (advance, payment, final settlement) less refunds.", "Billed value is shown for information and drives outstanding balances."],
      };
    }
    case "lab": {
      const a = await labAnalytics(r, g);
      return {
        ...base,
        kpis: [
          { label: "Tests", value: a.totals.tests, type: "int" },
          { label: "Lab Revenue", value: a.totals.revenue, type: "money" },
          { label: "Avg Revenue / Test", value: a.totals.avgPerTest, type: "money" },
          { label: "Avg Tests / Day", value: a.totals.avgTestsPerDay, type: "int" },
        ],
        tables: [
          { title: "By Investigation (highest revenue first)", columns: [{ key: "name", label: "Investigation" }, { key: "category", label: "Category" }, { key: "tests", label: "Tests", type: "int" }, { key: "revenue", label: "Revenue", type: "money" }, { key: "avg", label: "Avg / Test", type: "money" }], rows: [...a.investigations].sort((x, y) => y.revenue - x.revenue), totals: { name: "Total", tests: a.totals.tests, revenue: a.totals.revenue, avg: a.totals.avgPerTest } },
          { title: "By Category", columns: [{ key: "category", label: "Category" }, { key: "tests", label: "Tests", type: "int" }, { key: "revenue", label: "Revenue", type: "money" }], rows: a.byCategory },
          { title: "Trend", columns: [{ key: "bucket", label: "Period", type: "date" }, { key: "tests", label: "Tests", type: "int" }, { key: "revenue", label: "Revenue", type: "money" }], rows: a.trend },
        ],
        notes: ["Tests = sum of quantity. Avg revenue per test = Lab net revenue ÷ tests."],
      };
    }
    case "pharmacy": {
      const a = await pharmacyAnalytics(r, g);
      return {
        ...base,
        kpis: [
          { label: "Net Sales", value: a.totals.netSales, type: "money" },
          { label: "Purchases", value: a.totals.purchases, type: "money" },
          { label: "Gross Margin", value: a.totals.grossMargin, type: "money" },
          { label: "Gross Margin %", value: a.totals.grossMarginPct, type: "pct" },
          { label: "Sales Transactions", value: a.totals.transactions, type: "int" },
        ],
        tables: [
          { title: "Pharmacy Summary", columns: [{ key: "k", label: "Line" }, { key: "v", label: "Amount", type: "money" }], rows: [{ k: "Gross sales", v: a.totals.grossSales }, { k: "Less: discount", v: -a.totals.discount }, { k: "Less: returns", v: -a.totals.returns }, { k: "Net sales", v: a.totals.netSales }, { k: "Less: purchases", v: -a.totals.purchases }], totals: { k: "Gross margin", v: a.totals.grossMargin } },
          { title: "Trend", columns: [{ key: "bucket", label: "Period", type: "date" }, { key: "sales", label: "Sales (net of discount)", type: "money" }, { key: "returns", label: "Returns", type: "money" }, { key: "netSales", label: "Net Sales", type: "money" }, { key: "purchases", label: "Purchases", type: "money" }], rows: a.trend },
        ],
        notes: ["Gross margin uses purchases as a proxy for cost of goods sold (no stock valuation). It is only accurate when stock levels are stable over the period."],
      };
    }
    case "expense": {
      const a = await expenseAnalytics(r, g);
      return {
        ...base,
        kpis: [
          { label: "Total Expenses", value: a.totals.total, type: "money" },
          { label: "Hospital Expenses", value: a.totals.HOSPITAL, type: "money" },
          { label: "Pharmacy Purchases", value: a.totals.PHARMACY_PURCHASE, type: "money" },
          { label: "Other Expenses", value: a.totals.OTHER, type: "money" },
          { label: "Avg Daily Expense", value: a.totals.avgDaily, type: "money" },
        ],
        tables: [
          { title: "By Category", columns: [{ key: "name", label: "Category" }, { key: "group", label: "Group" }, { key: "count", label: "Entries", type: "int" }, { key: "amount", label: "Amount", type: "money" }], rows: a.byCategory, totals: { name: "Total (excl. pharmacy purchases)", amount: round2(a.totals.HOSPITAL + a.totals.OTHER) } },
          { title: "By Department", columns: [{ key: "name", label: "Department" }, { key: "amount", label: "Amount", type: "money" }], rows: a.byDepartment },
          { title: "By Month (all expenditure)", columns: [{ key: "bucket", label: "Month", type: "date" }, { key: "amount", label: "Amount", type: "money" }], rows: a.byMonth },
          { title: "Largest Expenses", columns: [{ key: "date", label: "Date", type: "date" }, { key: "description", label: "Description" }, { key: "category", label: "Category" }, { key: "amount", label: "Amount", type: "money" }], rows: a.largest },
        ],
        notes: [EXPENSE_DEF, "Average daily expense = Total Expenses ÷ calendar days in the period."],
      };
    }
    case "income-vs-expense": {
      const cur = await periodSummary(r);
      return { ...base, kpis: kpisOf(cur), tables: [incomeTable(cur), expenseTable(cur), await seriesTable(from, to, g, "Income vs Expense Trend")], notes };
    }
    case "historical": {
      const months: ISODate[] = [];
      for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) months.push(m);
      const sums = await Promise.all(months.map((m) => periodSummary({ from: m, to: endOfMonth(m) > to ? to : endOfMonth(m) })));
      const rows = sums.map((s, i) => {
        const prev = sums[i - 1];
        const ti = totalIncome(s.income);
        return {
          period: formatMonth(months[i]),
          ...s.income,
          income: ti,
          expenses: totalExpenses(s.expense),
          net: s.kpis.netOperatingResult,
          momPct: prev ? compare(ti, totalIncome(prev.income)).pct : null,
          consultations: s.counts.consultations,
          labTests: s.counts.labTests,
          admissions: s.counts.admissions,
        };
      });
      return {
        ...base,
        kpis: [
          { label: "Months", value: months.length, type: "int" },
          { label: "Total Income", value: round2(rows.reduce((a, x) => a + x.income, 0)), type: "money" },
          { label: "Total Expenses", value: round2(rows.reduce((a, x) => a + x.expenses, 0)), type: "money" },
          { label: "Avg Monthly Income", value: safeDiv(rows.reduce((a, x) => a + x.income, 0), months.length), type: "money" },
        ],
        tables: [
          {
            title: "Month-by-Month",
            columns: [
              { key: "period", label: "Month" },
              ...AED_INCOME_STREAMS.map((s) => ({ key: s, label: STREAM_LABELS[s], type: "money" as const })),
              { key: "income", label: "Total Income", type: "money" },
              { key: "momPct", label: "MoM %", type: "pct" },
              { key: "expenses", label: "Expenses", type: "money" },
              { key: "net", label: "Net", type: "money" },
              { key: "consultations", label: "Consults", type: "int" },
              { key: "labTests", label: "Lab Tests", type: "int" },
              { key: "admissions", label: "Admissions", type: "int" },
            ],
            rows,
          },
        ],
        notes: [...notes, "Historical figures use the transaction date, never the upload date. Imported and manually entered records are treated identically.", "A month with a zero previous value shows no MoM % (undefined)."],
      };
    }
  }
}
