import { describe, expect, it } from "vitest";
import { crossInsights, insightsFromComparison, insightsFromKpis, rankInsights, type Comparison } from "@/lib/insights";

const streams: Comparison = {
  id: "income-stream",
  title: "Income by stream",
  noun: "stream",
  unit: "money",
  rows: [
    { key: "LAB", name: "Laboratory", current: 150000, previous: 100000 },
    { key: "OPD", name: "OPD", current: 40000, previous: 60000 },
    { key: "DIET", name: "Diet", current: 0, previous: 5000 },
  ],
};

describe("insights", () => {
  it("names the biggest riser and faller with their numbers", () => {
    const ins = insightsFromComparison(streams, "Last Month");
    const riser = ins.find((i) => i.id === "income-stream-riser")!;
    expect(riser.headline).toMatch(/Laboratory led the growth/);
    expect(riser.detail).toMatch(/\+50\.0%/);
    expect(riser.tone).toBe("positive");
    const faller = ins.find((i) => i.id === "income-stream-faller")!;
    expect(faller.headline).toMatch(/OPD declined/);
    expect(faller.tone).toBe("negative");
  });
  it("flags concentration, mix shift and streams that stopped", () => {
    const ins = insightsFromComparison(streams, "Last Month");
    expect(ins.find((i) => i.id.endsWith("concentration"))?.headline).toMatch(/Laboratory is 79% of income/);
    expect(ins.find((i) => i.id.endsWith("mix"))?.headline).toMatch(/Laboratory gained/);
    expect(ins.find((i) => i.id.endsWith("dropped"))?.detail).toBe("Diet");
  });
  it("respects goodWhen=down for costs", () => {
    const costs: Comparison = { ...streams, id: "exp", title: "Expenses", goodWhen: "down" };
    expect(insightsFromComparison(costs, "LM").find((i) => i.id === "exp-riser")!.tone).toBe("negative");
  });
  it("KPI insights skip tiny moves and zero bases", () => {
    const ins = insightsFromKpis(
      [
        { key: "totalIncome", label: "Total income", current: 120, previous: 100, unit: "money" },
        { key: "patients", label: "Patients", current: 101, previous: 100, unit: "int" },
        { key: "admissions", label: "Admissions", current: 3, previous: 0, unit: "int" },
        { key: "netMarginPct", label: "Net margin", current: 12, previous: 20, unit: "pct" },
      ],
      "Last Month",
    );
    expect(ins.map((i) => i.id)).toEqual(["kpi-totalIncome", "kpi-admissions", "kpi-netMarginPct"]);
    expect(ins[1].detail).toMatch(/no % change/);
    expect(ins[2].headline).toBe("Net margin down 8.0 pts");
    expect(ins[2].tone).toBe("negative");
  });
  it("detects costs outpacing revenue and operating losses", () => {
    const c = crossInsights({ incomeCur: 100, incomePrev: 100, expenseCur: 130, expensePrev: 100, prevLabel: "LM" });
    expect(c.map((i) => i.id)).toEqual(["cross-cost-vs-revenue", "cross-loss"]);
  });
  it("ranks by weight and de-duplicates", () => {
    const r = rankInsights([
      { id: "a", tone: "neutral", headline: "", detail: "", weight: 1 },
      { id: "b", tone: "neutral", headline: "", detail: "", weight: 9 },
      { id: "a", tone: "neutral", headline: "", detail: "", weight: 5 },
    ]);
    expect(r.map((i) => i.id)).toEqual(["b", "a"]);
  });
});
