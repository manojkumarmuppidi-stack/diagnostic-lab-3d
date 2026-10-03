import { describe, expect, it } from "vitest";
import {
  compare,
  derivedKpis,
  emptyExpense,
  emptyIncome,
  ipdBalance,
  netOperatingResult,
  pctOf,
  pharmacyMetrics,
  reconVariance,
  safeDiv,
  totalExpenses,
  totalIncome,
} from "@/lib/accounting";
import { formatINR, round2, sum } from "@/lib/money";

describe("income, expense and net result", () => {
  it("AED income sums the hospital streams and leaves out the Hormonal Pharmacy (separate entity)", () => {
    const i = { OPD: 1000, SCP: 400, IPD: 5000, LAB: 2500.5, PHARMACY: 3000, DIET: 500, OTHER: 100 };
    expect(totalIncome(i)).toBe(9500.5);
  });
  it("AED expenses = hospital + other; pharmacy stock and staff belong to the pharmacy", () => {
    expect(totalExpenses({ HOSPITAL: 700, PHARMACY_PURCHASE: 2000, OTHER: 300 })).toBe(1000);
  });
  it("net operating result = income − expenses, including negatives", () => {
    const i = { ...emptyIncome(), OPD: 1000 };
    expect(netOperatingResult(i, { ...emptyExpense(), HOSPITAL: 1500 })).toBe(-500);
  });
  it("zero revenue and zero expense give zero, never NaN", () => {
    expect(netOperatingResult(emptyIncome(), emptyExpense())).toBe(0);
    const k = derivedKpis(emptyIncome(), emptyExpense(), { patients: 0, consultations: 0, newConsultations: 0, oldConsultations: 0, admissions: 0, labTests: 0, pharmacyTransactions: 0 });
    expect(k.netMarginPct).toBeNull();
    expect(k.revenuePerPatient).toBeNull();
    expect(k.avgLabRevenuePerTest).toBeNull();
  });
  it("paise arithmetic has no floating point drift", () => {
    expect(sum([0.1, 0.2])).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
  });
  it("formats Indian currency grouping", () => {
    expect(formatINR(425000)).toBe("₹4,25,000");
  });
});

describe("period comparison", () => {
  it("absolute and percentage difference", () => {
    const c = compare(120, 100);
    expect(c.diff).toBe(20);
    expect(c.pct).toBe(20);
    expect(c.direction).toBe("up");
  });
  it("does not produce a percentage when the base is zero", () => {
    const c = compare(500, 0);
    expect(c.pct).toBeNull();
    expect(c.diff).toBe(500);
  });
  it("uses |previous| as the base for negative results", () => {
    expect(compare(-50, -100).pct).toBe(50);
  });
  it("flat when equal", () => {
    expect(compare(0, 0)).toMatchObject({ pct: null, direction: "flat", diff: 0 });
  });
  it("safeDiv / pctOf return null for a zero denominator", () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(pctOf(1, 0)).toBeNull();
    expect(pctOf(1, 4)).toBe(25);
  });
});

describe("pharmacy", () => {
  it("net sales = gross − discount − returns; margin = net − purchases", () => {
    const m = pharmacyMetrics({ grossSales: 10000, discount: 500, returns: 300, purchases: 7000 });
    expect(m.totalSales).toBe(9500);
    expect(m.netSales).toBe(9200);
    expect(m.grossMargin).toBe(2200);
    expect(m.grossMarginPct).toBe(23.91);
  });
  it("margin % is null with no sales", () => {
    expect(pharmacyMetrics({ grossSales: 0, discount: 0, returns: 0, purchases: 100 }).grossMarginPct).toBeNull();
  });
});

describe("consultation KPIs", () => {
  it("new/old percentages and average revenue", () => {
    const k = derivedKpis({ ...emptyIncome(), OPD: 8000, LAB: 3000 }, emptyExpense(), {
      patients: 10, consultations: 10, newConsultations: 4, oldConsultations: 6, admissions: 0, labTests: 6, pharmacyTransactions: 0,
    });
    expect(k.newConsultationPct).toBe(40);
    expect(k.oldConsultationPct).toBe(60);
    expect(k.avgConsultationRevenue).toBe(800);
    expect(k.avgLabRevenuePerTest).toBe(500);
    expect(k.revenuePerPatient).toBe(1100);
  });
});

describe("IPD balance & refunds", () => {
  it("advance + payments − refunds against the billed amount", () => {
    expect(ipdBalance({ billed: 40000, advances: 10000, payments: 20000, refunds: 0 })).toEqual({ collected: 30000, balance: 10000, status: "PARTIAL" });
    expect(ipdBalance({ billed: 40000, advances: 10000, payments: 30000, refunds: 0 }).status).toBe("SETTLED");
    expect(ipdBalance({ billed: 40000, advances: 45000, payments: 0, refunds: 0 }).status).toBe("REFUND_DUE");
    expect(ipdBalance({ billed: 40000, advances: 45000, payments: 0, refunds: 5000 }).status).toBe("SETTLED");
    expect(ipdBalance({ billed: 40000, advances: 0, payments: 0, refunds: 0 }).status).toBe("DUE");
  });
});

describe("reconciliation", () => {
  it("variance = actual − expected and needs an explanation when non-zero", () => {
    expect(reconVariance(1000, 950)).toEqual({ variance: -50, needsExplanation: true });
    expect(reconVariance(1000, 1000)).toEqual({ variance: 0, needsExplanation: false });
  });
});
