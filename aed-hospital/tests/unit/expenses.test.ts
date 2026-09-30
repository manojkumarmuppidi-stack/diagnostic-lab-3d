import { describe, expect, it } from "vitest";
import { searchHeads, suggestModeCode, monthLabel } from "@/lib/expenses";
import { classifyExpense, vendorFrom } from "@/lib/import/expense-category";
import { convertHmsSheet, detectHmsReport, fixLedgerDates, type RawSheet } from "@/lib/import/hms";

describe("payment mode suggestion", () => {
  it("below ₹3,000 cash, above ₹1,00,000 online, otherwise card", () => {
    expect(suggestModeCode(2999)).toBe("CASH");
    expect(suggestModeCode(3000)).toBe("CARD");
    expect(suggestModeCode(100000)).toBe("CARD");
    expect(suggestModeCode(100001)).toBe("BANK");
    expect(suggestModeCode(0)).toBeNull();
    expect(suggestModeCode(null)).toBeNull();
  });
});

describe("expense head search", () => {
  const heads = [
    { id: "1", name: "Rent – Cash", keywords: "rent,building rent" },
    { id: "2", name: "Rent – Online", keywords: "rent,neft" },
    { id: "3", name: "Electricity bill", keywords: "electricity,current,power" },
    { id: "4", name: "Security", keywords: "security,watchman,salary" },
    { id: "5", name: "Staff salaries", keywords: "salary,wages" },
    { id: "6", name: "Old head", keywords: "rent", active: false },
  ];
  it("one word finds the heads, inactive ones hidden", () => {
    expect(searchHeads(heads, "rent").map((h) => h.id)).toEqual(["1", "2"]);
    expect(searchHeads(heads, "current").map((h) => h.id)).toEqual(["3"]);
    expect(searchHeads(heads, "elec").map((h) => h.id)).toEqual(["3"]);
    expect(searchHeads(heads, "SALARY").map((h) => h.id).sort()).toEqual(["4", "5"]);
    expect(searchHeads(heads, "")).toEqual([]);
    expect(searchHeads(heads, "urren").map((h) => h.id)).toEqual(["3"]); // substring only when nothing better
  });
  it("labels months", () => expect(monthLabel("2026-09")).toBe("Sep 2026"));
});

describe("expense classification from descriptions", () => {
  it.each([
    ["Stock (S.N.Diagnostics)", "Medical supplies", "Lab reagents"],
    ["Electicity Bill", "Electricity", undefined],
    ["Sunday Duty (Demo)", "Salaries & Wages", "Support staff"],
    ["OT technician charges", "Salaries & Wages", "OT technicians"],
    ["Watchman salary", "Salaries & Wages", "Security"],
    ["Milk", "Groceries", "Milk & Dairy"],
    ["Water Bottles", "Water", "Drinking water cans"],
    ["Patient Refund", "Patient refunds", undefined],
    ["OP referral", "Referral fees", undefined],
    ["JJ Wellness", "MOU partners", "Revenue share"],
    ["Saritha", "Salaries & Wages", "Incentives & bonus"],
    ["SA", "Salaries & Wages", "Incentives & bonus"],
    ["Performance bonus", "Salaries & Wages", "Incentives & bonus"],
    ["Something unheard of", "Other", undefined],
  ])("%s → %s / %s", (desc, category, sub) => {
    const c = classifyExpense(desc);
    expect(c.category).toBe(category);
    expect(c.subcategory).toBe(sub);
  });
  it("tags the wellness partner's revenue share to the Wellness department", () => {
    expect(classifyExpense("JJ Wellness").department).toBe("Wellness");
    expect(classifyExpense("Milk").department).toBeUndefined();
  });
  it("takes the payee from brackets", () => {
    expect(vendorFrom("Stock (S.N.Diagnostics)")).toBe("S.N.Diagnostics");
    expect(vendorFrom("Tiffins")).toBeUndefined();
  });
});

describe("cash book dates", () => {
  it("resolves Excel's month-first readings from neighbouring unambiguous dates", () => {
    // Written 29/01, 01/02, 13/02, 05/02, 20/02 — Excel read 01/02 as 2 Jan and 05/02 as 2 May.
    const { dates, swapped } = fixLedgerDates(["2026-01-29", "2026-01-02", "2026-02-13", "2026-05-02", "20/02/2026", ""]);
    expect(dates).toEqual(["2026-01-29", "2026-02-01", "2026-02-13", "2026-02-05", "2026-02-20", ""]);
    expect(swapped).toBe(2);
  });
  it("keeps readings that already fit", () => {
    expect(fixLedgerDates(["2026-03-14", "2026-03-02", "2026-03-15"]).dates).toEqual(["2026-03-14", "2026-03-02", "2026-03-15"]);
  });
});

describe("cash book conversion", () => {
  const sheet: RawSheet = {
    name: "Sheet1",
    headerRow: 1,
    headers: ["Column 1", "CHEQUE NO.", "DESCRIPTION", "LEDGER", "Debit", "Credit", "Balance"],
    rows: [
      { rowNumber: 2, values: { "Column 1": "2026-01-29", DESCRIPTION: "Milk", Debit: 450, Credit: null } },
      { rowNumber: 3, values: { "Column 1": "2026-01-30", DESCRIPTION: "Electricity bill", Debit: 45000, Credit: null } },
      { rowNumber: 4, values: { "Column 1": "2026-01-30", DESCRIPTION: "Cash from bank", Debit: null, Credit: 50000 } },
      { rowNumber: 5, values: { "Column 1": "2026-01-31", DESCRIPTION: "Vegetables", Debit: null, Credit: null } },
      { rowNumber: 6, values: { "Column 1": "2026-02-03", DESCRIPTION: "Rent", Debit: 150000, Credit: null } },
      { rowNumber: 7, values: { "Column 1": "2026-02-04", DESCRIPTION: "Stock (Vijaya Pharma)", Debit: 12000, Credit: null } },
    ],
  };
  it("is detected and split by month; credits and blank lines skipped; mode estimated", () => {
    expect(detectHmsReport(sheet.headers)).toBe("cash-book");
    const out = convertHmsSheet(sheet)!;
    expect(out.map((s) => [s.type, s.name, s.rows.length])).toEqual([
      ["expense", "Cash book Jan 2026", 2],
      ["expense", "Cash book Feb 2026", 1],
      // Pharmacy supplier: invoices are already expenses, so this is a supplier payment.
      ["supplier-payments", "Cash book supplier payments Feb 2026", 1],
    ]);
    expect(out[2].rows[0].values).toMatchObject({ Date: "04-02-2026", Supplier: "Vijaya Pharma", "Amount paid": 12000 });
    expect(out[0].rows.map((r) => [r.values.Date, r.values.Category, r.values["Payment Mode"]])).toEqual([
      ["29-01-2026", "Groceries", "Cash"],
      ["30-01-2026", "Electricity", "Card"],
    ]);
    expect(out[1].rows[0].values["Payment Mode"]).toBe("Bank Transfer");
    expect(out[0].note).toMatch(/1 cash-received lines skipped; 1 lines without an amount skipped/);
  });
});
