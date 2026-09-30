import { describe, expect, it } from "vitest";
import { cleanDoctor, cleanPatient, convertHmsSheet, detectHmsReport, HmsReportError, specialtyFor, visitTypeFor, type RawSheet } from "@/lib/import/hms";
import { matchByName, meaningDiffers } from "@/lib/import/text";

function sheet(headers: string[], rows: (string | number)[][]): RawSheet {
  return { name: "CSV", headerRow: 9, headers, rows: rows.map((r, i) => ({ rowNumber: 10 + i, values: Object.fromEntries(headers.map((h, j) => [h, r[j] ?? null])) })) };
}

const OPD_H = ["BillNO", "BillDate", "BillTime", "Patientid", "PatientName", "DoctorName", "Particulars", "Quantity", "BillAmount", "ToatlAmount", "Discount", "S/C", "Refferby", "Category", "UHID", "Area", "Admit No"];
const LAB_H = ["Bill NO", "Bill Date", "BillTime", "Patientid", "PatientName", "Doctor", "Particulars", "Accountgroup", "Amount", "Itemdiscount", "NetAmount", "UHID", "Services", "category", "Area"];
const PH_H = ["Bill Date", "Total Amount", "Discount", "Bill Amount", "Paid Amount", "DueAmount", "Pending Collected", "Refund Amount", "Net Revenue", "ReceivedDate", "paidvalue", "Pstatus", "Cash", "Card", "Cheque", "Online", "Adjust deposit", "OneGlance Wallet", "Phone Pay", "G Pay"];

describe("OneGlance report detection", () => {
  it("recognises each report by its header row", () => {
    expect(detectHmsReport(OPD_H)).toBe("oneglance-opd");
    expect(detectHmsReport(LAB_H)).toBe("oneglance-lab-items");
    expect(detectHmsReport(PH_H)).toBe("oneglance-pharmacy-daily");
    expect(detectHmsReport(["Date", "Amount", "Payment Mode"])).toBeNull();
  });
  it("rejects Lab Bill Collection with guidance (no test names)", () => {
    const h = ["BillNo", "Bill Date", "Patientid", "RefLab", "RefferedBY", "BillAmount", "PaidAmount", "Cash"];
    expect(() => convertHmsSheet(sheet(h, [["1", "30-09-2026", "5", "", "Dr X", "100", "100", "100"]]))).toThrow(HmsReportError);
  });
});

describe("name cleaning", () => {
  it("normalises doctor names", () => {
    expect(cleanDoctor("DR.Ravi K Muppidi  ")).toBe("Dr. Ravi K Muppidi");
    expect(cleanDoctor("DR . RAVI KUMAR M")).toBe("Dr. Ravi Kumar M");
    expect(cleanDoctor("Dr.Dr.Elizabeth Moses")).toBe("Dr. Elizabeth Moses");
    expect(cleanDoctor("")).toBe("");
  });
  it("strips the age suffix from patient names", () => {
    expect(cleanPatient("Mrs.DEMO B(49)")).toBe("Mrs.DEMO B");
    expect(cleanPatient("Mr.Demo K+(41)")).toBe("Mr.Demo K");
  });
});

describe("consultation classification", () => {
  it("reads New/Old and specialty from the tariff name", () => {
    expect(visitTypeFor("Thyroid new consultation and Registration charges")).toBe("New");
    expect(visitTypeFor("Diabetes Old Consultation")).toBe("Old");
    expect(visitTypeFor("Diet Follow up")).toBe("Old");
    expect(visitTypeFor("Sugar Control Plan")).toBeNull();
    expect(specialtyFor("Old Thyroid & Diabetes Consultation")).toBe("Diabetes & Thyroid");
    expect(specialtyFor("Gynec Conultation Old")).toBe("Gynaecology");
    expect(specialtyFor("Sugar Control Plan")).toBe("Diabetes");
    expect(specialtyFor("General Surgeon Consultation")).toBe("General Surgery");
  });
});

describe("OPD conversion", () => {
  const rows = [
    ["100", "01-04-2026", "08:00 AM", "500", "Mr.Old One(60)", "Dr.Ravi K Muppidi", "Diabetes Old Consultation", "1", "600", "600", "0", "0", "OLD PATIENT", "", "", "KPHB", ""],
    ["101", "01-04-2026", "08:10 AM", "900", "Mrs.New Two(40)", "Dr.Ravi K Muppidi", "Thyroid new consultation and Registration charges", "1", "1200", "1200", "200", "0", "Google", "", "", "Miyapur", ""],
    ["102", "02-05-2026", "09:00 AM", "950", "Mr.Plan Three(50)", "Dr.Ravi K Muppidi", "Sugar Control Plan", "1", "2000", "2000", "0", "0", "", "", "", "", ""],
    ["103", "02-05-2026", "09:30 AM", "500", "Mr.Old One(60)", "Dr.Ravi K Muppidi", "Physio Consultation", "1", "500", "500", "0", "0", "", "", "", "", ""],
    ["104", "03-05-2026", "10:00 AM", "600", "Mr.Diet Four(30)", "Dr.Ravi K Muppidi", "Diet Follow up ", "1", "300", "300", "0", "0", "", "", "", "", ""],
  ];
  const out = convertHmsSheet(sheet(OPD_H, rows))!;
  const byName = Object.fromEntries(out.map((s) => [s.name, s]));

  it("splits by month and moves diet follow-ups to Diet", () => {
    expect(out.map((s) => `${s.type}:${s.name}:${s.rows.length}`)).toEqual(["opd:OPD Apr 2026:2", "opd:OPD May 2026:2", "diet:Diet May 2026:1"]);
  });
  it("fills template columns with net = total − discount and payment mode Other", () => {
    const v = byName["OPD Apr 2026"].rows[1].values;
    expect(v).toMatchObject({ Date: "01-04-2026", "Patient ID": "900", "Patient Name": "Mrs.New Two", Doctor: "Dr. Ravi K Muppidi", Specialty: "Thyroid", "New/Old": "New", Amount: 1200, Discount: 200, "Net Amount": 1000, "Payment Mode": "Other", Reference: "OP-101" });
    expect(String(v.Remarks)).toContain("Ref: Google");
  });
  it("infers New/Old when the name does not say: new registration numbers on a first visit are New", () => {
    const may = byName["OPD May 2026"].rows.map((r) => r.values);
    expect(may.find((v) => v.Reference === "OP-102")!["New/Old"]).toBe("New"); // id 950 ≥ first new id 900, first visit
    expect(may.find((v) => v.Reference === "OP-103")!["New/Old"]).toBe("Old"); // seen before
  });
});

describe("lab item conversion", () => {
  it("keeps every billed line, numbering repeats on the same bill", () => {
    const rows = [
      ["90106", "23-05-2026", "12:17 PM", "90001", "Mr.A", "DR.Ravi K Muppidi", "X-RAY WRIST AP VIEW", "Others", "600", "19.91", "580.09", "", "Lab Service", "", "KPHB"],
      ["90106", "23-05-2026", "12:17 PM", "90001", "Mr.A", "DR.Ravi K Muppidi", "X-RAY WRIST AP VIEW", "Others", "600", "19.91", "580.09", "", "Lab Service", "", "KPHB"],
      ["90107", "23-05-2026", "12:20 PM", "90002", "Mrs.B", "DR.Ravi K Muppidi", "physico sessions", "Others", "500", "0", "500", "", "OP service", "", ""],
    ];
    const [s] = convertHmsSheet(sheet(LAB_H, rows))!;
    expect(s.type).toBe("lab");
    expect(s.rows.map((r) => r.values.Reference)).toEqual(["BILL-90106", "BILL-90106/2", "BILL-90107"]);
    expect(s.rows[0].values).toMatchObject({ Investigation: "X-RAY WRIST AP VIEW", Rate: 600, Discount: 19.91, "Net Amount": 580.09, Department: "Radiology" });
    expect(s.rows[2].values.Department).toBe("OP Procedures");
  });
});

describe("pharmacy daily conversion", () => {
  it("creates one sale per payment mode and a separate refund entry", () => {
    const row = ["01-06-2026", "152294.02", "13311.02", "138983", "127655", "11328", "16381", "20000.83", "124035.17", "", "144036", "16381", "13580", "43680", "2563", "84213", "0", "0", "0", "0"];
    const [s] = convertHmsSheet(sheet(PH_H, [row]))!;
    const v = s.rows.map((r) => r.values);
    expect(v.map((x) => [x["Payment Mode"], x.Sales, x.Return])).toEqual([
      ["Cash", 13580, 0],
      ["Card", 43680, 0],
      ["Cheque", 2563, 0],
      ["UPI", 84213, 0],
      ["Other", null, 20000.83],
    ]);
    // Collections − refunds = OneGlance "Net Revenue".
    const net = v.reduce((a, x) => a + Number(x.Sales ?? 0) - Number(x.Return ?? 0), 0);
    expect(Math.round(net * 100) / 100).toBe(124035.17);
  });
});

describe("fuzzy matching never flips meaning", () => {
  it("does not match New to Old or T3 to T4", () => {
    const items = [{ id: "1", name: "Thyroid Old Consultation" }, { id: "2", name: "T4" }];
    expect(matchByName("Thyroid New Consultation", items)).toBeNull();
    expect(matchByName("T3", items)).toBeNull();
    expect(meaningDiffers("usg thy screening", "usg thyroid screening")).toBe(false);
    expect(matchByName("Usg Thy Screening", [{ id: "3", name: "Usg Thyroid Screening" }])?.item.id).toBe("3");
  });
});

describe("lab item classification", () => {
  it("puts tests in meaningful categories", async () => {
    const { classifyLabItem } = await import("@/lib/import/lab-category");
    const c = (n: string) => classifyLabItem(n).category;
    expect(c("USG Thyroid Doppler Scan")).toBe("Ultrasound");
    expect(c("Scrotum Scan")).toBe("Ultrasound");
    expect(c("HRCT")).toBe("Imaging");
    expect(c("X-RAY WRIST AP VIEW")).toBe("Imaging");
    expect(c("ECG")).toBe("Cardiac");
    expect(c("PeriPheral Nueropathy Examination")).toBe("Diabetic Foot");
    expect(c("Upper GI Endoscopy")).toBe("Procedures");
    expect(c("Mycobacterium Tuberculosis PCR Mycosure:TB(Biopsy)")).toBe("Pathology");
    expect(c("HbA1c")).toBe("Pathology");
    expect(classifyLabItem("ECG").department).toBe("Cardiology");
  });
});

describe("pharmacy medicine reports", () => {
  const SALES_H = ["Bill No", "Bill Date", "Drug Name", "Batch No", "HSNcode", "Qty", "Tax%", "Total", "Sales Amount", "Sales Tax", "CGST", "SGST", "Purchase Amount", "Purchase Tax", "profit"];
  const PUR_H = ["Invoice No", "Invoice Date", "Stockiest Name", "Mfg Name", "HSN Code", "Drug Name", "Batch No", "Expiry By", "Batch Qty", "Free Qty", "Strip Qty", "Mrp", "Rate", "Discount Amount", "Net Value", "Tax%", "Tax Amount", "Purchase Qty", "Avail Qty", "Purchase Value", "Sales Value", "Profit", "Profit(%)"];

  it("turns the sales view into medicine lines (analytics only), numbering repeats", async () => {
    const rows = [
      ["900001", "01-04-2026", "TAB DEMOMET 50/500MG", "B1", "3004", "15", "5", "342.68", "326.36", "16.32", "8.16", "8.16", "200", "10", "142.68"],
      ["900001", "01-04-2026", "TAB DEMOMET 50/500MG", "B1", "3004", "15", "5", "342.68", "326.36", "16.32", "8.16", "8.16", "200", "10", "142.68"],
      ["900002", "02-05-2026", " INJ DEMOSP FLEXTOUCH", "R1", "3004", "1", "5", "1006.24", "958.32", "47.92", "23.96", "23.96", "845.23", "42.26", "161.01"],
    ];
    const out = convertHmsSheet(sheet(SALES_H, rows))!;
    expect(out.map((s) => `${s.type}:${s.name}:${s.rows.length}`)).toEqual(["pharmacy-items:Medicines sold Apr 2026:2", "pharmacy-items:Medicines sold May 2026:1"]);
    expect(out[0].rows.map((r) => r.values["Bill / Invoice No."])).toEqual(["900001", "900001/2"]);
    expect(out[1].rows[0].values).toMatchObject({ Type: "Sale", Medicine: "INJ DEMOSP FLEXTOUCH", Quantity: 1, Amount: 1006.24, Taxable: 958.32, GST: 47.92, Cost: 845.23 });
  });

  it("turns the purchase view into one expense per supplier invoice plus medicine lines", () => {
    const rows = [
      ["INV-1", "01-04-2026", "DEMO DISTRIBUTORS", "DemoPharma", "3004", "TAB A", "A1", "Oct-2027", "10", "20", "15", "375", "285", "0", "2850", "5", "142.5", "450", "0", "2992.5", "11250", "8257.5", "275.94"],
      ["INV-1", "01-04-2026", "DEMO DISTRIBUTORS", "DemoPharma", "3004", "TAB B", "B1", "Jun-2028", "20", "0.5", "10", "115.3", "87.84", "0", "1756.8", "5", "87.84", "200", "5", "1844.64", "2306", "461.36", "25.01"],
    ];
    const out = convertHmsSheet(sheet(PUR_H, rows))!;
    const byType = Object.fromEntries(out.map((s) => [s.type, s]));
    expect(byType["pharmacy-purchase"].rows).toHaveLength(1);
    expect(byType["pharmacy-purchase"].rows[0].values).toMatchObject({ Supplier: "DEMO DISTRIBUTORS", Invoice: "INV-1", "Purchase Amount": 4837.14 });
    expect(byType["pharmacy-items"].rows.map((r) => [r.values.Medicine, r.values.Quantity, r.values["Free Qty"], r.values.Expiry])).toEqual([
      ["TAB A", 450, 300, "Oct-2027"],
      ["TAB B", 200, 5, "Jun-2028"],
    ]);
  });

  it("normalises medicine lines and reads the dosage form", async () => {
    const { normalizeItemRow, itemForm } = await import("@/lib/import/items");
    const mapping = { kind: "Type", date: "Date", docNo: "Bill", item: "Medicine", qty: "Qty", amount: "Amount", cost: "Cost" };
    const ok = normalizeItemRow({ Type: "Sale", Date: "01-04-2026", Bill: "1", Medicine: "  tab  demomet 50/500mg ", Qty: "15", Amount: "342.68", Cost: "200" }, mapping, "2026-09-30");
    expect(ok.errors).toEqual([]);
    expect(ok.input).toMatchObject({ kind: "SALE", date: "2026-04-01", item: "TAB DEMOMET 50/500MG", qty: 15, amount: 342.68, cost: 200 });
    const bad = normalizeItemRow({ Type: "Transfer", Date: "01-04-2026", Medicine: "X", Qty: "1.5", Amount: "-1" }, mapping, "2026-09-30");
    expect(bad.input).toBeNull();
    expect(bad.errors.length).toBeGreaterThanOrEqual(3);
    expect(itemForm("INJ FIASP PENFILL")).toBe("INJ");
    expect(itemForm("BD ULTRA FINE NEEDLE")).toBe("OTHER");
  });
});

describe("supplier payments", () => {
  it("parses OneGlance payment details, including typos", async () => {
    const { parsePaymentDetails } = await import("@/lib/import/payments");
    expect(parsePaymentDetails("636907,INVOICE NO MK13683,MK13806, MK14279")).toEqual({ reference: "636907", invoices: ["MK13683", "MK13806", "MK14279"] });
    expect(parsePaymentDetails("636853,INVOICDE NO A000397,A000412")).toEqual({ reference: "636853", invoices: ["A000397", "A000412"] });
    expect(parsePaymentDetails("112879,INVOICE SIS-V/26-27/800,SIS-V/26-27/904")).toEqual({ reference: "112879", invoices: ["SIS-V/26-27/800", "SIS-V/26-27/904"] });
    expect(parsePaymentDetails("110561,INVOICE NO GST 12")).toEqual({ reference: "110561", invoices: ["GST12"] });
    expect(parsePaymentDetails("cash advance").invoices).toEqual([]);
  });

  it("converts the Pharmacy Invoice Report by month", () => {
    const h = ["BillNo", "Paid date", "Stockiest Name", "Details", "Paid Amount"];
    const out = convertHmsSheet(sheet(h, [["5936", "01-04-2026", "DEMO ENTERPRISES", "593677,INVOICE NO MK12106", "336"], ["6086", "10-09-2026", "DEMO AGENCIES", "112888,INVOICE NO SB-26-89481", "115289"]]))!;
    expect(out.map((s) => `${s.type}:${s.name}:${s.rows.length}`)).toEqual(["supplier-payments:Supplier payments Apr 2026:1", "supplier-payments:Supplier payments Sep 2026:1"]);
    expect(out[0].rows[0].values).toMatchObject({ Supplier: "DEMO ENTERPRISES", Details: "593677,INVOICE NO MK12106", "Amount paid": 336 });
  });
});
