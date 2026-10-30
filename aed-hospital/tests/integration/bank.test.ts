import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import { bankReport, bankReportWorkbook, importBankStatements } from "@/server/services/bank";
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
  });
});
