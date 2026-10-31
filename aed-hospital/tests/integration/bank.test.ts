import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import { bankReport, bankReportWorkbook, bookBankPayments, importBankStatements, labBankDuplicates } from "@/server/services/bank";
import { DEFAULT_DEPARTMENTS } from "@/lib/departments";
import { saveDepartmentCost } from "@/server/services/departments";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

const T = (cells: string[]) => cells.join("\t");
const file = (rows: string[][]) =>
  Buffer.from(
    [
      T(["Account Number     :", "_00000012345678901"]),
      T(["Opening Balance as on 1 Oct 2026        :", "1,00,000.00"]),
      T(["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Branch Code", "Debit", "Credit", "Balance", ""]),
      ...rows.map((r) => T([...r, ""])),
    ].join("\n"),
    "latin1",
  );

describe("bank statement check", () => {
  it("imports statements once, compares collections with the bank and lists payments with no core entry", async () => {
    await createTransaction(f.admin, "expense", {
      date: "2026-10-02",
      categoryId: f.ids.groceries,
      description: "Reagents",
      vendor: "Tulasi Scientific",
      amount: 5000,
      paymentModeId: f.ids.BANK,
    });
    const t = await prisma.consultationType.findFirstOrThrow();
    await createTransaction(f.admin, "opd", {
      date: "2026-10-04",
      patientCode: "P1",
      patientName: "DEMO A",
      specialtyId: f.ids.diabetes,
      visitType: "NEW",
      consultationTypeId: t.id,
      grossAmount: 1000,
      discount: 0,
      paymentModeId: f.ids.UPI,
    });
    const oct = file([
      ["4 Oct 2026", "4 Oct 2026", "BY TRANSFER-NEFT*YESB0000001*YESAP1*RESILIENT INNOVA--", "", "1", " ", "980.00", "1,00,980.00"],
      ["5 Oct 2026", "5 Oct 2026", "TO CLEARING-Chq 77 Sess 2 TULASI SCIENTIFIC INS 26--77", "", "1", "5,000.00", " ", "95,980.00"],
      ["6 Oct 2026", "6 Oct 2026", "TO TRANSFER-UPI/DR/6276/GEETHA P/SBIN/geetha@ok/Cons--", "", "1", "7,000.00", " ", "88,980.00"],
      ["7 Oct 2026", "7 Oct 2026", "CHQ TRANSFER-RTGS UTR NO: SBINR1--269017 ADVANCED ENDOCRINE AND DIABETES", "", "1", "50,000.00", " ", "38,980.00"],
      ["8 Oct 2026", "8 Oct 2026", "TO TRANSFER-UPI/DR/6277/GEETHA P/SBIN/geetha@ok/Cons--", "", "1", "7,000.00", " ", "31,980.00"],
      // A failed payment reversed and retried: same date, amount and balance as the first attempt.
      ["9 Oct 2026", "9 Oct 2026", "TO TRANSFER-UPI/DR/111/ADURI SA/UTIB/x@ok/Salar--", "", "1", "1,000.00", " ", "30,980.00"],
      ["9 Oct 2026", "9 Oct 2026", "BY TRANSFER-UPI/REV/111--", "", "1", " ", "1,000.00", "31,980.00"],
      ["9 Oct 2026", "9 Oct 2026", "TO TRANSFER-UPI/DR/222/ADURI SA/UTIB/x@ok/Salar--", "", "1", "1,000.00", " ", "30,980.00"],
    ]);
    await expect(importBankStatements(f.management, [{ name: "oct.xls", buf: oct }])).rejects.toThrow();
    expect(await importBankStatements(f.accounts, [{ name: "oct.xls", buf: oct }])).toMatchObject({ lines: 8, added: 8 });
    expect(await importBankStatements(f.accounts, [{ name: "oct-again.xls", buf: oct }])).toMatchObject({ lines: 8, added: 0 });
    expect(await prisma.bankLine.count()).toBe(8);

    const r = await bankReport(f.management, { from: "2026-10-01", to: "2026-10-31" });
    expect(r.moneyIn).toEqual([{ month: "2026-10", bank: 980, aed: 1000, pharmacy: 0, otherIn: 0 }]);
    expect(r.moneyOut).toEqual([{ month: "2026-10", total: 70000, matched: 5000, notExpense: 50000, unmatched: 15000 }]);
    expect(r.matched).toEqual([{ date: "2026-10-05", party: "TULASI SCIENTIFIC INS", amount: 5000, with: "Expense: Groceries — Tulasi Scientific", withDate: "2026-10-02" }]);
    expect(r.unmatchedByPayee).toEqual([
      { party: "GEETHA P", kind: "UPI_OUT", count: 2, amount: 14000, months: ["2026-10"] },
      { party: "ADURI SA", kind: "UPI_OUT", count: 1, amount: 1000, months: ["2026-10"] },
    ]);
    const x = await bankReportWorkbook(f.management, { from: "2026-10-01", to: "2026-10-31" });
    expect(x.fileName).toBe("AED-bank-check-2026-10-01-to-2026-10-31.xlsx");
    await expect(importBankStatements(f.accounts, [{ name: "bad.xls", buf: Buffer.from("hello") }])).rejects.toThrow(/bad.xls: No transactions/);
    await expect(importBankStatements(f.accounts, [{ name: "review.xlsx", buf: Buffer.from("PK\u0003\u0004xx") }])).rejects.toThrow(/Upload reviewed list/);

    // The payee's unmatched payments become expenses (vendor = payee, bank date, UPI); a second try enters nothing.
    const geetha = r.unmatched.filter((u) => u.party === "GEETHA P").map((u) => u.id);
    await expect(bookBankPayments(f.management, { lineIds: geetha, categoryId: f.ids.groceries })).rejects.toThrow();
    expect(await bookBankPayments(f.admin, { lineIds: geetha, categoryId: f.ids.groceries, description: "Dr. Geetha Priya consultations" })).toEqual({
      booked: 2,
      amount: 14000,
      skipped: 0,
    });
    const made = await prisma.expense.findMany({ where: { vendor: "GEETHA P" }, include: { paymentMode: true }, orderBy: { date: "asc" } });
    expect(made.map((e) => [e.date.toISOString().slice(0, 10), Number(e.amount), e.paymentMode!.reconGroup, e.description])).toEqual([
      ["2026-10-06", 7000, "UPI", "Dr. Geetha Priya consultations — paid by UPI"],
      ["2026-10-08", 7000, "UPI", "Dr. Geetha Priya consultations — paid by UPI"],
    ]);
    expect((await bankReport(f.management, { from: "2026-10-01", to: "2026-10-31" })).unmatchedByPayee.map((x) => x.party)).toEqual(["ADURI SA"]);
    expect(await bookBankPayments(f.admin, { lineIds: geetha, categoryId: f.ids.groceries })).toEqual({ booked: 0, amount: 0, skipped: 2 });
    // A closed day refuses the entry unless the Admin allows closed days.
    const aduri = r.unmatched.filter((u) => u.party === "ADURI SA").map((u) => u.id);
    await prisma.dailyAccount.upsert({
      where: { date: new Date("2026-10-09T00:00:00Z") },
      create: { date: new Date("2026-10-09T00:00:00Z"), status: "CLOSED" },
      update: { status: "CLOSED" },
    });
    await expect(bookBankPayments(f.admin, { lineIds: aduri, categoryId: f.ids.groceries })).rejects.toThrow();
    expect(await bookBankPayments(f.admin, { lineIds: aduri, categoryId: f.ids.groceries, intoClosedDays: true })).toMatchObject({ booked: 1 });
  });

  it("finds lab entries from the bank whose bills were already entered, and removes only those", async () => {
    for (const [i, d] of DEFAULT_DEPARTMENTS.entries()) await prisma.serviceDepartment.create({ data: { ...d, sortOrder: (i + 1) * 10 } });
    const lab = (await prisma.serviceDepartment.findUniqueOrThrow({ where: { name: "Laboratory" } })).id;
    for (const [label, matchText] of [
      ["Reagents — SN Diagnostics", "SN Diagnostic"],
      ["Reagents — Tulasi", "Tulasi Scientific"],
      ["Reagents — Alchemy", "Alchemy Diagnostic"],
    ])
      await saveDepartmentCost(f.admin, null, { departmentId: lab, label, kind: "MATCH", matchText, fromMonth: "2026-01" });
    const bill = (date: string, description: string, vendor: string | null, amount: number) =>
      createTransaction(f.admin, "expense", { date, categoryId: f.ids.groceries, description, vendor, amount, paymentModeId: f.ids.BANK });
    await bill("2026-01-05", "Reagents bill 101", "S N Diagnostics", 60000);
    await bill("2026-01-12", "Reagents bill 102", "S N Diagnostics", 40000);
    await bill("2026-05-03", "Lab reagents purchase", null, 30000);
    await bill("2026-05-08", "Lab reagents purchase", null, 20000);
    await bill("2026-06-01", "Kits", "Alchemy Diagnostics", 70000);
    await bill("2026-08-02", "Reagents invoice", "S N Diagnostics", 25000); // invoice dated after the cheque
    const st = file([
      ["20 Jan 2026", "20 Jan 2026", "TO CLEARING-Chq 1 Sess 2 S N DIAGNOSTICS 26--1", "", "1", "1,00,000.00", " ", "0.00"],
      ["15 May 2026", "15 May 2026", "TO CLEARING-Chq 2 Sess 2 TULASI SCIENTIFIC INS 26--2", "", "1", "50,000.00", " ", "-50,000.00"],
      ["10 Jun 2026", "10 Jun 2026", "TO CLEARING-Chq 3 Sess 2 ALCHEMY DIAGNOSTICS D 26--3", "", "1", "45,000.00", " ", "-95,000.00"],
      ["10 Jul 2026", "10 Jul 2026", "TO CLEARING-Chq 4 Sess 2 S N DIAGNOSTICS 26--4", "", "1", "25,000.00", " ", "-1,20,000.00"],
    ]);
    await importBankStatements(f.admin, [{ name: "s.xls", buf: st }]);
    const lines = await prisma.bankLine.findMany();
    // Entered from the bank: none of them has a same-amount bill, so all four go in (the case to undo).
    expect(await bookBankPayments(f.admin, { lineIds: lines.map((l) => l.id), categoryId: f.ids.groceries, description: "" })).toMatchObject({ booked: 4 });
    const chk = await labBankDuplicates(f.admin);
    expect(chk.results.map((r) => [r.date, r.status])).toEqual([
      ["2026-01-20", "duplicate"], // 60,000 + 40,000 named bills
      ["2026-05-15", "duplicate"], // 30,000 + 20,000 unnamed lab bills
      ["2026-06-10", "probable"], // Alchemy has a 70,000 bill, no exact total
      ["2026-07-10", "duplicate"], // invoice entered 23 days after the cheque
    ]);
    expect(chk.summary).toMatchObject({ duplicate: { count: 3, amount: 175000 }, probable: { count: 1, amount: 45000 }, keep: { count: 0 } });
    expect((await labBankDuplicates(f.admin, { apply: true })).summary.removed).toBe(3);
    const left = await prisma.expense.findMany({ where: { billNumber: { startsWith: "BANK-" }, status: "ACTIVE" } });
    expect(left.map((e) => Number(e.amount))).toEqual([45000]);
    expect(await prisma.auditLog.count({ where: { action: "VOID", entityType: "Expense" } })).toBe(3);
  });
});
