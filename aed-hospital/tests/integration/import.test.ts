import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { commitBatch, reverseBatch, setDuplicateDecision, uploadFile, validateBatch } from "@/server/services/import";
import { incomeByStream } from "@/server/services/analytics";
import { changeDayStatus } from "@/server/services/daily";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

async function workbook(sheets: Record<string, (string | number | Date | null)[][]>) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const OPD_ROWS: (string | number | Date | null)[][] = [
  ["AED OPD register (test)"],
  ["Date", "UHID", "Pt Name", "Speciality", "N/O", "Amt", "Mode"],
  [new Date(Date.UTC(2026, 0, 5)), "H-1", "Hist One", "Diabetes", "New", 800, "Cash"],
  ["06/01/2026", "H-2", "Hist Two", "Thyroid", "Old", "500", "gpay"],
  ["07/01/2026", "H-3", "Hist Three", "", "Follow up", "₹300", "card"],
  [null, "H-4", "No Date", "Diabetes", "New", 800, "Cash"],
  [new Date(Date.UTC(2026, 0, 5)), "H-1", "Hist One", "Diabetes", "New", 800, "Cash"],
  ["", "", "Total", "", "", 3200, ""],
];

async function uploadAndValidate(buf: Buffer, name = "opd.xlsx") {
  const up = await uploadFile(f.admin, name, buf, "opd");
  const b = up.batches[0];
  const v = await validateBatch(f.admin, b.id, { type: "opd", mapping: b.suggestion.mapping });
  return { up, b, v };
}

describe("Excel import", () => {
  it("detects header row, maps messy columns and validates", async () => {
    const { b, v } = await uploadAndValidate(await workbook({ "OPD Jan": OPD_ROWS }));
    expect(b.headerRow).toBe(2);
    expect(b.suggestion.mapping).toMatchObject({ date: "Date", patientCode: "UHID", specialtyId: "Speciality", visitType: "N/O", netAmount: "Amt", paymentModeId: "Mode" });
    expect(v.summary).toMatchObject({ total: 6, missingDates: 1, totalsRows: 1, duplicates: 1, unknownServices: 1 });
    expect(v.summary.valid + v.summary.warnings).toBe(3);
  });

  it("imports by transaction date; warnings need explicit approval; batch totals are recorded", async () => {
    const { b } = await uploadAndValidate(await workbook({ OPD: OPD_ROWS }));
    const r1 = await commitBatch(f.admin, b.id, { approveWarnings: false });
    expect(r1.imported).toBe(1); // only the fully valid row
    const jan = await incomeByStream({ from: "2026-01-01", to: "2026-01-31" });
    expect(jan.OPD).toBe(800);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(batch.status).toBe("IMPORTED");
    expect(batch.imported).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "IMPORT_COMMIT", entityId: b.id } })).toBe(1);
  });

  it("with approval creates new masters and imports warning rows", async () => {
    const { b } = await uploadAndValidate(await workbook({ OPD: OPD_ROWS }));
    const r = await commitBatch(f.admin, b.id, { approveWarnings: true });
    expect(r.imported).toBe(3);
    expect(await prisma.specialty.findUnique({ where: { name: "Thyroid" } })).not.toBeNull();
    expect((await incomeByStream({ from: "2026-01-01", to: "2026-01-31" })).OPD).toBe(1600);
  });

  it("re-uploading the same file is flagged and every row is a duplicate", async () => {
    const buf = await workbook({ OPD: OPD_ROWS });
    const first = await uploadAndValidate(buf);
    await commitBatch(f.admin, first.b.id, { approveWarnings: true });
    const again = await uploadAndValidate(buf);
    expect(again.b.previouslyImported.length).toBe(1);
    expect(again.v.summary.duplicates).toBe(4);
    expect(again.v.summary.valid).toBe(0);
    await expect(commitBatch(f.admin, again.b.id, { approveWarnings: true })).rejects.toThrow(/Nothing to import/);
  });

  it("only Admin can import duplicates anyway", async () => {
    const buf = await workbook({ OPD: OPD_ROWS });
    const first = await uploadAndValidate(buf);
    await commitBatch(f.admin, first.b.id, { approveWarnings: true });
    const again = await uploadAndValidate(buf);
    const e = await commitBatch(f.accounts, again.b.id, { approveWarnings: true, duplicatePolicy: "import" }).catch((x) => x);
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(403);
    const dup = await prisma.importRecord.findFirstOrThrow({ where: { batchId: again.b.id, status: "DUPLICATE" } });
    await expect(setDuplicateDecision(f.accounts, again.b.id, { rowIds: [dup.id], forceImport: true })).rejects.toThrow();
    await setDuplicateDecision(f.admin, again.b.id, { rowIds: [dup.id], forceImport: true });
    const r = await commitBatch(f.admin, again.b.id, { approveWarnings: true });
    expect(r.imported).toBe(1);
  });

  it("reversal removes the whole batch from figures but keeps rows and audit", async () => {
    const { b } = await uploadAndValidate(await workbook({ OPD: OPD_ROWS }));
    await commitBatch(f.admin, b.id, { approveWarnings: true });
    await expect(reverseBatch(f.accounts, b.id, { reason: "wrong file" })).rejects.toThrow();
    const r = await reverseBatch(f.admin, b.id, { reason: "Wrong month uploaded" });
    expect(r.reversed).toBe(3);
    expect((await incomeByStream({ from: "2026-01-01", to: "2026-01-31" })).OPD).toBe(0);
    expect(await prisma.consultation.count({ where: { status: "REVERSED" } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: "IMPORT_REVERSE" } })).toBe(1);
  });

  it("rows dated on a closed day are rejected", async () => {
    await changeDayStatus(f.admin, "2026-01-05", { action: "review" });
    await prisma.dailyAccount.update({ where: { date: new Date("2026-01-05T00:00:00Z") }, data: { status: "CLOSED" } });
    const { v } = await uploadAndValidate(await workbook({ OPD: OPD_ROWS }));
    expect(v.summary.invalid).toBeGreaterThanOrEqual(3);
  });

  it("multi-sheet workbooks create one batch per sheet with the type guessed from the sheet name", async () => {
    const up = await uploadFile(f.admin, "hospital.xlsx", await workbook({
      "OPD": OPD_ROWS,
      "Lab Register": [["Date", "Test Name", "Qty", "Amount", "Mode"], ["05/01/2026", "ECG", 1, 300, "cash"]],
      "Expenses": [["Date", "Category", "Description", "Amount", "Mode"], ["05/01/2026", "Groceries", "Rice", 900, "cash"]],
    }), "");
    expect(up.batches.map((b) => b.type)).toEqual(["opd", "lab", "expense"]);
    const lab = up.batches[1];
    await validateBatch(f.admin, lab.id, { type: "lab", mapping: lab.suggestion.mapping });
    expect((await commitBatch(f.admin, lab.id, {})).imported).toBe(1);
  });

  it("rejects non-spreadsheet files and users without import permission", async () => {
    await expect(uploadFile(f.admin, "x.xlsx", Buffer.from("not a zip"), "opd")).rejects.toThrow(/Unsupported|corrupted/);
    await expect(uploadFile(f.reception, "x.csv", Buffer.from("a,b\n1,2"), "opd")).rejects.toThrow(/permission/);
  });

  it("CSV import works too", async () => {
    const csv = "Date,Test,Amt,Mode\n05/01/2026,ECG,300,Cash\n05/01/2026,Diabetic Profile,\"1,500\",UPI\n";
    const up = await uploadFile(f.admin, "lab.csv", Buffer.from(csv), "lab");
    const b = up.batches[0];
    const v = await validateBatch(f.admin, b.id, { type: "lab", mapping: b.suggestion.mapping });
    expect(v.summary.valid).toBe(2);
    await commitBatch(f.admin, b.id, {});
    expect((await incomeByStream({ from: "2026-01-05", to: "2026-01-05" })).LAB).toBe(1800);
  });
});

describe("bulk commit paths", () => {
  it("IPD rows (admission + payment) and pharmacy rows with returns/purchases import and reverse correctly", async () => {
    const ipdCsv = "Date,Patient ID,Patient Name,Admission Type,Net Amount,Payment Mode\n05/01/2026,IP-9,In Nine,Sugar Control Plan,40000,Card\n";
    const up1 = await uploadFile(f.admin, "ipd.csv", Buffer.from(ipdCsv), "ipd");
    await validateBatch(f.admin, up1.batches[0].id, { type: "ipd", mapping: up1.batches[0].suggestion.mapping });
    expect((await commitBatch(f.admin, up1.batches[0].id, {})).imported).toBe(1);
    expect(await prisma.ipdTransaction.count({ where: { type: "FINAL_SETTLEMENT", importBatchId: up1.batches[0].id } })).toBe(1);
    expect((await incomeByStream({ from: "2026-01-05", to: "2026-01-05" })).IPD).toBe(40000);

    const phCsv = "Date,Invoice,Sales,Discount,Return,Net Sales,Purchases,Payment Mode\n05/01/2026,PH-1,1000,0,100,900,5000,Cash\n06/01/2026,PH-2,500,0,0,500,0,UPI\n";
    const up2 = await uploadFile(f.admin, "ph.csv", Buffer.from(phCsv), "pharmacy-sale");
    await validateBatch(f.admin, up2.batches[0].id, { type: "pharmacy-sale", mapping: up2.batches[0].suggestion.mapping });
    expect((await commitBatch(f.admin, up2.batches[0].id, {})).imported).toBe(2);
    const inc = await incomeByStream({ from: "2026-01-05", to: "2026-01-06" });
    expect(inc.PHARMACY).toBe(1400); // 1000 − 100 return + 500
    const rec = await prisma.importRecord.findFirstOrThrow({ where: { batchId: up2.batches[0].id, rowNumber: 2 } });
    expect(rec.entityIds).toHaveLength(3); // sale + return + purchase
    const r = await reverseBatch(f.admin, up2.batches[0].id, { reason: "bulk path reversal test" });
    expect(r.counts).toMatchObject({ pharmacySale: 2, pharmacyReturn: 1, pharmacyPurchase: 1 });
    expect((await incomeByStream({ from: "2026-01-05", to: "2026-01-06" })).PHARMACY).toBe(0);
  });
});

describe("OneGlance HMS exports", () => {
  const PREAMBLE = " Period:01/04/2026  - To:30/04/2026\nAdvanced Endocrine and Diabetes Hospital\nAED Hospital; KPHB\nHyderabad - 500072.\n9059600930\nOutpatient Collection Report(01/04/2026 to 30/04/2026)\n\n\n";
  const OPD_CSV =
    PREAMBLE +
    "BillNO,BillDate,BillTime,Patientid,PatientName,DoctorName,Particulars,Quantity,BillAmount,ToatlAmount,Discount,S/C,Refferby,Category,UHID,Area,Admit No\n" +
    '"170834","01-04-2026","08:08 AM","54001","Mrs.Demo Patient A(45)","Dr.Ravi K Muppidi  ","Diabetes Old Consultation","1","600","600","0","0","Dr.Demo Referrer","","","Demo Area"," ",\n' +
    '"170839","01-04-2026","08:58 AM","60001","Mr.Demo Patient B(58)","Dr.Ravi K Muppidi  ","Diabetic new consultation and Registration charges","1","1200","1200","200","0","","","","Demo Area"," ",\n' +
    '"170840","02-04-2026","09:00 AM","60002","Mrs.Demo Patient C(40)","Dr.Ravi K Muppidi  ","Diet Follow up ","1","300","300","0","0","","","",""," ",\n';

  it("converts the Outpatient Collection Report into OPD + Diet batches that import with exact totals", async () => {
    const up = await uploadFile(f.admin, "Outpatient_Collection_Report.csv", Buffer.from(OPD_CSV));
    expect(up.batches.map((b) => [b.type, b.sheetName, b.rows])).toEqual([
      ["opd", "OPD Apr 2026", 2],
      ["diet", "Diet Apr 2026", 1],
    ]);
    expect(up.batches[0].note).toContain("OneGlance");
    expect(up.batches[0].suggestion.missingRequired).toEqual([]);
    for (const b of up.batches) {
      await validateBatch(f.admin, b.id, { type: b.type, mapping: b.suggestion.mapping });
      await commitBatch(f.admin, b.id, { approveWarnings: true });
    }
    const apr = await incomeByStream({ from: "2026-04-01", to: "2026-04-30" });
    expect(apr.OPD).toBe(1600);
    expect(apr.DIET).toBe(300);
    const c = await prisma.consultation.findMany({ orderBy: { reference: "asc" }, include: { specialty: true } });
    expect(c.map((x) => [x.reference, x.visitType, x.specialty?.name])).toEqual([
      ["OP-170834", "OLD", "Diabetes"],
      ["OP-170839", "NEW", "Diabetes"],
    ]);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: up.batches[0].id } });
    expect((batch.options as any).source).toBe("oneglance-opd");
  });
});
