/**
 * OneGlance HMS report adapters.
 *
 * AED's billing system (OneGlance) exports fixed-layout reports. Instead of asking staff to
 * reformat them, the importer recognises each report by its header row and converts it into
 * the app's own template columns, split by month so every batch stays small. The converted
 * sheets then go through the normal validate → review → commit pipeline unchanged.
 *
 *  - Outpatient Collection Report       → OPD (+ Diet for "Diet Follow up" bills)
 *  - OP bill collection (Bill Date, Visit Purpose, Cash/Online…) → OPD with payment modes
 *  - Bill Item Wise Collection          → Laboratory (one row per test / service line)
 *  - Pharmacy Collection Report (daily) → Pharmacy sales per payment mode + refunds
 *  - Lab Bill Collection                → rejected with guidance (bill totals, no test names)
 *  - Cash book (Date/Description/Debit/Credit/Balance) → Expenses, categorised from the description
 *
 * Payment modes are not in the OPD or item-wise exports; those rows are recorded as "Other"
 * and flagged in Remarks, so reconciliation never pretends to know the split.
 */
import type { ImportType } from "../modules";
import { norm } from "./text";
import { classifyLabItem } from "./lab-category";
import { classifyExpense, vendorFrom } from "./expense-category";
import { suggestModeCode } from "../expenses";

type Cell = string | number | boolean | null;
export interface RawSheet {
  name: string;
  headerRow: number;
  headers: string[];
  rows: { rowNumber: number; values: Record<string, Cell> }[];
}
export interface ConvertedSheet extends RawSheet {
  type: ImportType;
  /** Shown to the user above the mapping step. */
  note: string;
  source: HmsReport;
}
export type HmsReport = "oneglance-opd" | "oneglance-opd-collection" | "oneglance-lab-items" | "oneglance-pharmacy-daily" | "oneglance-lab-bills" | "oneglance-pharmacy-item-sales" | "oneglance-pharmacy-item-purchases" | "oneglance-supplier-payments" | "cash-book";

export const HMS_LABELS: Record<HmsReport, string> = {
  "oneglance-opd": "OneGlance · Outpatient Collection Report",
  "oneglance-opd-collection": "OneGlance · OP bill collection (with payment modes)",
  "oneglance-lab-items": "OneGlance · Bill Item Wise Collection",
  "oneglance-pharmacy-daily": "OneGlance · Pharmacy Collection Report (daily totals)",
  "oneglance-lab-bills": "OneGlance · Lab Bill Collection",
  "oneglance-pharmacy-item-sales": "OneGlance · Purchase/Sales Report (medicines sold)",
  "oneglance-pharmacy-item-purchases": "OneGlance · Purchase/Sales Report (purchase invoices)",
  "oneglance-supplier-payments": "OneGlance · Pharmacy Invoice Report (supplier payments)",
  "cash-book": "Cash book (Date · Description · Debit · Credit · Balance)",
};

const has = (headers: string[], ...names: string[]) => {
  const set = new Set(headers.map((h) => norm(h)));
  return names.every((n) => set.has(norm(n)));
};

export function detectHmsReport(headers: string[]): HmsReport | null {
  if (has(headers, "BillNO", "DoctorName", "Particulars", "ToatlAmount", "Discount")) return "oneglance-opd";
  if (has(headers, "BillNo", "Bill Date", "DoctorName", "DiscAmount", "BillAmount", "Visit Purpose")) return "oneglance-opd-collection";
  if (has(headers, "Bill NO", "Particulars", "Accountgroup", "Itemdiscount", "NetAmount")) return "oneglance-lab-items";
  if (has(headers, "Bill Date", "Net Revenue", "Pending Collected", "paidvalue", "Cash")) return "oneglance-pharmacy-daily";
  if (has(headers, "BillNo", "RefLab", "RefferedBY", "PaidAmount", "Cash")) return "oneglance-lab-bills";
  if (has(headers, "Bill No", "Drug Name", "Qty", "Total", "Sales Amount", "Purchase Amount")) return "oneglance-pharmacy-item-sales";
  if (has(headers, "Invoice No", "Invoice Date", "Stockiest Name", "Drug Name", "Purchase Value")) return "oneglance-pharmacy-item-purchases";
  if (has(headers, "BillNo", "Paid date", "Stockiest Name", "Details", "Paid Amount")) return "oneglance-supplier-payments";
  if (has(headers, "Description", "Debit", "Credit", "Balance") && (has(headers, "Cheque No.") || has(headers, "Ledger"))) return "cash-book";
  return null;
}

// ─────────────────────────── value helpers ───────────────────────────

/** Case-insensitive column read ("Bill NO" and "Bill No" are the same column). */
function getter(values: Record<string, Cell>) {
  const byNorm = new Map<string, Cell>();
  for (const [k, v] of Object.entries(values)) byNorm.set(norm(k), v);
  return (name: string): string => {
    const v = byNorm.get(norm(name));
    if (v === null || v === undefined) return "";
    const s = String(v).trim();
    return s.toLowerCase() === "null" ? "" : s;
  };
}
const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "DR . RAVI KUMAR M", "Dr.Dr.Elizabeth Moses", "DR.Ravi K Muppidi  " → "Dr. Ravi Kumar M", "Dr. Elizabeth Moses", "Dr. Ravi K Muppidi". */
export function cleanDoctor(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  while (/^dr\s*\.?\s*/i.test(s) && s.length > 3) s = s.replace(/^dr\s*\.?\s*/i, "");
  s = s.replace(/^[.\s]+/, "").trim();
  if (!s) return "";
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return `Dr. ${s}`;
}

/** "Mrs.LAXMI B(49)", "Mr.Srinivas K+(41)" → "Mrs.LAXMI B", "Mr.Srinivas K". */
export function cleanPatient(raw: string): string {
  return raw.replace(/\(\s*\d{1,3}\s*\)\s*$/, "").replace(/\+\s*$/, "").replace(/\s+/g, " ").trim();
}

const cleanText = (s: string) => s.replace(/\s+/g, " ").trim();

/** "30-09-2026" → "2026-09" (for month batches). */
function monthKey(date: string): string {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(date);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})/.exec(date);
  return iso ? `${iso[1]}-${iso[2]}` : "unknown";
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (k: string) => (/^\d{4}-\d{2}$/.test(k) ? `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}` : k);

/** Specialty from the consultation name used on the OneGlance tariff. */
export function specialtyFor(particulars: string): string {
  const s = norm(particulars);
  const thyroid = /thyroid/.test(s);
  const diabetes = /diabet|sugar/.test(s);
  if (thyroid && diabetes) return "Diabetes & Thyroid";
  if (thyroid) return "Thyroid";
  if (diabetes) return "Diabetes";
  if (/obesity/.test(s)) return "Obesity";
  if (/hormon|growth/.test(s)) return "Hormones";
  if (/gyn/.test(s)) return "Gynaecology";
  if (/physio/.test(s)) return "Physiotherapy";
  if (/surgeon|surgery/.test(s)) return "General Surgery";
  if (/skin|hair|derma/.test(s)) return "Dermatology";
  return "General";
}

/** New/Old from the consultation name; null when the name does not say. */
export function visitTypeFor(particulars: string): "New" | "Old" | null {
  const s = norm(particulars);
  if (/\bnew\b|registration/.test(s)) return "New";
  if (/\bold\b|follow/.test(s)) return "Old";
  return null;
}

type Out = { rowNumber: number; values: Record<string, Cell> };

function byMonth(
  source: HmsReport,
  sheetName: string,
  type: ImportType,
  label: string,
  headers: string[],
  rows: Out[],
  note: string,
): ConvertedSheet[] {
  const groups = new Map<string, Out[]>();
  for (const r of rows) {
    const k = monthKey(String(r.values.Date ?? ""));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, rs]) => ({
      name: `${label} ${monthLabel(k)}`.slice(0, 60),
      headerRow: 1,
      headers,
      rows: rs,
      type,
      note: `${HMS_LABELS[source]} (${sheetName}): ${note}`,
      source,
    }));
}

const NO_MODE = "Payment mode not in OneGlance export";

// ─────────────────────────── converters ───────────────────────────

const OPD_HEADERS = ["Date", "Patient ID", "Patient Name", "Doctor", "Specialty", "Consultation Type", "New/Old", "Amount", "Discount", "Net Amount", "Payment Mode", "Reference", "Remarks"];
const DIET_HEADERS = ["Date", "Patient ID", "Patient Name", "Service", "Amount", "Discount", "Net Amount", "Payment Mode", "Reference", "Remarks"];

function convertOpd(sheet: RawSheet): ConvertedSheet[] {
  const src = sheet.rows.map((r) => ({ rowNumber: r.rowNumber, g: getter(r.values) }));
  // Patient IDs are sequential, so the lowest ID billed as "new" marks where this period's registrations start.
  const newIds = src.filter((r) => visitTypeFor(r.g("Particulars")) === "New").map((r) => num(r.g("Patientid"))).filter((n) => n > 0);
  const firstNewId = newIds.length ? Math.min(...newIds) : Infinity;
  const seen = new Set<string>();
  const opd: Out[] = [];
  const diet: Out[] = [];
  let inferred = 0;
  // Oldest first, so "first visit in the file" is meaningful.
  const ordered = [...src].sort((a, b) => num(a.g("BillNO")) - num(b.g("BillNO")));
  for (const { rowNumber, g } of ordered) {
    const particulars = cleanText(g("Particulars"));
    const pid = g("Patientid");
    const total = num(g("ToatlAmount")) || num(g("BillAmount")) * (num(g("Quantity")) || 1);
    const discount = num(g("Discount"));
    const net = r2(total - discount + num(g("S/C")));
    const refBy = cleanText(g("Refferby"));
    const area = cleanText(g("Area"));
    const remarks = [NO_MODE, refBy && `Ref: ${refBy}`, area && `Area: ${area}`].filter(Boolean).join(" · ");
    const base = {
      Date: g("BillDate"),
      "Patient ID": pid,
      "Patient Name": cleanPatient(g("PatientName")),
      Amount: total,
      Discount: discount,
      "Net Amount": net,
      "Payment Mode": "Other",
      Reference: `OP-${g("BillNO")}`,
      Remarks: remarks,
    };
    const firstVisit = !!pid && !seen.has(pid);
    if (pid) seen.add(pid);
    if (/^diet\b/i.test(particulars)) {
      diet.push({ rowNumber, values: { ...base, Service: particulars } });
      continue;
    }
    let vt = visitTypeFor(particulars);
    if (!vt) {
      inferred++;
      vt = firstVisit && num(pid) >= firstNewId ? "New" : "Old";
    }
    opd.push({
      rowNumber,
      values: { ...base, Doctor: cleanDoctor(g("DoctorName")), Specialty: specialtyFor(particulars), "Consultation Type": particulars, "New/Old": vt },
    });
  }
  const note =
    `${opd.length.toLocaleString("en-IN")} OPD bills` +
    (diet.length ? ` and ${diet.length} diet follow-ups (moved to Diet & Nutrition)` : "") +
    `. Specialty and New/Old are read from the consultation name` +
    (inferred ? `; ${inferred} bills whose name does not say New/Old were set from the patient's registration number` : "") +
    `. The export has no payment mode, so bills are recorded under "Other".`;
  return [
    ...byMonth("oneglance-opd", sheet.name, "opd", "OPD", OPD_HEADERS, opd, note),
    ...byMonth("oneglance-opd", sheet.name, "diet", "Diet", DIET_HEADERS, diet, note),
  ];
}

/**
 * OneGlance OP bill collection: one row per OPD bill with the amount paid per payment mode, but no
 * consultation name. New/Old: patient IDs are issued in sequence, so a bill whose patient ID is higher
 * than every ID billed before it (in bill-number order) is a new registration; "new"/"follow up" in
 * Visit Purpose wins when present. Specialty comes from Visit Purpose when it names one, else General.
 */
const MODE_COLUMNS: [string, string][] = [["Cash", "Cash"], ["Online", "UPI"], ["Cheque", "Cheque"], ["OneGlance Wallet", "Other"]];
function convertOpdCollection(sheet: RawSheet): ConvertedSheet[] {
  const src = sheet.rows.map((r) => ({ rowNumber: r.rowNumber, g: getter(r.values) })).filter((r) => r.g("BillNo") && r.g("Bill Date"));
  const ordered = [...src].sort((a, b) => num(a.g("BillNo")) - num(b.g("BillNo")));
  let maxId = -Infinity;
  let first = true;
  const opd: Out[] = [];
  const diet: Out[] = [];
  let split = 0;
  let unpaid = 0;
  for (const { rowNumber, g } of ordered) {
    const purpose = cleanText(g("Visit Purpose"));
    const pid = g("PatientID");
    const idNum = num(pid);
    let vt = visitTypeFor(purpose);
    if (!vt) vt = !first && idNum > maxId ? "New" : "Old";
    if (idNum > maxId) maxId = idNum;
    first = false;
    const total = num(g("TotalAmount"));
    const discount = num(g("DiscAmount"));
    const net = num(g("BillAmount")) || r2(total - discount);
    const paid = MODE_COLUMNS.map(([col, mode]) => [mode, num(g(col))] as const).filter(([, a]) => a > 0);
    let mode = "Other";
    const notes: string[] = [];
    if (paid.length) {
      mode = [...paid].sort((a, b) => b[1] - a[1])[0][0];
      if (paid.length > 1) {
        split++;
        notes.push(`Paid ${paid.map(([m, a]) => `${m} ${a}`).join(" + ")}`);
      }
    } else {
      unpaid++;
      notes.push("No payment recorded in the export");
    }
    const due = num(g("Due"));
    if (due > 0) notes.push(`Due ${due}`);
    const refBy = cleanText(g("Refferby"));
    const area = cleanText(g("Area"));
    if (refBy) notes.push(`Ref: ${refBy}`);
    if (area) notes.push(`Area: ${area}`);
    const base = {
      Date: g("Bill Date"),
      "Patient ID": pid,
      "Patient Name": cleanPatient(g("PatientName")),
      Amount: total,
      Discount: discount,
      "Net Amount": net,
      "Payment Mode": mode,
      Reference: `OP-${g("BillNo")}`,
      Remarks: notes.join(" · "),
    };
    if (/\bdiet\b/i.test(purpose)) {
      diet.push({ rowNumber, values: { ...base, Service: purpose || "Diet consultation" } });
      continue;
    }
    const consult = purpose ? purpose.charAt(0) + purpose.slice(1).toLowerCase() : "Consultation";
    opd.push({ rowNumber, values: { ...base, Doctor: cleanDoctor(g("DoctorName")), Specialty: specialtyFor(purpose), "Consultation Type": consult, "New/Old": vt } });
  }
  const note =
    `${opd.length.toLocaleString("en-IN")} OPD bills` +
    (diet.length ? ` and ${diet.length} diet bills` : "") +
    ` with payment modes (Cash, Online → UPI, Cheque, Wallet → Other)` +
    (split ? `; ${split} bills paid in two modes are recorded under the larger one (split in Remarks)` : "") +
    (unpaid ? `; ${unpaid} bills with no payment are recorded under Other` : "") +
    `. This export has no consultation name, so specialty is General unless Visit Purpose names one, and New/Old comes from the patient registration number. ` +
    `Bills already in the app (same OP bill number and date) are flagged as duplicates.`;
  return [
    ...byMonth("oneglance-opd-collection", sheet.name, "opd", "OPD", OPD_HEADERS, opd, note),
    ...byMonth("oneglance-opd-collection", sheet.name, "diet", "Diet", DIET_HEADERS, diet, note),
  ];
}

const LAB_HEADERS = ["Date", "Patient ID", "Patient Name", "Investigation", "Quantity", "Rate", "Discount", "Net Amount", "Payment Mode", "Doctor", "Department", "Reference", "Remarks"];

function convertLabItems(sheet: RawSheet): ConvertedSheet[] {
  const out: Out[] = [];
  let procedures = 0;
  // The same test twice on one bill is two billed lines, not a duplicate: number the repeats.
  const lineCount = new Map<string, number>();
  for (const r of sheet.rows) {
    const g = getter(r.values);
    const lineKey = `${g("Bill NO")}|${norm(g("Particulars"))}|${g("NetAmount")}`;
    const nth = (lineCount.get(lineKey) ?? 0) + 1;
    lineCount.set(lineKey, nth);
    const rate = num(g("Amount"));
    const net = num(g("NetAmount"));
    const isOp = norm(g("Services")) === "op service";
    if (isOp) procedures++;
    const area = cleanText(g("Area"));
    out.push({
      rowNumber: r.rowNumber,
      values: {
        Date: g("Bill Date"),
        "Patient ID": g("Patientid"),
        "Patient Name": cleanPatient(g("PatientName")),
        Investigation: cleanText(g("Particulars")),
        Quantity: 1,
        Rate: rate,
        // Recomputed from rate − net so paise rounding in the export never trips validation.
        Discount: r2(Math.max(0, rate - net)),
        "Net Amount": net,
        "Payment Mode": "Other",
        Doctor: cleanDoctor(g("Doctor")),
        Department: isOp ? "OP Procedures" : classifyLabItem(g("Particulars")).department,
        Reference: `BILL-${g("Bill NO")}${nth > 1 ? `/${nth}` : ""}`,
        Remarks: [NO_MODE, area && `Area: ${area}`].filter(Boolean).join(" · "),
      },
    });
  }
  const bills = new Set(sheet.rows.map((r) => getter(r.values)("Bill NO"))).size;
  const note =
    `${out.length.toLocaleString("en-IN")} test/service lines from ${bills.toLocaleString("en-IN")} bills` +
    (procedures ? ` (${procedures} physio/procedure lines go to department "OP Procedures")` : "") +
    `. Departments (Laboratory, Radiology, Cardiology) and test categories are set from the test name` +
    `. Net amounts are taken as billed. The export has no payment mode, so lines are recorded under "Other".`;
  return byMonth("oneglance-lab-items", sheet.name, "lab", "Lab", LAB_HEADERS, out, note);
}

const PHARMACY_HEADERS = ["Date", "Invoice", "Sales", "Discount", "Return", "Net Sales", "Payment Mode", "Remarks"];
/** OneGlance collection columns → app payment mode. UPI-type wallets are grouped as UPI. */
const PHARMACY_MODES: [string, string][] = [
  ["Cash", "Cash"],
  ["Card", "Card"],
  ["Cheque", "Cheque"],
  ["Online", "UPI"],
  ["Phone Pay", "UPI"],
  ["G Pay", "UPI"],
  ["OneGlance Wallet", "Other"],
];

function convertPharmacyDaily(sheet: RawSheet): ConvertedSheet[] {
  const out: Out[] = [];
  let deposits = 0;
  let mismatches = 0;
  for (const r of sheet.rows) {
    const g = getter(r.values);
    const date = g("Bill Date");
    if (!date) continue;
    const byMode = new Map<string, number>();
    for (const [col, mode] of PHARMACY_MODES) {
      const v = num(g(col));
      if (v > 0) byMode.set(mode, r2((byMode.get(mode) ?? 0) + v));
    }
    // Paid from an IPD advance: that money was already counted when the deposit was taken.
    deposits += num(g("Adjust deposit"));
    const collected = [...byMode.values()].reduce((a, b) => a + b, 0);
    if (Math.abs(collected - num(g("paidvalue"))) > 1) mismatches++;
    const refund = r2(num(g("Refund Amount")));
    const summary = `OneGlance daily total · billed ${num(g("Bill Amount"))} after discount ${num(g("Discount"))} · due ${num(g("DueAmount"))} · old dues collected ${num(g("Pending Collected"))}`;
    const stamp = monthKey(date).replace("-", "") + date.slice(0, 2);
    for (const [mode, amount] of byMode) {
      out.push({
        rowNumber: r.rowNumber,
        values: { Date: date, Invoice: `PH-DAY-${stamp}-${mode.toUpperCase()}`, Sales: amount, Discount: 0, Return: 0, "Net Sales": amount, "Payment Mode": mode, Remarks: summary },
      });
    }
    // Refunds are their own entry: the export does not say which mode they were paid back in.
    if (refund > 0) {
      out.push({
        rowNumber: r.rowNumber,
        values: { Date: date, Invoice: `PH-DAY-${stamp}-REFUND`, Sales: null, Discount: null, Return: refund, "Net Sales": null, "Payment Mode": "Other", Remarks: `Refunds for the day (mode not in export) · ${summary}` },
      });
    }
  }
  const note =
    `daily totals, one sale per payment mode per day (Online, PhonePe and GPay → UPI), with the day's refunds as a pharmacy return. ` +
    `This is collections, not bills: pharmacy bill counts and average bill value will not be meaningful for these days — ` +
    `export a bill-wise pharmacy report if OneGlance has one.` +
    (deposits > 0 ? ` ₹${deposits.toLocaleString("en-IN")} paid from IPD deposits was left out (already counted when the deposit was taken).` : "") +
    (mismatches ? ` ${mismatches} day(s) where the payment-mode columns do not add up to "paidvalue" — check them in Review.` : "");
  return byMonth("oneglance-pharmacy-daily", sheet.name, "pharmacy-sale", "Pharmacy", PHARMACY_HEADERS, out, note);
}

const ITEM_HEADERS = ["Type", "Date", "Bill / Invoice No.", "Medicine", "Batch", "Expiry", "Supplier", "Manufacturer", "Quantity", "Free Qty", "Amount", "Taxable", "GST", "Cost"];

/** Purchase/Sales Report, sales view: one line per medicine per bill → medicine lines (analytics only). */
function convertPharmacyItemSales(sheet: RawSheet): ConvertedSheet[] {
  const out: Out[] = [];
  const lineCount = new Map<string, number>();
  const bills = new Set<string>();
  for (const r of sheet.rows) {
    const g = getter(r.values);
    const bill = g("Bill No");
    bills.add(bill);
    const key = `${bill}|${norm(g("Drug Name"))}|${g("Batch No")}|${g("Qty")}|${g("Total")}`;
    const nth = (lineCount.get(key) ?? 0) + 1;
    lineCount.set(key, nth);
    out.push({
      rowNumber: r.rowNumber,
      values: {
        Type: "Sale",
        Date: g("Bill Date"),
        "Bill / Invoice No.": `${bill}${nth > 1 ? `/${nth}` : ""}`,
        Medicine: cleanText(g("Drug Name")),
        Batch: g("Batch No"),
        Quantity: num(g("Qty")),
        Amount: num(g("Total")),
        Taxable: num(g("Sales Amount")),
        GST: num(g("Sales Tax")),
        Cost: num(g("Purchase Amount")),
      },
    });
  }
  const note =
    `${out.length.toLocaleString("en-IN")} medicine lines from ${bills.size.toLocaleString("en-IN")} pharmacy bills — units sold, value and cost per medicine. ` +
    `These power medicine-wise analytics (e.g. Janumet, Fiasp units) and true pharmacy margin; they are NOT added to income again ` +
    `(pharmacy income stays the collections from the Pharmacy Collection Report).`;
  return byMonth("oneglance-pharmacy-item-sales", sheet.name, "pharmacy-items", "Medicines sold", ITEM_HEADERS, out, note);
}

const PURCHASE_HEADERS = ["Date", "Supplier", "Invoice", "Purchase Amount", "Payment Mode", "Remarks"];

/**
 * Purchase/Sales Report, purchase view: one line per medicine per supplier invoice →
 * (1) medicine purchase lines (analytics) and (2) one pharmacy purchase (expense) per invoice.
 */
function convertPharmacyItemPurchases(sheet: RawSheet): ConvertedSheet[] {
  const lines: Out[] = [];
  const invoices = new Map<string, { rowNumber: number; date: string; supplier: string; invoice: string; amount: number; lines: number }>();
  const lineCount = new Map<string, number>();
  for (const r of sheet.rows) {
    const g = getter(r.values);
    const supplier = cleanText(g("Stockiest Name"));
    const invoice = cleanText(g("Invoice No"));
    const date = g("Invoice Date");
    const value = num(g("Purchase Value"));
    const key = `${invoice}|${supplier}|${norm(g("Drug Name"))}|${g("Batch No")}|${g("Purchase Qty")}|${value}`;
    const nth = (lineCount.get(key) ?? 0) + 1;
    lineCount.set(key, nth);
    lines.push({
      rowNumber: r.rowNumber,
      values: {
        Type: "Purchase",
        Date: date,
        "Bill / Invoice No.": `${invoice}${nth > 1 ? `/${nth}` : ""}`,
        Medicine: cleanText(g("Drug Name")),
        Batch: g("Batch No"),
        Expiry: g("Expiry By"),
        Supplier: supplier,
        Manufacturer: cleanText(g("Mfg Name")),
        // "Purchase Qty" is in units and already includes free goods; free units are recorded separately.
        Quantity: num(g("Purchase Qty")),
        "Free Qty": Math.round(num(g("Free Qty")) * (num(g("Strip Qty")) || 1)),
        Amount: value,
        Taxable: num(g("Net Value")),
        GST: num(g("Tax Amount")),
      },
    });
    const ik = `${supplier}|${invoice}|${date}`;
    const inv = invoices.get(ik) ?? { rowNumber: r.rowNumber, date, supplier, invoice, amount: 0, lines: 0 };
    inv.amount = r2(inv.amount + value);
    inv.lines++;
    invoices.set(ik, inv);
  }
  const purchases: Out[] = [...invoices.values()].map((i) => ({
    rowNumber: i.rowNumber,
    values: { Date: i.date, Supplier: i.supplier, Invoice: i.invoice, "Purchase Amount": i.amount, "Payment Mode": "", Remarks: `OneGlance purchase invoice · ${i.lines} line${i.lines > 1 ? "s" : ""}` },
  }));
  const total = purchases.reduce((a, p) => a + Number(p.values["Purchase Amount"]), 0);
  const note =
    `${invoices.size.toLocaleString("en-IN")} supplier invoices (₹${Math.round(total).toLocaleString("en-IN")}) become pharmacy purchases — they count as pharmacy expenditure; ` +
    `their ${lines.length.toLocaleString("en-IN")} medicine lines are kept for purchase analytics (supplier, manufacturer, batch, expiry). ` +
    `Payment mode is not in the export.`;
  return [
    ...byMonth("oneglance-pharmacy-item-purchases", sheet.name, "pharmacy-purchase", "Purchase invoices", PURCHASE_HEADERS, purchases, note),
    ...byMonth("oneglance-pharmacy-item-purchases", sheet.name, "pharmacy-items", "Medicines purchased", ITEM_HEADERS, lines, note),
  ];
}

const PAYMENT_HEADERS = ["Date", "Supplier", "Details", "Amount paid"];

/** Pharmacy Invoice Report: one row per payment to a supplier, listing the invoices it settles. */
function convertSupplierPayments(sheet: RawSheet): ConvertedSheet[] {
  const out: Out[] = sheet.rows.map((r) => {
    const g = getter(r.values);
    return { rowNumber: r.rowNumber, values: { Date: g("Paid date"), Supplier: cleanText(g("Stockiest Name")), Details: cleanText(g("Details")), "Amount paid": num(g("Paid Amount")) } };
  });
  const total = out.reduce((a, r) => a + Number(r.values["Amount paid"]), 0);
  const note =
    `${out.length} payments to suppliers (₹${Math.round(total).toLocaleString("en-IN")}). They are matched to purchase invoices by invoice number to show what is paid and what is still open. ` +
    `They are NOT expenses (the purchase invoices already are). If some suppliers are paid in cash/UPI outside this report, their invoices will look unpaid.`;
  return byMonth("oneglance-supplier-payments", sheet.name, "supplier-payments", "Supplier payments", PAYMENT_HEADERS, out, note);
}

// ─────────────────────────── cash book ───────────────────────────

const EXPENSE_HEADERS = ["Date", "Department", "Category", "Subcategory", "Description", "Vendor", "Bill Number", "Amount", "Payment Mode", "Remarks"];
const MODE_NAMES = { CASH: "Cash", CARD: "Card", BANK: "Bank Transfer" } as const;

const isoToDay = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000;
function isoOf(y: number, m: number, d: number): string | null {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * Hand-typed cash books mix day-first and month-first dates, and Excel silently turns
 * "03/01/2026" (3 Jan) into 1 Mar. The rows are in date order, so every date that could be read
 * both ways is resolved by its neighbours: dates with a day above 12 can only be read one way and
 * act as anchors; each ambiguous date takes the reading closest to the anchors before and after it.
 * Returns ISO dates ("" for unreadable) and how many were swapped.
 */
export function fixLedgerDates(raw: string[]): { dates: string[]; swapped: number } {
  const cands = raw.map((v) => {
    const s = String(v ?? "").trim();
    let y: number, a: number, b: number;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) [y, a, b] = [+m[1], +m[2], +m[3]]; // Excel date: month a, day b
    else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) [y, a, b] = [+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]]; // typed text, day-first
    else return [] as string[];
    const first = isoOf(y, a, b);
    const other = a !== b ? isoOf(y, b, a) : null;
    return [first, other].filter((x): x is string => !!x);
  });
  const anchors = cands.map((c) => (c.length === 1 ? isoToDay(c[0]) : null));
  const dates: string[] = [];
  let swapped = 0;
  let prev: number | null = null;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.length === 0) {
      dates.push("");
      continue;
    }
    let pick = c[0];
    if (c.length === 2) {
      let next: number | null = null;
      for (let j = i + 1; j < cands.length && next === null; j++) next = anchors[j];
      let lastAnchor: number | null = null;
      for (let j = i - 1; j >= 0 && lastAnchor === null; j--) lastAnchor = anchors[j];
      const ref = [prev, lastAnchor, next].filter((x): x is number => x !== null);
      if (ref.length) {
        const cost = (iso: string) => ref.reduce((acc, r) => acc + Math.abs(isoToDay(iso) - r), 0);
        pick = cost(c[1]) < cost(c[0]) ? c[1] : c[0];
      }
      if (pick !== c[0]) swapped++;
    }
    prev = isoToDay(pick);
    dates.push(pick);
  }
  return { dates, swapped };
}

/**
 * Cash book: debit lines become expenses; credits (cash received) and blank amounts are skipped.
 * Payments to pharmacy suppliers become supplier payments, since their invoices are already expenses.
 */
function convertCashBook(sheet: RawSheet): ConvertedSheet[] {
  const dateCol = sheet.headers.find((h) => /date/i.test(h)) ?? sheet.headers[0];
  const { dates, swapped } = fixLedgerDates(sheet.rows.map((r) => String(r.values[dateCol] ?? "")));
  const out: Out[] = [];
  const supplier: Out[] = [];
  let credits = 0;
  let blank = 0;
  sheet.rows.forEach((r, i) => {
    const g = getter(r.values);
    const desc = cleanText(g("Description"));
    const debit = num(g("Debit"));
    if (!(debit > 0)) {
      if (num(g("Credit")) > 0) credits++;
      else if (desc) blank++;
      return;
    }
    const { category, subcategory, department, supplierPayment } = classifyExpense(desc);
    const mode = suggestModeCode(debit);
    const [y, m, d] = (dates[i] || "").split("-");
    if (supplierPayment) {
      supplier.push({ rowNumber: r.rowNumber, values: { Date: dates[i] ? `${d}-${m}-${y}` : "", Supplier: vendorFrom(desc) ?? desc, Details: `Cash book: ${desc}`, "Amount paid": r2(debit) } });
      return;
    }
    out.push({
      rowNumber: r.rowNumber,
      values: {
        Date: dates[i] ? `${d}-${m}-${y}` : "",
        Department: department ?? null,
        Category: category,
        Subcategory: subcategory ?? null,
        Description: desc || "(no description)",
        Vendor: vendorFrom(desc) ?? null,
        // The cash-book row is the voucher reference: it keeps genuine repeats apart (three ₹10,000 payments
        // to one doctor on one day) while a re-upload of the same book is still caught as a duplicate.
        "Bill Number": g("Cheque No.") || `CB-${r.rowNumber}`,
        Amount: r2(debit),
        "Payment Mode": mode ? MODE_NAMES[mode] : "Cash",
        Remarks: ["Cash book", g("Ledger") ? `ledger ${g("Ledger")}` : "", "payment mode estimated from amount"].filter(Boolean).join(" · "),
      },
    });
  });
  const total = out.reduce((a, r) => a + Number(r.values.Amount), 0);
  const note =
    `${out.length} payments (₹${Math.round(total).toLocaleString("en-IN")}) categorised from the description` +
    (swapped ? `; ${swapped} dates that Excel had read month-first were corrected from the neighbouring rows` : "") +
    (credits ? `; ${credits} cash-received lines skipped` : "") +
    (blank ? `; ${blank} lines without an amount skipped` : "") +
    `. Payment mode is estimated from the amount (below ₹3,000 cash, above ₹1,00,000 bank, otherwise card). Check "Other" rows before importing.`;
  const expenses = byMonth("cash-book", sheet.name, "expense", "Cash book", EXPENSE_HEADERS, out, note);
  if (!supplier.length) return expenses;
  const paid = supplier.reduce((a, r) => a + Number(r.values["Amount paid"]), 0);
  const supplierNote =
    `${supplier.length} payments to pharmacy suppliers (₹${Math.round(paid).toLocaleString("en-IN")}). Their purchase invoices are already expenses (OneGlance purchase report), ` +
    `so these are recorded as supplier payments, not expenses. They carry no invoice numbers, so they add to the supplier's "paid" total but do not close specific invoices.`;
  return [...expenses, ...byMonth("cash-book", sheet.name, "supplier-payments", "Cash book supplier payments", PAYMENT_HEADERS, supplier, supplierNote)];
}

export class HmsReportError extends Error {}

/**
 * Convert a sheet if it is a known OneGlance report; otherwise return null and the sheet
 * is imported with normal column mapping.
 */
export function convertHmsSheet(sheet: RawSheet): ConvertedSheet[] | null {
  const kind = detectHmsReport(sheet.headers);
  switch (kind) {
    case "oneglance-opd":
      return convertOpd(sheet);
    case "oneglance-opd-collection":
      return convertOpdCollection(sheet);
    case "oneglance-lab-items":
      return convertLabItems(sheet);
    case "oneglance-pharmacy-daily":
      return convertPharmacyDaily(sheet);
    case "oneglance-pharmacy-item-sales":
      return convertPharmacyItemSales(sheet);
    case "oneglance-pharmacy-item-purchases":
      return convertPharmacyItemPurchases(sheet);
    case "oneglance-supplier-payments":
      return convertSupplierPayments(sheet);
    case "cash-book":
      return convertCashBook(sheet);
    case "oneglance-lab-bills":
      throw new HmsReportError(
        'This is OneGlance "Lab Bill Collection": bill totals without test names, so importing it would count one test per bill. ' +
          'Upload "Bill Item Wise Collection With Account Group" for the same dates instead — it has every test line.',
      );
    default:
      return null;
  }
}
