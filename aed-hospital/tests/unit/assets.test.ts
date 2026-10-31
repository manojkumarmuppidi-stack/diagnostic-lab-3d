import { describe, expect, it } from "vitest";
import { depreciationSchedule } from "@/server/services/assets";

describe("depreciation", () => {
  it("straight line: (cost − residual) ÷ life a year, the first year from the purchase date, never below the residual", () => {
    const s = depreciationSchedule({ purchaseDate: "2026-10-01", cost: 2500000, method: "SLM", usefulLifeYears: 8, residualPct: 5, ratePct: 0 }, "2035-12-31");
    expect(s[0]).toMatchObject({ fy: "2026-27", from: "2026-10-01", opening: 2500000 });
    // 2,96,875 a year; Oct–Mar = 182 of 365 days.
    expect(s[0].depreciation).toBe(Math.round((((2375000 / 8) * 182) / 365) * 100) / 100);
    expect(s[1]).toMatchObject({ fy: "2027-28", depreciation: 296875 });
    expect(s[s.length - 1].closing).toBe(125000);
    expect(s.reduce((a, r) => a + r.depreciation, 0)).toBeCloseTo(2375000, 1);
  });
  it("written-down value: a % of the remaining value each year", () => {
    const s = depreciationSchedule({ purchaseDate: "2026-04-01", cost: 2000000, method: "WDV", usefulLifeYears: 8, residualPct: 0, ratePct: 15 }, "2028-04-01");
    expect(s.map((r) => [r.fy, r.depreciation, r.closing])).toEqual([
      ["2026-27", 300000, 1700000],
      ["2027-28", 255000, 1445000],
      ["2028-29", 216750, 1228250],
    ]);
  });
});
