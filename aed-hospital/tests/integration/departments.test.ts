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
  for (const [i, [name, keywords, addOnKeywords = "", addOnAmount = 0]] of DEFAULT_DEPARTMENTS.entries())
    await prisma.serviceDepartment.create({ data: { name, keywords, addOnKeywords, addOnAmount, sortOrder: (i + 1) * 10 } });
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
    const jj = d.departments.find((g) => g.name === "JJ Wellness (skin, hair, BMI)")!;
    expect(jj.total).toBe(600);
    expect(jj.items.map((i) => [i.name, i.count, i.total])).toEqual([
      ["New Thyroid + Wellness Consultation (₹200 per bill)", 2, 400],
      ["Wellness Consultation", 1, 200],
    ]);
    expect(d.unassigned.map((g) => [g.name, g.total])).toEqual([["OPD — not in a department", 2000]]);
    expect(d.grandTotal).toBe(2600);
  });
});
