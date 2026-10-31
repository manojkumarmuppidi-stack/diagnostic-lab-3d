import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { importBankStatements, bookBankPayments, bankReport } from "@/server/services/bank";
import { assetFromExpenses, capitalExpenses, listAssets, postDepreciation, saveAsset } from "@/server/services/assets";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});
const T = (c: string[]) => c.join("\t");

describe("fixed assets", () => {
  it("turns vehicle payments entered as expenses into an asset, and posts a finished year's depreciation once", async () => {
    const cap = await prisma.expenseCategory.create({ data: { name: "Equipment (capital)", group: "OTHER" } });
    const veh = await prisma.expenseCategory.create({ data: { name: "Vehicles", group: "OTHER", parentId: cap.id } });
    await prisma.expenseCategory.create({ data: { name: "Depreciation", group: "OTHER" } });
    await prisma.paymentMode.create({ data: { code: "BOOK", name: "Book entry (non-cash)", reconGroup: "OTHER" } });
    const st = [
      T(["Account Number     :", "_00000012345678901"]),
      T(["Opening Balance as on 1 Oct 2026        :", "30,00,000.00"]),
      T(["Txn Date", "Value Date", "Description", "Ref", "Branch", "Debit", "Credit", "Balance", ""]),
      T(["2 Oct 2026", "2 Oct 2026", "TO TRANSFER-UPI/DR/1/NANESH A/X/y/Book--", "", "1", "50,000.00", " ", "29,50,000.00", ""]),
      T(["6 Oct 2026", "6 Oct 2026", "CHQ TRANSFER-RTGS UTR NO: SBINR1--269020 NANESH AUTOMOTIVES PVT LTD", "", "1", "19,50,000.00", " ", "10,00,000.00", ""]),
    ].join("\n");
    await importBankStatements(f.admin, [{ name: "s.xls", buf: Buffer.from(st, "latin1") }]);
    const lines = await prisma.bankLine.findMany();
    await bookBankPayments(f.admin, { lineIds: lines.map((l) => l.id), categoryId: cap.id, subcategoryId: veh.id, description: "Vehicle (VinFast)" });
    const before = await capitalExpenses(f.admin);
    expect(before.map((e) => e.amount)).toEqual([50000, 1950000]);

    await expect(assetFromExpenses(f.management, { name: "x", expenseIds: before.map((e) => e.id) })).rejects.toThrow();
    const r = await assetFromExpenses(f.admin, {
      name: "VinFast car (Nanesh Automotives)",
      category: "Vehicles",
      method: "SLM",
      usefulLifeYears: 8,
      residualPct: 5,
      expenseIds: before.map((e) => e.id),
    });
    expect(r).toMatchObject({ cost: 2000000, voided: 2 });
    expect(await capitalExpenses(f.admin)).toEqual([]);
    expect(await prisma.expense.count({ where: { status: "ACTIVE" } })).toBe(0);
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: r.id } });
    expect(asset.bankLineIds.sort()).toEqual(lines.map((l) => l.id).sort());
    expect(asset.purchaseDate.toISOString().slice(0, 10)).toBe("2026-10-02");
    // The bank check counts both payments as accounted for (assets), not "not found".
    const rep = await bankReport(f.admin, { from: "2026-10-01", to: "2026-10-31" });
    expect(rep.moneyOut).toEqual([{ month: "2026-10", total: 2000000, matched: 0, notExpense: 2000000, unmatched: 0 }]);

    // A year that has not ended cannot be posted; one that has, is posted once.
    await expect(postDepreciation(f.admin, { fy: "2026-27" })).rejects.toThrow(/has not ended/);
    const old = await saveAsset(f.admin, null, { name: "ECG machine", category: "Equipment", purchaseDate: "2025-04-01", cost: 100000, method: "WDV", ratePct: 15 });
    const list = await listAssets(f.admin);
    expect(list.years.find((y) => y.fy === "2025-26")).toMatchObject({ depreciation: 15000, ended: true, posted: false });
    expect(await postDepreciation(f.admin, { fy: "2025-26" })).toEqual({ posted: 1, amount: 15000 });
    expect(await postDepreciation(f.admin, { fy: "2025-26" })).toEqual({ posted: 0, amount: 0 });
    const dep = await prisma.expense.findFirstOrThrow({ where: { billNumber: { startsWith: "DEP-" } }, include: { category: true } });
    expect([dep.category.name, dep.date.toISOString().slice(0, 10), Number(dep.amount)]).toEqual(["Depreciation", "2026-03-31", 15000]);
    expect((await listAssets(f.admin)).assets.find((a) => a.id === old.id)!.schedule[0].posted).toBe(true);
  });
});
