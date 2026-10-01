/**
 * Pure accounting calculations. Every formula shown in the UI is defined here
 * (or in the SQL views it consumes) and documented in ACCOUNTING_RULES.md.
 * No database access — so this module is fully unit-testable.
 */
import { round2, sum } from "./money";

export const INCOME_STREAMS = ["OPD", "IPD", "LAB", "PHARMACY", "DIET", "OTHER"] as const;
export type IncomeStream = (typeof INCOME_STREAMS)[number];

export const EXPENSE_KINDS = ["HOSPITAL", "PHARMACY_PURCHASE", "OTHER"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const STREAM_LABELS: Record<IncomeStream, string> = {
  OPD: "OPD",
  IPD: "IPD",
  LAB: "Laboratory",
  PHARMACY: "Hormonal Pharmacy",
  DIET: "Diet & Nutrition",
  OTHER: "Other Income",
};

export const EXPENSE_LABELS: Record<ExpenseKind, string> = {
  HOSPITAL: "Hospital Expenses",
  PHARMACY_PURCHASE: "Hormonal Pharmacy costs (stock & staff)",
  OTHER: "Other Expenses",
};

/**
 * AED Hospital and Hormonal Pharmacy are separate entities. Every hospital total in the app
 * (income, expenses, net result, reconciliation) is AED only; the pharmacy is reported on its own.
 */
export const AED_INCOME_STREAMS = ["OPD", "IPD", "LAB", "DIET", "OTHER"] as const satisfies readonly IncomeStream[];
export const AED_EXPENSE_KINDS = ["HOSPITAL", "OTHER"] as const satisfies readonly ExpenseKind[];

export type IncomeByStream = Record<IncomeStream, number>;
export type ExpenseByKind = Record<ExpenseKind, number>;

export function emptyIncome(): IncomeByStream {
  return { OPD: 0, IPD: 0, LAB: 0, PHARMACY: 0, DIET: 0, OTHER: 0 };
}
export function emptyExpense(): ExpenseByKind {
  return { HOSPITAL: 0, PHARMACY_PURCHASE: 0, OTHER: 0 };
}

/** AED Hospital income = OPD + IPD + Lab + Diet + Other (the Hormonal Pharmacy is a separate entity). */
export function totalIncome(i: IncomeByStream): number {
  return sum(AED_INCOME_STREAMS.map((s) => i[s]));
}

/** AED Hospital expenses = Hospital operating + Other (pharmacy stock and staff belong to the pharmacy). */
export function totalExpenses(e: ExpenseByKind): number {
  return sum(AED_EXPENSE_KINDS.map((k) => e[k]));
}

/** Net Operating Result = Total Income − Total Expenses. */
export function netOperatingResult(i: IncomeByStream, e: ExpenseByKind): number {
  return round2(totalIncome(i) - totalExpenses(e));
}

/** Division that returns null (not Infinity / NaN) when the denominator is 0. */
export function safeDiv(numerator: number, denominator: number): number | null {
  if (!denominator || !Number.isFinite(denominator)) return null;
  return round2(numerator / denominator);
}

/** Percentage (0–100 scale) or null when the base is 0. */
export function pctOf(part: number, whole: number): number | null {
  if (!whole) return null;
  return round2((part / whole) * 100);
}

export interface Change {
  current: number;
  previous: number;
  /** current − previous */
  diff: number;
  /**
   * % change relative to |previous|; null when previous is 0 (a % change from zero
   * is undefined and would be misleading — the UI shows "new" / "—" instead).
   */
  pct: number | null;
  direction: "up" | "down" | "flat";
}

export function compare(current: number, previous: number): Change {
  const diff = round2(current - previous);
  const pct = previous === 0 ? null : round2((diff / Math.abs(previous)) * 100);
  return { current, previous, diff, pct, direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat" };
}

export interface PharmacyFigures {
  grossSales: number; // before discount
  discount: number;
  returns: number; // positive number
  purchases: number;
}

/**
 * Pharmacy view (kept separate from the operating view):
 *   Net Sales     = Gross Sales − Discount − Returns
 *   Gross Margin  = Net Sales − Purchases   (purchases as a proxy for COGS; see ACCOUNTING_RULES §3)
 *   Gross Margin% = Gross Margin ÷ Net Sales × 100 (null when Net Sales = 0)
 */
export function pharmacyMetrics(p: PharmacyFigures) {
  const netSales = round2(p.grossSales - p.discount - p.returns);
  const grossMargin = round2(netSales - p.purchases);
  return {
    totalSales: round2(p.grossSales - p.discount),
    returns: round2(p.returns),
    netSales,
    purchases: round2(p.purchases),
    grossMargin,
    grossMarginPct: pctOf(grossMargin, netSales),
  };
}

/** Net amount for a billed line; discount may not exceed gross. */
export function netFromGross(gross: number, discount: number): number {
  return round2(gross - discount);
}

export interface Counts {
  patients: number;
  consultations: number;
  newConsultations: number;
  oldConsultations: number;
  admissions: number;
  labTests: number;
  pharmacyTransactions: number;
}

/** Derived KPIs used on the dashboard and in profitability analytics. */
export function derivedKpis(i: IncomeByStream, e: ExpenseByKind, c: Counts) {
  const income = totalIncome(i);
  const expense = totalExpenses(e);
  const net = round2(income - expense);
  return {
    totalIncome: income,
    totalExpenses: expense,
    netOperatingResult: net,
    netMarginPct: pctOf(net, income),
    revenuePerPatient: safeDiv(income, c.patients),
    expensePerPatient: safeDiv(expense, c.patients),
    avgConsultationRevenue: safeDiv(i.OPD, c.consultations),
    revenuePerAdmission: safeDiv(i.IPD, c.admissions),
    avgLabRevenuePerTest: safeDiv(i.LAB, c.labTests),
    newConsultationPct: pctOf(c.newConsultations, c.consultations),
    oldConsultationPct: pctOf(c.oldConsultations, c.consultations),
  };
}

export interface IpdLedger {
  billed: number; // net billed value of the admission
  advances: number;
  payments: number; // PAYMENT + FINAL_SETTLEMENT
  refunds: number;
}

/**
 * IPD balance for one admission:
 *   Collected   = Advances + Payments − Refunds
 *   Balance Due = Billed − Collected   (negative ⇒ refund due to patient)
 */
export function ipdBalance(l: IpdLedger) {
  const collected = round2(l.advances + l.payments - l.refunds);
  const balance = round2(l.billed - collected);
  const status = l.billed === 0 && collected === 0 ? "UNBILLED" : balance > 0 ? (collected > 0 ? "PARTIAL" : "DUE") : balance < 0 ? "REFUND_DUE" : "SETTLED";
  return { collected, balance, status } as const;
}

/** Reconciliation variance = Actual − Expected. Explanation needed when non-zero. */
export function reconVariance(expected: number, actual: number) {
  const variance = round2(actual - expected);
  return { variance, needsExplanation: variance !== 0 };
}
