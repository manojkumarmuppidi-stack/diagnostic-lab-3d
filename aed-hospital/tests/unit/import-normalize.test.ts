import { describe, expect, it } from "vitest";
import { normalizeRow, parsePlaceholder, type MasterCtx } from "@/lib/import/normalize";

const ctx: MasterCtx = {
  specialties: [{ id: "sp-gen", name: "General" }, { id: "sp-dia", name: "Diabetes" }],
  doctors: [{ id: "dr-1", name: "Dr. Demo Anand" }],
  dieticians: [],
  consultationTypes: [{ id: "ct-1", name: "Consultation" }],
  admissionTypes: [{ id: "at-scp", name: "Sugar Control Plan" }, { id: "at-oth", name: "Other" }],
  ipdPackages: [],
  investigations: [{ id: "inv-ecg", name: "ECG", rate: 300 }, { id: "inv-dp", name: "Diabetic Profile", rate: 1500 }],
  dietServices: [{ id: "ds-1", name: "Diet Counselling" }],
  departments: [],
  categories: [{ id: "cat-gro", name: "Groceries", group: "HOSPITAL" }, { id: "cat-oth", name: "Other", group: "OTHER" }],
  subcategories: [{ id: "sub-veg", name: "Vegetables", parentId: "cat-gro" }],
  paymentModes: [
    { id: "pm-cash", code: "CASH", name: "Cash", reconGroup: "CASH" },
    { id: "pm-upi", code: "UPI", name: "UPI", reconGroup: "UPI" },
    { id: "pm-oth", code: "OTHER", name: "Other", reconGroup: "OTHER" },
  ],
  today: "2026-09-25",
};

describe("OPD rows", () => {
  const map = { date: "Date", patientName: "Name", specialtyId: "Spec", visitType: "NO", grossAmount: "Amount", discount: "Disc", netAmount: "Net", paymentModeId: "Mode" };
  it("valid row with discount", () => {
    const r = normalizeRow("opd", { Date: "01/09/2026", Name: "A", Spec: "Diabetes", NO: "New", Amount: 800, Disc: 100, Net: 700, Mode: "cash" }, map, ctx);
    expect(r.errors).toEqual([]);
    expect(r.input).toMatchObject({ date: "2026-09-01", specialtyId: "sp-dia", visitType: "NEW", grossAmount: 800, discount: 100, paymentModeId: "pm-cash" });
    expect(r.amount).toBe(700);
  });
  it("net wins when amount − discount ≠ net (warning)", () => {
    const r = normalizeRow("opd", { Date: "01/09/2026", Spec: "Diabetes", NO: "Old", Amount: 800, Disc: 0, Net: 700, Mode: "UPI" }, map, ctx);
    expect(r.warnings.join()).toMatch(/kept Net/);
    expect(r.input).toMatchObject({ grossAmount: 700, discount: 0 });
  });
  it("missing specialty falls back to General with a warning", () => {
    const r = normalizeRow("opd", { Date: "01/09/2026", NO: "Old", Net: 500, Mode: "cash" }, map, ctx);
    expect(r.input?.specialtyId).toBe("sp-gen");
    expect(r.warnings.join()).toMatch(/Specialty missing/);
  });
  it("fixed values from the mapping (e.g. every row is OLD)", () => {
    const r = normalizeRow("opd", { Date: "01/09/2026", Net: 500, Mode: "cash" }, { ...map, visitType: "=Old", specialtyId: "=Diabetes" }, ctx);
    expect(r.input).toMatchObject({ visitType: "OLD", specialtyId: "sp-dia" });
  });
  it("missing date / missing amount / negative amount are errors", () => {
    expect(normalizeRow("opd", { NO: "New", Net: 1, Mode: "cash" }, map, ctx).flags).toContain("missingDate");
    expect(normalizeRow("opd", { Date: "01/09/2026", NO: "New", Mode: "cash" }, map, ctx).flags).toContain("missingAmount");
    const neg = normalizeRow("opd", { Date: "01/09/2026", NO: "New", Net: -100, Mode: "cash" }, map, ctx);
    expect(neg.flags).toContain("negative");
    expect(neg.input).toBeNull();
  });
  it("totals rows are rejected to prevent double counting", () => {
    const r = normalizeRow("opd", { Date: null, Name: "Grand Total", Net: 99999 }, map, ctx);
    expect(r.flags).toContain("totalsRow");
    expect(r.input).toBeNull();
  });
});

describe("lab rows", () => {
  const map = { date: "D", investigationId: "Test", quantity: "Q", rate: null, discount: null, netAmount: "Amt", paymentModeId: "M" };
  it("rate is derived from net ÷ qty when no rate column", () => {
    const r = normalizeRow("lab", { D: "2026-09-01", Test: "ECG", Q: 2, Amt: 500, M: "cash" }, map, ctx);
    expect(r.input).toMatchObject({ investigationId: "inv-ecg", quantity: 2, rate: 250, discount: 0 });
    expect(r.amount).toBe(500);
  });
  it("unknown investigation becomes a placeholder (new master) with a flag", () => {
    const r = normalizeRow("lab", { D: "2026-09-01", Test: "Vitamin D", Amt: 1200, M: "cash" }, map, ctx);
    expect(r.flags).toContain("unknownService");
    expect(parsePlaceholder(r.input?.investigationId)).toMatchObject({ type: "investigations", name: "Vitamin D" });
  });
});

describe("IPD rows", () => {
  it("historical admissions without payment columns are treated as settled", () => {
    const r = normalizeRow("ipd", { D: "2026-09-01", T: "Sugar Control Plan", Net: 40000, M: "card" }, { admissionDate: "D", admissionTypeId: "T", netAmount: "Net", paymentModeId: "M" }, ctx);
    expect(r.input).toMatchObject({ admissionTypeId: "at-scp", grossAmount: 40000, initialPaymentType: "FINAL_SETTLEMENT", initialPaymentAmount: 40000 });
  });
});

describe("pharmacy rows", () => {
  it("sales row with return and purchase creates separate records", () => {
    const r = normalizeRow(
      "pharmacy-sale",
      { D: "2026-09-01", Inv: "P1", S: 1000, Disc: 50, R: 100, N: 850, P: 5000, M: "cash" },
      { date: "D", invoiceNo: "Inv", grossAmount: "S", discount: "Disc", returnAmount: "R", netAmount: "N", purchaseAmount: "P", paymentModeId: "M" },
      ctx,
    );
    expect(r.errors).toEqual([]);
    expect(r.module).toBe("pharmacy-sale");
    expect(r.input).toMatchObject({ grossAmount: 1000, discount: 50 });
    expect(r.extras.map((e) => e.module)).toEqual(["pharmacy-return", "pharmacy-purchase"]);
    expect(r.warnings).toEqual([]);
  });
});

describe("combined formats", () => {
  const map = { stream: "S", date: "D", service: "Svc", netAmount: "Amt", paymentModeId: "M", visitType: "NO" };
  it("routes rows by stream", () => {
    expect(normalizeRow("combined-income", { S: "LAB", D: "2026-09-01", Svc: "ECG", Amt: 300, M: "cash" }, map, ctx).module).toBe("lab");
    expect(normalizeRow("combined-income", { S: "OPD", D: "2026-09-01", Svc: "Diabetes", NO: "New", Amt: 800, M: "cash" }, map, ctx).module).toBe("opd");
    expect(normalizeRow("combined-income", { S: "Other", D: "2026-09-01", Svc: "Rent", Amt: 5000, M: "cash" }, map, ctx).input).toMatchObject({ source: "Rent", amount: 5000 });
    expect(normalizeRow("combined-income", { S: "Canteen", D: "2026-09-01", Amt: 1, M: "cash" }, map, ctx).errors.join()).toMatch(/Unknown income stream/);
  });
  it("combined expenditure separates pharmacy purchases from expenses", () => {
    const m = { expenseType: "T", date: "D", category: "C", subcategory: "Sub", description: "Desc", vendor: "V", amount: "A", paymentModeId: "M" };
    const p = normalizeRow("combined-expense", { T: "Pharmacy Purchase", D: "2026-09-01", V: "Dist", A: 38000, M: "neft" }, m, ctx);
    expect(p.module).toBe("pharmacy-purchase");
    const e = normalizeRow("combined-expense", { T: "Expense", D: "2026-09-01", C: "Groceries", Sub: "Vegetables", Desc: "Veg", A: 1200, M: "cash" }, m, ctx);
    expect(e.input).toMatchObject({ categoryId: "cat-gro", subcategoryId: "sub-veg" });
  });
});
