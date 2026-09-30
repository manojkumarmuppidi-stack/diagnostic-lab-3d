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
