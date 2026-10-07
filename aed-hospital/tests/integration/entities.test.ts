import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import { entityAccounts } from "@/server/services/entities";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

describe("AED Hospital vs Hormonal Pharmacy", () => {
  it("splits income and expenses by entity; pharmacy-department costs go to the pharmacy", async () => {
    const D = "2026-08-10";
    const pharmacyDept = await prisma.department.create({ data: { name: "Pharmacy" } });
    await createTransaction(f.admin, "opd", { date: D, patientCode: "P1", patientName: "DEMO A", specialtyId: f.ids.diabetes, visitType: "NEW", grossAmount: 1000, discount: 0, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "lab", { date: D, patientCode: "P1", patientName: "DEMO A", investigationId: f.ids.ecg, quantity: 1, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "pharmacy-sale", { date: D, invoiceNo: "S1", grossAmount: 5000, discount: 0, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "pharmacy-purchase", { date: D, supplier: "Demo", invoiceNo: "P1", amount: 3500, paymentModeId: f.ids.BANK });
    await createTransaction(f.admin, "expense", { date: D, categoryId: f.ids.otherExp, description: "Rent", amount: 900, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "expense", { date: D, categoryId: f.ids.otherExp, departmentId: pharmacyDept.id, description: "Pharmacist", amount: 400, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "expense", { date: "2026-07-05", categoryId: f.ids.otherExp, description: "July rent", amount: 900, paymentModeId: f.ids.CASH });
    const r = await entityAccounts(f.admin, { from: "2026-07-01", to: "2026-08-31" });
    expect(r.months).toEqual(["2026-07", "2026-08"]);
    expect(r.entities.AED.totals).toMatchObject({ income: 1300, expenses: 1800 });
    expect(r.entities.AED.completeTotals).toMatchObject({ income: 1300, expenses: 900, profit: 400 });
    expect(r.entities.AED.months[0].incomeMissing).toBe(true);
    expect(r.entities.HP.totals).toMatchObject({ income: 5000, expenses: 3900, profit: 1100 });
    expect(r.entities.HP.costs.map((c) => c.name)).toEqual(["Stock purchases", "Other"]);
    expect(r.combined.profit).toBe(1300 + 5000 - 1800 - 3900);
  });
});

describe("AED vs Hormonal Pharmacy P&L as a PDF", () => {
  it("renders both entities on one page, with plain-text money and no blank page", async () => {
    const { entityReport } = await import("@/server/services/entities");
    const { reportToPdf } = await import("@/server/exporters");
    for (const [d, n] of [["2026-08-10", 1], ["2026-09-10", 2]] as const) {
      await createTransaction(f.admin, "lab", { date: d, patientCode: "P1", patientName: "DEMO A", investigationId: f.ids.ecg, quantity: n, paymentModeId: f.ids.CASH });
      await createTransaction(f.admin, "pharmacy-sale", { date: d, invoiceNo: `S${n}`, grossAmount: 5000, discount: 0, paymentModeId: f.ids.CASH });
      await createTransaction(f.admin, "pharmacy-purchase", { date: d, supplier: "Demo", invoiceNo: `P${n}`, amount: 3500 * n, paymentModeId: f.ids.BANK });
      await createTransaction(f.admin, "expense", { date: d, categoryId: f.ids.otherExp, description: "Rent", amount: 100, paymentModeId: f.ids.CASH });
    }
    const r = await entityReport(f.admin, { from: "2026-08-01", to: "2026-09-30" });
    expect(r.kpis.map((k) => k.value)).toEqual([900, 200, 700, 10000, 10500, -500]);
    expect(r.tables.map((t) => t.title)).toEqual(["AED Hospital — month by month", "AED Hospital — where the money goes", "Hormonal Pharmacy — month by month", "Hormonal Pharmacy — where the money goes"]);
    expect(r.notes.join(" ")).not.toMatch(/[₹−]/);
    const pdf = (await reportToPdf(r)).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBe(1);
  });
});

describe("income trend series", () => {
  it("counts AED Hospital income only; pharmacy sales stay visible on their own", async () => {
    const { incomeSeries } = await import("@/server/services/analytics");
    const D = "2026-08-10";
    await createTransaction(f.admin, "lab", { date: D, patientCode: "P1", patientName: "DEMO A", investigationId: f.ids.ecg, quantity: 1, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "pharmacy-sale", { date: D, invoiceNo: "S1", grossAmount: 5000, discount: 0, paymentModeId: f.ids.CASH });
    const [b] = await incomeSeries({ from: D, to: D }, "day");
    expect(b).toMatchObject({ LAB: 300, PHARMACY: 5000, income: 300, net: 300 });
  });
});

describe("board meeting: every lab test with count and amount", () => {
  it("lists all tests performed in either period, not just the top ones", async () => {
    const { getSectionInsights } = await import("@/server/services/insights");
    const invs = [];
    for (let i = 0; i < 20; i++) invs.push((await prisma.labInvestigation.create({ data: { name: `Test ${String(i).padStart(2, "0")}`, category: "Pathology", rate: 100 + i } })).id);
    for (const [i, id] of invs.entries())
      await createTransaction(f.admin, "lab", { date: "2026-09-10", patientCode: "P1", patientName: "DEMO A", investigationId: id, quantity: (i % 3) + 1, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "lab", { date: "2026-08-10", patientCode: "P1", patientName: "DEMO A", investigationId: f.ids.ecg, quantity: 2, paymentModeId: f.ids.CASH });
    const { section: s } = await getSectionInsights(f.admin, "lab", { from: "2026-09-01", to: "2026-09-30", compareFrom: "2026-08-01", compareTo: "2026-08-31" });
    expect(s.labTests).toHaveLength(21);
    const t19 = s.labTests!.find((r) => r.name === "Test 19")!;
    expect(t19).toMatchObject({ tests: 2, prevTests: 0, amount: 238, prevAmount: 0 });
    expect(s.labTests!.find((r) => r.name === "ECG")).toMatchObject({ tests: 0, prevTests: 2, amount: 0, prevAmount: 600 });
  });
});
