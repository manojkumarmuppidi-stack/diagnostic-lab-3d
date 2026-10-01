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
