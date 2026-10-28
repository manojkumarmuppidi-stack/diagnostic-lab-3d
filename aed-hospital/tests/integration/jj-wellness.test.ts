import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/server/db";
import { importUnattended } from "@/server/services/jj-sync";
import { JJ_PACKAGE_SOURCE } from "@/lib/import/hms";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

type Row = (string | number | Date | null)[];
async function workbook(sheets: Record<string, Row[]>) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
// Typed "10/09/2026" (10 Sep), stored by Excel month-first as 9 Oct.
const excel = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const PACKAGES: Row[] = [
  ["Date", "Patient ID", "Patient Name", "Program", "Advance", "Balance", null, null, "26-08-2026 - 25-09-2026"],
  [excel(2026, 10, 9), 90001, "DEMO ONE", "MMP/GLP", 30000, 50000],
  ["14-09-2026", 90002, "DEMO TWO", "MMP/GLP", 25000, 0, null, null, "TOTAL AMOUNT RECEIVED - 55,000/-"],
  [null, null, null, null, null, null],
  [excel(2026, 1, 10), 90003, "DEMO THREE", "MMP", 50000, 0],
  ["21-10-2026", 90002, "DEMO TWO", "MMP(REBOOKING)", 0, 40000],
];
const OTHER_TABS: Record<string, Row[]> = {
  Consultations: [["Date", "Patient ID", "Patient Name", "Consultation Fee (₹200)", "Remarks"], ["14-09-2026", 90002, "DEMO TWO", 200, null]],
  Injection_Sales: [["Date", "Patient Name", "Drug Name", "Dose", "Qty", "Price", "Total", "DUE"], ["14-09-2026", "DEMO TWO", "MOUNJARO", 5, 1, 15000, 15000, null]],
};

const jjIncome = () => prisma.otherIncome.findMany({ where: { source: JJ_PACKAGE_SOURCE, status: "ACTIVE" }, orderBy: { date: "asc" } });

describe("JJ Wellness workbook", () => {
  it("imports only package payments, with Excel's flipped dates read day-first, and only once", async () => {
    const buf = await workbook({ Package_Payments: PACKAGES, ...OTHER_TABS });
    const first = await importUnattended(f.admin, "Wellness_Hospital_Management_System.xlsx", buf);
    expect(first).toMatchObject({ imported: 3, amount: 105000 });
    const rows = await jjIncome();
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), Number(r.amount), r.reference])).toEqual([
      ["2026-09-10", 30000, "JJW-90001"],
      ["2026-09-14", 25000, "JJW-90002"],
      ["2026-10-01", 50000, "JJW-90003"],
    ]);
    expect(rows[0].description).toBe("MMP/GLP · patient 90001 · balance due ₹50,000");
    // Consultations and injections are already billed in OneGlance: nothing else was imported.
    expect(await prisma.consultation.count()).toBe(0);
    expect(await prisma.pharmacySale.count()).toBe(0);

    // The whole workbook again (nightly sync) with one new payment: only that one is added, and the
    // months with nothing new leave no batch behind.
    const batches = await prisma.importBatch.count();
    const again = await importUnattended(f.admin, "Wellness_Hospital_Management_System.xlsx", await workbook({ Package_Payments: [...PACKAGES, ["22-10-2026", 90004, "DEMO FOUR", "MMP/GLP", 20000, 0]], ...OTHER_TABS }));
    expect(again).toMatchObject({ imported: 1, amount: 20000 });
    expect(await jjIncome()).toHaveLength(4);
    expect(await prisma.importBatch.count()).toBe(batches + 1);
  });
});
