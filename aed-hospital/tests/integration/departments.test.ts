import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import { createMaster } from "@/server/services/masters";
import { departmentAccounts } from "@/server/services/departments";
import { DEFAULT_DEPARTMENTS } from "@/lib/departments";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
  for (const [i, d] of DEFAULT_DEPARTMENTS.entries()) await prisma.serviceDepartment.create({ data: { ...d, sortOrder: (i + 1) * 10 } });
});

describe("department accounts", () => {
  it("groups AED income by department and month, lists unassigned names, leaves the pharmacy out", async () => {
    const echo = await prisma.labInvestigation.create({ data: { name: "2D Echo", category: "Cardiac", rate: 1500 } });
    const usg = await prisma.labInvestigation.create({ data: { name: "USG Thyroid Doppler Scan", category: "Radiology", rate: 1500 } });
    const scp = (await createMaster(f.admin, "consultationTypes", { name: "Sugar Control Plan", defaultRate: 0 })) as { id: string };
    const lab = (d: string, id: string, q = 1) => createTransaction(f.admin, "lab", { date: d, patientCode: "P1", patientName: "DEMO A", investigationId: id, quantity: q, paymentModeId: f.ids.CASH });
    await lab("2026-09-05", echo.id, 2);
    await lab("2026-10-05", usg.id);
    await lab("2026-10-05", f.ids.ecg);
    await lab("2026-10-06", f.ids.diabProfile);
    await createTransaction(f.admin, "opd", { date: "2026-10-07", patientCode: "P2", patientName: "DEMO B", specialtyId: f.ids.diabetes, visitType: "OLD", consultationTypeId: scp.id, grossAmount: 3000, discount: 0, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "pharmacy-sale", { date: "2026-10-07", invoiceNo: "S1", grossAmount: 9999, discount: 0, paymentModeId: f.ids.CASH });

    const d = await departmentAccounts(f.admin, { from: "2026-09-01", to: "2026-10-31" });
    const by = Object.fromEntries(d.departments.map((g) => [g.name, g]));
    expect(by["Cardiac (2D Echo, TMT, ECG)"]).toMatchObject({ total: 3300, count: 3, byMonth: { "2026-09": 3000, "2026-10": 300 } });
    expect(by["USG scan room"]).toMatchObject({ total: 1500, count: 1 });
    expect(by["SCP — Sugar Control Plans"]).toMatchObject({ total: 3000, items: [{ name: "Sugar Control Plan", stream: "SCP" }] });
    expect(d.unassigned.map((g) => [g.name, g.total])).toEqual([["Laboratory — not in a department", 1500]]);
    expect(d.grandTotal).toBe(9300);
    expect(d.months).toEqual(["2026-09", "2026-10"]);
  });

  it("gives JJ Wellness ₹200 of every consultation + wellness bill and leaves the rest in OPD", async () => {
    const combo = (await createMaster(f.admin, "consultationTypes", { name: "New Thyroid + Wellness Consultation", defaultRate: 1200 })) as { id: string };
    const plain = (await createMaster(f.admin, "consultationTypes", { name: "Wellness Consultation", defaultRate: 200 })) as { id: string };
    const opd = (d: string, id: string, amt: number) =>
      createTransaction(f.admin, "opd", { date: d, patientCode: "P3", patientName: "DEMO C", specialtyId: f.ids.diabetes, visitType: "NEW", consultationTypeId: id, grossAmount: amt, discount: 0, paymentModeId: f.ids.CASH });
    await opd("2026-10-08", combo.id, 1200);
    await opd("2026-10-09", combo.id, 1200);
    await opd("2026-10-09", plain.id, 200);
    const d = await departmentAccounts(f.admin, { from: "2026-10-01", to: "2026-10-31" });
    const jj = d.departments.find((g) => g.name === "JJ Wellness")!;
    expect(jj.total).toBe(600);
    expect(jj.items.map((i) => [i.name, i.count, i.total])).toEqual([
      ["New Thyroid + Wellness Consultation (₹200 per bill)", 2, 400],
      ["Wellness Consultation", 1, 200],
    ]);
    expect(d.unassigned.map((g) => [g.name, g.total])).toEqual([["OPD — not in a department", 2000]]);
    expect(d.grandTotal).toBe(2600);
  });

  it("works out each department's profit and JJ Wellness's 20% of its combined profit, month by month", async () => {
    const wellness = await prisma.department.create({ data: { name: "Wellness" } });
    const combo = (await createMaster(f.admin, "consultationTypes", { name: "New Thyroid + Wellness Consultation", defaultRate: 1200 })) as { id: string };
    await createTransaction(f.admin, "opd", { date: "2026-10-08", patientCode: "P3", patientName: "DEMO C", specialtyId: f.ids.diabetes, visitType: "NEW", consultationTypeId: combo.id, grossAmount: 1200, discount: 0, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "other-income", { date: "2026-10-05", source: "JJ Wellness MMP package", amount: 100000, paymentModeId: f.ids.CASH });
    const pen = await prisma.pharmacyItem.create({ data: { name: "INJ MOUNJARO KWIKPEN 5mg/0.6ml", form: "INJ" } });
    const tab = await prisma.pharmacyItem.create({ data: { name: "TAB METFORMIN 500", form: "TAB" } });
    const sale = (itemId: string, amount: number, taxable: number, cost: number) =>
      prisma.pharmacyItemLine.create({ data: { kind: "SALE", date: new Date("2026-10-10"), itemId, qty: 1, amount, taxable, tax: amount - taxable, cost, fingerprint: `t-${itemId}`, createdById: f.admin.id } });
    await sale(pen.id, 21000, 20000, 18000);
    await sale(tab.id, 500, 476, 300);
    const expense = (date: string, departmentId: string, amount: number) =>
      prisma.expense.create({ data: { date: new Date(date), departmentId, categoryId: f.ids.groceries, description: "test", amount, fingerprint: `e-${date}-${amount}`, createdById: f.admin.id } });
    await expense("2026-10-20", wellness.id, 30000);
    await expense("2026-11-20", wellness.id, 50000);
    await expense("2026-10-21", f.ids.lab, 5000);

    const d = await departmentAccounts(f.admin, { from: "2026-10-01", to: "2026-11-30" });
    // One department: MMP package + ₹200 wellness share + injection margin − Wellness expenses − 1% incentive.
    const jjDept = d.profit.find((p) => p.name === "JJ Wellness")!;
    expect(jjDept.totals).toEqual({ income: 100200, pharmacySales: 21000, pharmacyMargin: 2000, expenses: 80000, incentive: 210, profit: 21990 });
    expect(jjDept.profit).toEqual({ "2026-10": 71990, "2026-11": -50000 });
    expect(jjDept.medicines).toEqual([{ name: "INJ MOUNJARO KWIKPEN 5mg/0.6ml", sales: 21000, margin: 2000 }]);
    expect(d.sharedExpenses.total).toBe(5000);
    const jj = d.partners.find((p) => p.name === "JJ Wellness")!;
    expect(jj.profit).toEqual({ "2026-10": 71990, "2026-11": -50000 });
    expect(jj.share).toEqual({ "2026-10": 14398, "2026-11": 0 });
    expect(jj.totals).toEqual({ profit: 21990, share: 14398, aed: 7592 });
  });
});

