import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import { createMaster } from "@/server/services/masters";
import ExcelJS from "exceljs";
import {
  deleteContributor,
  deleteDepartmentCost,
  deleteStaffDepartment,
  departmentAccounts,
  listStaffDepartments,
  monthIn,
  departmentPatients,
  expenditureSheet,
  importDepartmentWorkbook,
  saveContributor,
  saveDepartmentCost,
  setContributorIncome,
} from "@/server/services/departments";
import { DEFAULT_DEPARTMENTS } from "@/lib/departments";
import { createUser, updateUser } from "@/server/services/misc";
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
    const lab = (d: string, id: string, q = 1) =>
      createTransaction(f.admin, "lab", { date: d, patientCode: "P1", patientName: "DEMO A", investigationId: id, quantity: q, paymentModeId: f.ids.CASH });
    await lab("2026-09-05", echo.id, 2);
    await lab("2026-10-05", usg.id);
    await lab("2026-10-05", f.ids.ecg);
    await lab("2026-10-06", f.ids.diabProfile);
    await createTransaction(f.admin, "opd", {
      date: "2026-10-07",
      patientCode: "P2",
      patientName: "DEMO B",
      specialtyId: f.ids.diabetes,
      visitType: "OLD",
      consultationTypeId: scp.id,
      grossAmount: 3000,
      discount: 0,
      paymentModeId: f.ids.CASH,
    });
    await createTransaction(f.admin, "pharmacy-sale", { date: "2026-10-07", invoiceNo: "S1", grossAmount: 9999, discount: 0, paymentModeId: f.ids.CASH });

    const d = await departmentAccounts(f.admin, { from: "2026-09-01", to: "2026-10-31" });
    const by = Object.fromEntries(d.departments.map((g) => [g.name, g]));
    expect(by["Cardiac (2D Echo, TMT, ECG)"]).toMatchObject({ total: 3300, count: 3, byMonth: { "2026-09": 3000, "2026-10": 300 } });
    expect(by["USG scan room"]).toMatchObject({ total: 1500, count: 1 });
    expect(by["SCP — Sugar Control Plans"]).toMatchObject({ total: 3000, items: [{ name: "Sugar Control Plan", stream: "SCP" }] });
    expect(by["Laboratory"]).toMatchObject({ total: 1500, count: 1 });
    expect(d.unassigned).toEqual([]);
    expect(d.grandTotal).toBe(9300);
    expect(d.months).toEqual(["2026-09", "2026-10"]);
  });

  it("gives JJ Wellness ₹200 of every consultation + wellness bill and leaves the rest in OPD", async () => {
    const combo = (await createMaster(f.admin, "consultationTypes", { name: "New Thyroid + Wellness Consultation", defaultRate: 1200 })) as { id: string };
    const plain = (await createMaster(f.admin, "consultationTypes", { name: "Wellness Consultation", defaultRate: 200 })) as { id: string };
    const opd = (d: string, id: string, amt: number) =>
      createTransaction(f.admin, "opd", {
        date: d,
        patientCode: "P3",
        patientName: "DEMO C",
        specialtyId: f.ids.diabetes,
        visitType: "NEW",
        consultationTypeId: id,
        grossAmount: amt,
        discount: 0,
        paymentModeId: f.ids.CASH,
      });
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
    expect(d.departments.find((g) => g.name === "Consultation chambers")!.total).toBe(2000);
    expect(d.grandTotal).toBe(2600);
  });

  it("works out a department's statement from its income and the costs allocated to it, and JJ Wellness's 20%", async () => {
    const wellness = await prisma.department.create({ data: { name: "Wellness" } });
    const combo = (await createMaster(f.admin, "consultationTypes", { name: "New Thyroid + Wellness Consultation", defaultRate: 1200 })) as { id: string };
    await createTransaction(f.admin, "opd", {
      date: "2026-10-08",
      patientCode: "P3",
      patientName: "DEMO C",
      specialtyId: f.ids.diabetes,
      visitType: "NEW",
      consultationTypeId: combo.id,
      grossAmount: 1200,
      discount: 0,
      paymentModeId: f.ids.CASH,
    });
    await createTransaction(f.admin, "other-income", { date: "2026-10-05", source: "JJ Wellness MMP package", amount: 100000, paymentModeId: f.ids.CASH, reference: "JJW-P9" });
    const pen = await prisma.pharmacyItem.create({ data: { name: "INJ MOUNJARO KWIKPEN 5mg/0.6ml", form: "INJ" } });
    const tab = await prisma.pharmacyItem.create({ data: { name: "TAB METFORMIN 500", form: "TAB" } });
    const sale = (itemId: string, amount: number, taxable: number, cost: number) =>
      prisma.pharmacyItemLine.create({
        data: { kind: "SALE", date: new Date("2026-10-10"), itemId, qty: 1, amount, taxable, tax: amount - taxable, cost, fingerprint: `t-${itemId}`, createdById: f.admin.id },
      });
    await sale(pen.id, 21000, 20000, 18000);
    await sale(tab.id, 500, 476, 300);
    const expense = (date: string, categoryId: string, subcategoryId: string | null, amount: number, departmentId: string | null = null) =>
      prisma.expense.create({
        data: { date: new Date(date), departmentId, categoryId, subcategoryId, description: "test", amount, fingerprint: `e-${date}-${amount}`, createdById: f.admin.id },
      });
    await expense("2026-10-20", f.ids.groceries, null, 50000);
    await expense("2026-11-20", f.ids.groceries, f.ids.veg, 20000);
    // Booked to the Wellness expense department, but department accounts only count allocated costs.
    await expense("2026-10-21", f.ids.groceries, null, 0.01, wellness.id);

    const jjId = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "JJ Wellness" } })).id;
    // The automatic incentive on injection sales is off for JJ Wellness by default; switched on here to test it.
    await prisma.serviceDepartment.update({ where: { id: jjId }, data: { pharmacyIncentivePct: 1 } });
    await saveDepartmentCost(f.admin, null, { departmentId: jjId, label: "Salary — counsellor", kind: "FIXED", amount: 30000, fromMonth: "2026-10" });
    await saveDepartmentCost(f.admin, null, { departmentId: jjId, label: "Groceries share", kind: "SHARE", percent: 10, categoryId: f.ids.groceries, fromMonth: "2026-10" });
    const gone = await saveDepartmentCost(f.admin, null, { departmentId: jjId, label: "Old rent", kind: "FIXED", amount: 1, fromMonth: "2026-01", toMonth: "2026-09" });
    await expect(saveDepartmentCost(f.admin, null, { departmentId: jjId, label: "Bad", kind: "SHARE", percent: 10, fromMonth: "2026-10" })).rejects.toThrow(/category/);
    await expect(saveDepartmentCost(f.accounts, null, { departmentId: jjId, label: "x", kind: "FIXED", amount: 1, fromMonth: "2026-10" })).rejects.toThrow();

    const d = await departmentAccounts(f.admin, { from: "2026-10-01", to: "2026-11-30" });
    const jj = d.statements.find((p) => p.name === "JJ Wellness")!;
    expect(jj.incomeLines.map((l) => [l.name, l.total])).toEqual([
      ["JJ Wellness MMP package", 100000],
      ["Injection margin (sales ₹21,000, without GST, after purchase cost)", 2000],
      ["New Thyroid + Wellness Consultation (₹200 per bill)", 200],
    ]);
    expect(jj.costLines.map((l) => [l.label, l.byMonth])).toEqual([
      ["Old rent", {}],
      ["Groceries share", { "2026-10": 5000, "2026-11": 2000 }],
      ["Salary — counsellor", { "2026-10": 30000, "2026-11": 30000 }],
      ["Staff incentive 1% of injection sales", { "2026-10": 210 }],
    ]);
    expect(jj.totals).toEqual({ income: 102200, costs: 67210, profit: 34990, pharmacySales: 21000 });
    expect(jj.profit).toEqual({ "2026-10": 66990, "2026-11": -32000 });
    expect(d.partners.find((p) => p.name === "JJ Wellness")!.totals).toEqual({ profit: 34990, share: 13398, aed: 21592 });

    await deleteDepartmentCost(f.admin, gone.id);
    expect(await prisma.departmentCost.count()).toBe(2);

    const pts = await departmentPatients(f.admin, { departmentId: jjId, from: "2026-10-01", to: "2026-11-30" });
    expect(pts.patients.map((p) => [p.code, p.total])).toEqual([
      ["P9", 100000],
      ["P3", 200],
    ]);
  });

  it("lets a department head see only their department and manage the costs they add; day by day spreads monthly costs", async () => {
    const jjId = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "JJ Wellness" } })).id;
    const labId = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "Laboratory" } })).id;
    const head = { ...f.reception, headOfDepartmentId: jjId };
    await expect(departmentAccounts(f.reception, { from: "2026-10-01", to: "2026-10-31" })).rejects.toThrow(/department head/);

    const adminCost = await saveDepartmentCost(f.admin, null, { departmentId: jjId, label: "Rent share", kind: "FIXED", amount: 31000, fromMonth: "2026-10" });
    const own = await saveDepartmentCost(head, null, { departmentId: jjId, label: "AC maintenance", kind: "FIXED", amount: 3100, fromMonth: "2026-10", toMonth: "2026-10" });
    await expect(saveDepartmentCost(head, null, { departmentId: labId, label: "x", kind: "FIXED", amount: 1, fromMonth: "2026-10" })).rejects.toThrow(/Admin/);
    await expect(saveDepartmentCost(head, adminCost.id, { departmentId: jjId, label: "Rent share", kind: "FIXED", amount: 1, fromMonth: "2026-10" })).rejects.toThrow(/Admin/);
    await expect(deleteDepartmentCost(head, adminCost.id)).rejects.toThrow(/Admin/);
    await expect(departmentPatients(head, { departmentId: labId })).rejects.toThrow(/only the department you head/);

    const mine = await departmentAccounts(head, { from: "2026-10-01", to: "2026-10-31" });
    expect(mine.statements.map((x) => x.name)).toEqual(["JJ Wellness"]);
    expect(mine.departments.map((x) => x.name)).toEqual(["JJ Wellness"]);
    expect(mine.unassigned).toEqual([]);
    expect(mine.statements[0].totals.costs).toBe(34100);

    const days = await departmentAccounts(head, { from: "2026-10-01", to: "2026-10-31", granularity: "day" });
    expect(days.months).toHaveLength(31);
    expect(days.statements[0].costs["2026-10-05"]).toBe(1100);
    expect(days.statements[0].totals.costs).toBe(34100);
    expect(days.partners).toEqual([]);
    await expect(departmentAccounts(f.admin, { from: "2026-01-01", to: "2026-10-31", granularity: "day" })).rejects.toThrow(/62 days/);

    await deleteDepartmentCost(head, own.id);
    expect(await prisma.departmentCost.count()).toBe(1);
  });

  it("an Admin makes a login the head of a department in Staff logins", async () => {
    const jjId = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "JJ Wellness" } })).id;
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "RECEPTION" } });
    const u = await createUser(f.admin, { username: "jj.head", name: "JJ Head", roleId: role.id, headOfDepartmentId: jjId, password: "Welcome123" });
    expect(u.headOfDepartment).toEqual({ id: jjId, name: "JJ Wellness" });
    const cleared = await updateUser(f.admin, u.id, { headOfDepartmentId: null });
    expect(cleared.headOfDepartment).toBeNull();
    await expect(updateUser(f.admin, u.id, { headOfDepartmentId: "nope" })).rejects.toThrow(/Department not found/);
  });

  it("records the income each person brings in and charges their incentive, without adding it to income", async () => {
    const jjId = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "JJ Wellness" } })).id;
    const person = await saveContributor(f.admin, null, { departmentId: jjId, name: "Counsellor A", incentivePct: 10 });
    await setContributorIncome(f.admin, person.id, { month: "2026-09", amount: 90000 });
    await setContributorIncome(f.admin, person.id, { month: "2026-10", amount: 75000 });
    await setContributorIncome(f.admin, person.id, { month: "2026-10", amount: 70000 });
    await expect(setContributorIncome(f.reception, person.id, { month: "2026-10", amount: 1 })).rejects.toThrow(/Admin/);
    await expect(saveContributor({ ...f.reception, headOfDepartmentId: jjId }, null, { departmentId: jjId, name: "x" })).rejects.toThrow(/Admin/);

    const d = await departmentAccounts(f.admin, { from: "2026-09-01", to: "2026-10-31" });
    const jj = d.statements.find((x) => x.name === "JJ Wellness")!;
    expect(jj.totals.income).toBe(0);
    expect(jj.costLines.map((l) => [l.label, l.byMonth])).toEqual([["Incentive — Counsellor A", { "2026-09": 9000, "2026-10": 7000 }]]);
    expect(jj.contributors[0]).toMatchObject({ name: "Counsellor A", totalGenerated: 160000, totalIncentive: 16000 });

    await setContributorIncome(f.admin, person.id, { month: "2026-09", amount: null });
    const head = await departmentAccounts({ ...f.reception, headOfDepartmentId: jjId }, { from: "2026-09-01", to: "2026-10-31" });
    expect(head.statements[0].contributors[0]).toMatchObject({ totalGenerated: 70000, totalIncentive: 7000 });
    await deleteContributor(f.admin, person.id);
    expect(await prisma.contributorIncome.count()).toBe(0);
  });

  it("books a department's costs and people from one Excel file, and a second upload updates instead of repeating", async () => {
    const jjId = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "JJ Wellness" } })).id;
    const wb = new ExcelJS.Workbook();
    const c = wb.addWorksheet("Costs");
    c.addRow(["What is it", "Amount per month", "From month", "Until month"]);
    c.addRow(["Salary — Staff A", 20000, "Apr 2026", ""]);
    c.addRow(["Salary — Staff B", 8000, "2026-05", "Jun 2026"]);
    const p = wb.addWorksheet("People");
    p.addRow(["Person", "Incentive %", "Sep 2026", "Oct 2026"]);
    p.addRow(["Earner A", 3, 100000, null]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(await importDepartmentWorkbook(f.admin, jjId, "jj.xlsx", buf)).toMatchObject({ costsAdded: 2, costsUpdated: 0, people: 1, incomeMonths: 1 });
    expect(await importDepartmentWorkbook(f.admin, jjId, "jj.xlsx", buf)).toMatchObject({ costsAdded: 0, costsUpdated: 2 });
    await expect(importDepartmentWorkbook(f.reception, jjId, "jj.xlsx", buf)).rejects.toThrow(/Admin/);

    const d = await departmentAccounts(f.admin, { from: "2026-04-01", to: "2026-10-31" });
    const jj = d.statements.find((x) => x.name === "JJ Wellness")!;
    expect(jj.costLines.map((l) => [l.label, l.total])).toEqual([
      ["Salary — Staff A", 140000],
      ["Salary — Staff B", 16000],
      ["Incentive — Earner A", 3000],
    ]);

    const pctBook = new ExcelJS.Workbook();
    const pc = pctBook.addWorksheet("Costs");
    pc.addRow(["What is it", "Amount per month", "% of department income", "From month", "Until month"]);
    pc.addRow(["Incentive — Staff A (3%)", null, 3, "Nov 2026", null]);
    expect(await importDepartmentWorkbook(f.admin, jjId, "pct.xlsx", Buffer.from(await pctBook.xlsx.writeBuffer()))).toMatchObject({ costsAdded: 1 });
    expect(await prisma.departmentCost.findFirst({ where: { label: "Incentive — Staff A (3%)" } })).toMatchObject({ kind: "INCOME", fromMonth: "2026-11", toMonth: null });

    const bad = new ExcelJS.Workbook();
    const b = bad.addWorksheet("Costs");
    b.addRow(["What is it", "Amount per month", "From month", "Until month"]);
    b.addRow(["Salary — Staff C", "", "Apr 2026", ""]);
    await expect(importDepartmentWorkbook(f.admin, jjId, "bad.xlsx", Buffer.from(await bad.xlsx.writeBuffer()))).rejects.toThrow(/Nothing was saved/);
  });

  it("charges an incentive as a % of the department's own billed income, not of its injection margin", async () => {
    const jjId = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "JJ Wellness" } })).id;
    await createTransaction(f.admin, "other-income", { date: "2026-11-05", source: "JJ Wellness MMP package", amount: 100000, paymentModeId: f.ids.CASH });
    const pen = await prisma.pharmacyItem.create({ data: { name: "INJ MOUNJARO KWIKPEN 5mg/0.6ml", form: "INJ" } });
    await prisma.pharmacyItemLine.create({
      data: { kind: "SALE", date: new Date("2026-11-10"), itemId: pen.id, qty: 1, amount: 21000, taxable: 20000, cost: 18000, fingerprint: "t-pen", createdById: f.admin.id },
    });
    for (const who of ["A", "B", "C"])
      await saveDepartmentCost(f.admin, null, { departmentId: jjId, label: `Incentive — ${who} (3%)`, kind: "INCOME", percent: 3, fromMonth: "2026-11" });
    await expect(saveDepartmentCost(f.admin, null, { departmentId: jjId, label: "x", kind: "INCOME", fromMonth: "2026-11" })).rejects.toThrow(/%/);
    const d = await departmentAccounts(f.admin, { from: "2026-11-01", to: "2026-11-30" });
    const jj = d.statements.find((x) => x.name === "JJ Wellness")!;
    expect(jj.totals.income).toBe(102000);
    expect(jj.costLines.map((l) => [l.label, l.total])).toEqual([
      ["Incentive — A (3%)", 3000],
      ["Incentive — B (3%)", 3000],
      ["Incentive — C (3%)", 3000],
    ]);
    const days = await departmentAccounts(f.admin, { from: "2026-11-01", to: "2026-11-30", granularity: "day" });
    expect(days.statements.find((x) => x.name === "JJ Wellness")!.costs["2026-11-05"]).toBe(9000);
  });

  it("books costs for every department from one sheet with a Department column", async () => {
    const wb = new ExcelJS.Workbook();
    const c = wb.addWorksheet("Costs");
    c.addRow(["Department", "Type", "What is it", "Amount per month", "From month", "Until month"]);
    c.addRow(["Laboratory", "Salary", "Technician A", 18000, "Jan 2026", "Oct 2026"]);
    c.addRow(["USG scan room", "Repair & maintenance", "Probe repair", 12000, "Mar 2026", "Mar 2026"]);
    c.addRow(["Ophthalmology", "", "Salary — Optometrist", 15000, "Jan 2026", "Oct 2026"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await importDepartmentWorkbook(f.admin, null, "all.xlsx", buf);
    expect(r).toMatchObject({ department: "All departments", costsAdded: 3 });
    expect(r.departments.map((d) => d.name).sort()).toEqual(["Laboratory", "Ophthalmology", "USG scan room"]);
    const lab = await prisma.departmentCost.findFirstOrThrow({ where: { department: { name: "Laboratory" } } });
    expect(lab).toMatchObject({ label: "Salary — Technician A", fromMonth: "2026-01", toMonth: "2026-10" });
    expect(await prisma.departmentCost.findFirst({ where: { label: "Repair & maintenance — Probe repair" } })).not.toBeNull();
    expect(await importDepartmentWorkbook(f.admin, null, "all.xlsx", buf)).toMatchObject({ costsAdded: 0, costsUpdated: 3 });

    const bad = new ExcelJS.Workbook();
    const b = bad.addWorksheet("Costs");
    b.addRow(["Department", "What is it", "Amount per month", "From month"]);
    b.addRow(["Radiology wing", "Salary — X", 1000, "Jan 2026"]);
    b.addRow(["", "Salary — Y", 1000, "Jan 2026"]);
    await expect(importDepartmentWorkbook(f.admin, null, "bad.xlsx", Buffer.from(await bad.xlsx.writeBuffer()))).rejects.toThrow(
      /no department called "Radiology wing".*choose the department/,
    );
  });

  it("reads a department's monthly expenditure sheet (months across), and its head can upload it again to correct it", async () => {
    const physio = await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "Foot exam, neuropathy & physiotherapy" } });
    const sheet = (rows: (string | number | null)[][]) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Physio");
      ws.addRow(["AED Hospital — monthly expenditure"]);
      ws.addRow(["Department: Foot exam, neuropathy & physiotherapy"]);
      ws.addRow(["Category", "Name / item", "Jan 2026", "Feb 2026", "Mar 2026", "Total"]);
      rows.forEach((r) => ws.addRow(r));
      return wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
    };
    const first = await sheet([
      ["Salaries", "Therapist A", 20000, 20000, 22000, null],
      ["Salaries", "", null, null, null, null],
      ["Maintenance & repair", "Traction unit", null, 3500, null, null],
      ["Groceries", "", 800, 800, 800, null],
      ["Total", "", 20800, 24300, 22800, null],
    ]);
    const r = await importDepartmentWorkbook(f.admin, null, "physio.xlsx", first);
    expect(r).toMatchObject({ department: "Foot exam, neuropathy & physiotherapy", costsAdded: 4 });
    const rows = await prisma.departmentCost.findMany({ where: { departmentId: physio.id }, orderBy: [{ label: "asc" }, { fromMonth: "asc" }] });
    expect(rows.map((x) => [x.label, Number(x.amount), x.fromMonth, x.toMonth])).toEqual([
      ["Groceries", 800, "2026-01", "2026-03"],
      ["Repair & maintenance — Traction unit", 3500, "2026-02", "2026-02"],
      ["Salary — Therapist A", 20000, "2026-01", "2026-02"],
      ["Salary — Therapist A", 22000, "2026-03", "2026-03"],
    ]);

    // Wrong statement, other heads and Admin-entered rows are refused.
    const usg = await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "USG scan room" } });
    await expect(importDepartmentWorkbook(f.admin, usg.id, "physio.xlsx", first)).rejects.toThrow(/is for Foot exam/);
    // A blank tab for another department (the shared workbook) is skipped, not refused.
    const shared = new ExcelJS.Workbook();
    const other = shared.addWorksheet("USG");
    other.addRow(["Department: USG scan room"]);
    other.addRow(["Category", "Name / item", "Jan 2026"]);
    other.addRow(["Salaries", "", null]);
    other.addRow(["Total", "", { formula: "SUM(C3:C3)" } as unknown as number]); // never calculated: counts as blank
    const mine = shared.addWorksheet("Physio");
    mine.addRow(["Department: Foot exam, neuropathy & physiotherapy"]);
    mine.addRow(["Category", "Name / item", "Jan 2026"]);
    mine.addRow(["Consumables", "Gel", 600]);
    expect(await importDepartmentWorkbook(f.admin, physio.id, "shared.xlsx", Buffer.from(await shared.xlsx.writeBuffer()))).toMatchObject({ costsAdded: 1 });
    await expect(importDepartmentWorkbook({ ...f.reception, headOfDepartmentId: usg.id }, null, "physio.xlsx", first)).rejects.toThrow(/only for the department you head/);
    const head = { ...f.reception, headOfDepartmentId: physio.id };
    await expect(importDepartmentWorkbook(head, physio.id, "physio.xlsx", first)).rejects.toThrow(/entered by the Admin/);

    // The head's own corrected sheet replaces their earlier figures for those months, without doubling.
    await prisma.departmentCost.deleteMany({ where: { departmentId: physio.id } });
    await importDepartmentWorkbook(head, physio.id, "physio.xlsx", first);
    await importDepartmentWorkbook(head, physio.id, "physio.xlsx", await sheet([["Salaries", "Therapist A", 21000, 21000, 21000, null]]));
    const d = await departmentAccounts(f.admin, { from: "2026-01-01", to: "2026-03-31" });
    const st = d.statements.find((x) => x.id === physio.id)!;
    expect(st.costLines.filter((l) => l.label === "Salary — Therapist A").reduce((a, l) => a + l.total, 0)).toBe(63000);
    expect(st.costLines.find((l) => l.label === "Groceries")!.total).toBe(2400);
  });

  it("the downloaded blank sheet, once filled in, imports straight back", async () => {
    const lab = await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "Laboratory" } });
    const all = await expenditureSheet(f.admin, { from: "2026-01", to: "2026-10" });
    expect(all.fileName).toBe("AED-All-departments-expenditure-2026-01-to-2026-10.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(all.buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toContain("Laboratory");
    const ws = wb.getWorksheet("Laboratory")!;
    expect(ws.getRow(4).getCell(3).value).toBe("Jan 2026");
    ws.getCell("B5").value = "Technician A";
    ws.getCell("C5").value = 18000;
    ws.getCell("D5").value = 18000;
    const r = await importDepartmentWorkbook(f.admin, null, "filled.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.departments).toEqual([{ name: "Laboratory", rows: 1 }]);
    expect(await prisma.departmentCost.findFirst({ where: { departmentId: lab.id, label: "Salary — Technician A" } })).toMatchObject({ fromMonth: "2026-01", toMonth: "2026-02" });

    // A department head gets only their own department; other logins get nothing.
    const mine = await expenditureSheet({ ...f.reception, headOfDepartmentId: lab.id }, { from: "2026-11", to: "2026-11" });
    const one = new ExcelJS.Workbook();
    await one.xlsx.load(mine.buffer as unknown as ArrayBuffer);
    expect(one.worksheets.map((w) => w.name)).toEqual(["Laboratory"]);
    await expect(expenditureSheet(f.reception, {})).rejects.toThrow();
  });

  it("charges a visiting doctor's hospital expenses to a department by name", async () => {
    const eye = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "Ophthalmology" } })).id;
    const expense = (date: string, description: string, amount: number, vendor: string | null = null) =>
      prisma.expense.create({
        data: { date: new Date(date), categoryId: f.ids.groceries, description, vendor, amount, fingerprint: `m-${date}-${amount}`, createdById: f.admin.id },
      });
    await expense("2026-09-03", "Dr. GeethaPriya consultation fee", 8000);
    await expense("2026-10-03", "Consultations Sept", 9000, "Dr Geetha Priya");
    await expense("2026-10-04", "Geetha Priya", 1500);
    await expense("2026-10-05", "Dr. Priya Geetha? no", 999999);
    await expect(saveDepartmentCost(f.admin, null, { departmentId: eye, label: "Doctor", kind: "MATCH", matchText: " , ", fromMonth: "2026-01" })).rejects.toThrow();
    await saveDepartmentCost(f.admin, null, {
      departmentId: eye,
      label: "Consultations — Dr. Geetha Priya",
      kind: "MATCH",
      matchText: "Geetha Priya, Geethapriya",
      fromMonth: "2026-01",
    });
    const d = await departmentAccounts(f.admin, { from: "2026-09-01", to: "2026-10-31" });
    const st = d.statements.find((x) => x.name === "Ophthalmology")!;
    expect(st.costLines.map((l) => [l.label, l.byMonth])).toEqual([["Consultations — Dr. Geetha Priya", { "2026-09": 8000, "2026-10": 10500 }]]);
  });

  it("maps staff to departments once, then charges each payroll upload to them (and a re-upload replaces it)", async () => {
    expect(monthIn("November_2026_Salaries.xlsx")).toBe("2026-11");
    expect(monthIn("salaries for the month of March 2026")).toBe("2026-03");
    const staff = new ExcelJS.Workbook();
    const s = staff.addWorksheet("Staff → department");
    s.addRow(["Staff (as in the bank list)", "Also written as", "Department", "% to that department (blank = 100)", "Second department (if shared)"]);
    s.addRow(["Tech A", "A. Tech, Technician A", "Laboratory", null, null]);
    s.addRow(["Helper B", "", "USG scan room", 50, "Hospital-wide (Others)"]);
    s.addRow(["Admin C", "", "Hospital-wide (Others)", null, null]);
    await expect(importDepartmentWorkbook(f.accounts, null, "staff.xlsx", Buffer.from(await staff.xlsx.writeBuffer()))).rejects.toThrow();
    expect(await importDepartmentWorkbook(f.admin, null, "staff.xlsx", Buffer.from(await staff.xlsx.writeBuffer()))).toMatchObject({ staff: 3, costsAdded: 0 });
    expect((await listStaffDepartments(f.admin)).map((r) => [r.label, r.department, r.percent])).toEqual([
      ["Helper B", "USG scan room", 50],
      ["Tech A", "Laboratory", 100],
    ]);

    const payroll = async (rows: [string, number][]) => {
      const wb = new ExcelJS.Workbook();
      const w = wb.addWorksheet("Sheet1");
      w.addRow(["SNO", "NAME", "AMOUNT", "BANK", "IFSC CODE", "ACCOUNT NO"]);
      rows.forEach(([n, a], i) => w.addRow([i + 1, n, a, "BANK", "TEST0000001", "000"]));
      w.addRow([null, null, rows.reduce((t, [, a]) => t + a, 0)]);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const nov = await payroll([
      ["Technician A", 20000],
      ["Helper B", 30000],
      ["Admin C", 90000],
      ["New Person", 10000],
    ]);
    await expect(importDepartmentWorkbook(f.admin, null, "payroll.xlsx", nov)).rejects.toThrow(/which month/);
    const r = await importDepartmentWorkbook(f.admin, null, "November 2026 Salaries.xlsx", nov);
    expect(r.payroll).toEqual({ months: ["2026-11"], charged: 2, notCharged: ["Admin C", "New Person"] });
    const costs = await prisma.departmentCost.findMany({ include: { department: true }, orderBy: { label: "asc" } });
    expect(costs.map((c) => [c.department.name, c.label, Number(c.amount), c.fromMonth, c.toMonth])).toEqual([
      ["USG scan room", "Salary — Helper B", 15000, "2026-11", "2026-11"],
      ["Laboratory", "Salary — Tech A", 20000, "2026-11", "2026-11"],
    ]);
    // A corrected November file replaces November, it does not add to it.
    await importDepartmentWorkbook(f.admin, null, "November 2026 Salaries.xlsx", await payroll([["Tech A", 21000]]));
    expect((await prisma.departmentCost.findMany({ where: { label: "Salary — Tech A" } })).map((c) => Number(c.amount))).toEqual([21000]);

    const helper = (await listStaffDepartments(f.admin)).find((x) => x.label === "Helper B")!;
    await deleteStaffDepartment(f.admin, helper.id);
    expect((await importDepartmentWorkbook(f.admin, null, "December 2026 Salaries.xlsx", await payroll([["Helper B", 1]]))).payroll.notCharged).toEqual(["Helper B"]);
  });
});
