import { describe, expect, it } from "vitest";
import { buildMonth, entityInsights, totals } from "@/lib/entities";

describe("entity P&L", () => {
  it("profit, margin and months with expenses but no income", () => {
    const m = [buildMonth("2026-01", 0, 3000000), buildMonth("2026-04", 3500000, 3000000, { OPD: 2000000, LAB: 1500000 }), buildMonth("2026-05", 3200000, 3400000, { OPD: 2000000, LAB: 1200000 })];
    expect(m[0].incomeMissing).toBe(true);
    expect(m[1]).toMatchObject({ profit: 500000, marginPct: 14.29 });
    expect(totals(m.filter((x) => !x.incomeMissing))).toMatchObject({ income: 6700000, expenses: 6400000, profit: 300000 });
    const ins = entityInsights("AED", m, [{ name: "Salaries & Wages", amount: 4000000 }, { name: "Rent", amount: 900000 }]);
    const text = ins.map((i) => i.text).join("\n");
    expect(ins[0].tone).toBe("warn");
    expect(text).toMatch(/Jan 2026: expenses are recorded .* but no OPD, lab or IPD income/);
    expect(text).toMatch(/Profit of .* \(2 months with income and expenses\)/);
    expect(text).toMatch(/Loss in 1 of 2 months: May 2026/);
    expect(text).toMatch(/Salaries take 60% of AED income — the main lever/);
    expect(text).toMatch(/Income mix: Consultations 60%, Laboratory 40%/);
  });
  it("pharmacy: purchases above sales flagged as stock build-up", () => {
    const m = [buildMonth("2026-06", 1800000, 1300000), buildMonth("2026-07", 1700000, 2100000)];
    const text = entityInsights("HP", m, [{ name: "Stock purchases", amount: 3400000 }]).map((i) => i.text).join("\n");
    expect(text).toMatch(/Purchases exceeded sales in Jul 2026/);
  });
});

describe("a month still in progress", () => {
  it("is not called the weakest month or compared with whole months", () => {
    const m = [buildMonth("2026-08", 5000000, 3000000), buildMonth("2026-09", 4500000, 3000000), buildMonth("2026-10", 63000, 3000)];
    const text = entityInsights("AED", m, [], "2026-10").map((i) => i.text).join("\n");
    expect(text).toContain("Oct 2026 is still in progress");
    expect(text).toContain("weakest Sep 2026");
    expect(text).not.toMatch(/Oct 2026 vs the earlier average/);
  });
});
