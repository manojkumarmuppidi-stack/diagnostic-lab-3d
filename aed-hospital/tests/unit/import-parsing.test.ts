import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, parsePaymentMode, parseVisitType, parseStream, excelSerialToISO } from "@/lib/import/values";
import { suggestMapping } from "@/lib/import/mapping";
import { matchByName } from "@/lib/import/text";
import { fingerprintKey } from "@/lib/import/fingerprint";
import { importFieldsFor } from "@/lib/modules";
import { parseCsv } from "@/server/spreadsheet";

const modes = [
  { id: "c", code: "CASH", name: "Cash", reconGroup: "CASH" as const },
  { id: "u", code: "UPI", name: "UPI", reconGroup: "UPI" as const },
  { id: "k", code: "CARD", name: "Card", reconGroup: "CARD" as const },
  { id: "b", code: "BANK", name: "Bank Transfer", reconGroup: "BANK" as const },
  { id: "o", code: "OTHER", name: "Other", reconGroup: "OTHER" as const },
];

describe("dates", () => {
  it.each([
    ["01/09/2026", "2026-09-01"],
    ["1-9-26", "2026-09-01"],
    ["2026-09-01", "2026-09-01"],
    ["01.09.2026", "2026-09-01"],
    ["01-Sep-2026", "2026-09-01"],
    ["1 September 2026", "2026-09-01"],
    ["Sep 1, 2026", "2026-09-01"],
    ["2026-09-01T00:00:00.000Z", "2026-09-01"],
  ])("%s → %s", (input, out) => {
    expect(parseDate(input)).toMatchObject({ ok: true, value: out });
  });
  it("Excel serial numbers and Date objects", () => {
    expect(excelSerialToISO(46266)).toBe("2026-09-01");
    expect(parseDate(46266)).toMatchObject({ ok: true, value: "2026-09-01" });
    expect(parseDate(new Date("2026-08-31T18:30:00Z"))).toMatchObject({ ok: true, value: "2026-09-01" });
  });
  it("month-first only when day-first is impossible, with a warning", () => {
    const r = parseDate("09/25/2026");
    expect(r).toMatchObject({ ok: true, value: "2026-09-25" });
    expect(r.ok && r.warning).toBeTruthy();
  });
  it("missing, invalid and future dates are errors", () => {
    expect(parseDate("")).toMatchObject({ ok: false, error: "Missing date" });
    expect(parseDate(null).ok).toBe(false);
    expect(parseDate("31/02/2026").ok).toBe(false);
    expect(parseDate("2026-12-01", { max: "2026-09-25" }).ok).toBe(false);
  });
});

describe("amounts", () => {
  it.each([
    ["1,25,000.50", 125000.5],
    ["₹ 1,500", 1500],
    ["Rs.300/-", 300],
    ["(250)", -250],
    ["-40", -40],
    [799.999, 800],
  ])("%s → %s", (input, out) => {
    expect(parseAmount(input)).toEqual({ ok: true, value: out });
  });
  it("blank is null, garbage is an error", () => {
    expect(parseAmount("")).toEqual({ ok: true, value: null });
    expect(parseAmount("abc").ok).toBe(false);
  });
});

describe("payment modes & visit types", () => {
  it("maps common Indian payment words", () => {
    expect(parsePaymentMode("gpay", modes)).toMatchObject({ ok: true, value: { code: "UPI" } });
    expect(parsePaymentMode("PhonePe", modes)).toMatchObject({ ok: true, value: { code: "UPI" } });
    expect(parsePaymentMode("NEFT", modes)).toMatchObject({ ok: true, value: { code: "BANK" } });
    expect(parsePaymentMode("Debit Card", modes)).toMatchObject({ ok: true, value: { code: "CARD" } });
    expect(parsePaymentMode("cash", modes)).toMatchObject({ ok: true, value: { code: "CASH" } });
  });
  it("records cheque, GPay and PhonePe exactly when those modes exist", () => {
    const more = [
      ...modes,
      { id: "g", code: "GPAY", name: "GPay", reconGroup: "UPI" as const },
      { id: "p", code: "PHONEPE", name: "PhonePe", reconGroup: "UPI" as const },
      { id: "c", code: "CHEQUE", name: "Cheque", reconGroup: "BANK" as const },
    ];
    expect(parsePaymentMode("Google Pay", more)).toMatchObject({ ok: true, value: { code: "GPAY" } });
    expect(parsePaymentMode("Phone Pe", more)).toMatchObject({ ok: true, value: { code: "PHONEPE" } });
    expect(parsePaymentMode("chq", more)).toMatchObject({ ok: true, value: { code: "CHEQUE" } });
    expect(parsePaymentMode("paytm", more)).toMatchObject({ ok: true, value: { code: "UPI" } });
    expect(parsePaymentMode("NEFT", more)).toMatchObject({ ok: true, value: { code: "BANK" } });
  });
  it("unknown / blank modes become Other with a warning", () => {
    const r = parsePaymentMode("crypto", modes);
    expect(r).toMatchObject({ ok: true, value: { code: "OTHER" } });
    expect(r.ok && r.warning).toMatch(/Invalid payment mode/);
    expect(parsePaymentMode("", modes).ok && parsePaymentMode("", modes)).toBeTruthy();
  });
  it("consultation classification new/old", () => {
    expect(parseVisitType("New")).toEqual({ ok: true, value: "NEW" });
    expect(parseVisitType("F/U")).toEqual({ ok: true, value: "OLD" });
    expect(parseVisitType("Review")).toEqual({ ok: true, value: "OLD" });
    expect(parseVisitType("maybe").ok).toBe(false);
  });
  it("income stream names", () => {
    expect(parseStream("Laboratory")).toEqual({ ok: true, value: "LAB" });
    expect(parseStream("Consultation")).toEqual({ ok: true, value: "OPD" });
  });
});

describe("smart column mapping", () => {
  it("maps messy headers to fields (spec examples)", () => {
    const s = suggestMapping(["Dt", "Pt Name", "UHID", "Consult", "Doctor", "N/O", "Amt", "Mode"], importFieldsFor("opd"));
    expect(s.mapping.date).toBe("Dt");
    expect(s.mapping.patientName).toBe("Pt Name");
    expect(s.mapping.patientCode).toBe("UHID");
    expect(s.mapping.consultationTypeId).toBe("Consult");
    expect(s.mapping.doctorId).toBe("Doctor");
    expect(s.mapping.visitType).toBe("N/O");
    // A single money column is the amount collected → Net Amount.
    expect(s.mapping.netAmount).toBe("Amt");
    expect(s.mapping.grossAmount).toBeNull();
    expect(s.mapping.paymentModeId).toBe("Mode");
  });
  it("Test Name → Investigation; Amount + Net Amount keep gross/net apart", () => {
    const s = suggestMapping(["Date", "Test Name", "Qty", "Rate", "Discount", "Net Amount", "Payment Mode"], importFieldsFor("lab"));
    expect(s.mapping.investigationId).toBe("Test Name");
    expect(s.mapping.netAmount).toBe("Net Amount");
    expect(s.mapping.rate).toBe("Rate");
    expect(s.missingRequired).toEqual([]);
  });
  it("templates map 1:1", () => {
    const s = suggestMapping(["Date", "Department", "Category", "Subcategory", "Description", "Vendor", "Bill Number", "Amount", "Payment Mode", "Remarks"], importFieldsFor("expense"));
    expect(Object.values(s.mapping).filter(Boolean)).toHaveLength(10);
  });
  it("reports missing required fields", () => {
    expect(suggestMapping(["Foo", "Bar"], importFieldsFor("opd")).missingRequired).toContain("Date");
  });
});

describe("master name matching", () => {
  const items = [
    { id: "1", name: "Diabetic Profile" },
    { id: "2", name: "Mini Diabetic Profile" },
    { id: "3", name: "USG Thyroid" },
    { id: "4", name: "Dr. Demo Anand" },
  ];
  it("exact, case/punctuation-insensitive", () => {
    expect(matchByName("diabetic  profile", items)).toMatchObject({ item: { id: "1" }, exact: true });
    expect(matchByName("usg-thyroid", items)).toMatchObject({ item: { id: "3" }, exact: true });
    expect(matchByName("Demo Anand", items)).toMatchObject({ item: { id: "4" }, exact: true });
  });
  it("abbreviations and typos match with exact=false", () => {
    expect(matchByName("Diab Profile", items)).toMatchObject({ item: { id: "1" }, exact: false });
    expect(matchByName("Diabetic Profle", items)).toMatchObject({ item: { id: "1" }, exact: false });
  });
  it("unrelated names do not match", () => {
    expect(matchByName("Vitamin D", items)).toBeNull();
  });
});

describe("duplicate fingerprint", () => {
  it("is stable across formatting differences", () => {
    const a = fingerprintKey({ module: "lab", date: "2026-09-01", patient: "IMP-001", reference: null, service: "x", amount: 1500 });
    const b = fingerprintKey({ module: "lab", date: "2026-09-01", patient: "imp 001", reference: "", service: "x", amount: 1500.0 });
    expect(a).toBe(b);
  });
  it("differs when amount or date differs", () => {
    const a = fingerprintKey({ module: "lab", date: "2026-09-01", patient: "P", service: "x", amount: 1500 });
    expect(fingerprintKey({ module: "lab", date: "2026-09-02", patient: "P", service: "x", amount: 1500 })).not.toBe(a);
    expect(fingerprintKey({ module: "lab", date: "2026-09-01", patient: "P", service: "x", amount: 1400 })).not.toBe(a);
  });
});

describe("CSV parser", () => {
  it("handles quotes, embedded commas, CRLF and BOM", () => {
    const rows = parseCsv('﻿Date,Name,Amt\r\n01/09/2026,"Rao, K",\"1,500\"\r\n');
    expect(rows[0]).toEqual(["Date", "Name", "Amt"]);
    expect(rows[1]).toEqual(["01/09/2026", "Rao, K", "1,500"]);
  });
  it("detects semicolon delimiters", () => {
    expect(parseCsv("a;b\n1;2")[1]).toEqual(["1", "2"]);
  });
});
