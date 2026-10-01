/**
 * Client-safe registry of transaction modules. Drives: entry forms, list columns,
 * Excel templates, import column-mapping targets and drill-down links.
 * Server-side persistence lives in src/server/services/modules.ts.
 */
import type { PermissionCode } from "./permissions";

export type MasterKey =
  | "departments"
  | "specialties"
  | "doctors"
  | "dieticians"
  | "consultationTypes"
  | "admissionTypes"
  | "ipdPackages"
  | "investigations"
  | "dietServices"
  | "expenseCategories"
  | "expenseSubcategories"
  | "paymentModes";

export type FieldType = "date" | "text" | "money" | "int" | "select" | "visitType" | "ipdTxnType" | "textarea" | "admission";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  master?: MasterKey;
  /** Header synonyms used by smart column mapping (lower-case, any punctuation). */
  aliases?: string[];
  /** Hidden from the entry form (e.g. import-only columns). */
  importOnly?: boolean;
  /** Hidden from import mapping (e.g. admissionId picker). */
  formOnly?: boolean;
  placeholder?: string;
  help?: string;
}

export interface ColumnDef {
  key: string;
  label: string;
  type?: "date" | "money" | "int" | "text" | "badge" | "status";
  mobile?: boolean;
}

export const MODULE_KEYS = [
  "opd",
  "ipd",
  "ipd-payment",
  "lab",
  "pharmacy-sale",
  "pharmacy-return",
  "pharmacy-purchase",
  "diet",
  "other-income",
  "expense",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(s: string): s is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(s);
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  singular: string;
  perm: "opd" | "ipd" | "lab" | "pharmacy" | "diet" | "income" | "expense";
  /** Page where the module's transactions are listed (drill-down target). */
  href: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  /** Column headers of the downloadable Excel template, in order. */
  template: string[];
  /** Sample rows for the template (fictional). */
  sample: (string | number)[][];
  /** True if amounts are income (false = expenditure). */
  income: boolean;
}

const patientFields: FieldDef[] = [
  { key: "patientCode", label: "Patient ID", type: "text", aliases: ["patient id", "pid", "uhid", "mrn", "reg no", "registration no", "patient no", "op no", "patient code", "hospital id"] },
  { key: "patientName", label: "Patient Name", type: "text", aliases: ["patient", "name", "patient name", "pt name", "patientname", "customer", "customer name"] },
];
const dateField: FieldDef = { key: "date", label: "Date", type: "date", required: true, aliases: ["date", "dt", "bill date", "txn date", "transaction date", "visit date", "day", "invoice date", "entry date"] };
const payField: FieldDef = { key: "paymentModeId", label: "Payment Mode", type: "select", master: "paymentModes", required: true, aliases: ["payment mode", "mode", "pay mode", "payment", "paid by", "payment type", "mop", "mode of payment"] };
const grossField: FieldDef = { key: "grossAmount", label: "Amount", type: "money", required: true, aliases: ["amount", "amt", "gross", "gross amount", "fee", "fees", "charges", "bill amount", "total", "rate"] };
const discountField: FieldDef = { key: "discount", label: "Discount", type: "money", aliases: ["discount", "disc", "concession", "less", "rebate", "disc amt"] };
const netField: FieldDef = { key: "netAmount", label: "Net Amount", type: "money", importOnly: true, aliases: ["net", "net amount", "net amt", "received", "amount received", "collected", "paid", "net payable", "final amount"] };
const refField: FieldDef = { key: "reference", label: "Reference / Txn No.", type: "text", aliases: ["reference", "ref", "ref no", "txn id", "transaction id", "utr", "receipt no", "receipt", "bill no", "bill number", "transaction no"] };
const remarksField: FieldDef = { key: "remarks", label: "Remarks", type: "textarea", aliases: ["remarks", "remark", "notes", "note", "comments", "narration"] };

export const MODULES: Record<ModuleKey, ModuleDef> = {
  opd: {
    key: "opd",
    label: "OPD Consultations",
    singular: "OPD Consultation",
    perm: "opd",
    href: "/opd",
    income: true,
    fields: [
      dateField,
      ...patientFields,
      { key: "doctorId", label: "Doctor", type: "select", master: "doctors", aliases: ["doctor", "consultant", "dr", "doctor name", "consultant name", "physician"] },
      { key: "specialtyId", label: "Specialty", type: "select", master: "specialties", required: true, aliases: ["specialty", "speciality", "department", "dept", "clinic", "service"] },
      { key: "consultationTypeId", label: "Consultation Type", type: "select", master: "consultationTypes", aliases: ["consultation type", "consult", "consult type", "type", "visit category", "consultation"] },
      { key: "visitType", label: "New / Old", type: "visitType", required: true, aliases: ["new/old", "new old", "visit type", "visit", "n/o", "new or old", "patient type", "status"] },
      grossField,
      discountField,
      netField,
      payField,
      refField,
      remarksField,
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "patientCode", label: "Patient ID" },
      { key: "patientName", label: "Patient", mobile: true },
      { key: "doctor", label: "Doctor" },
      { key: "specialty", label: "Specialty", type: "badge", mobile: true },
      { key: "consultationType", label: "Type" },
      { key: "visitType", label: "New/Old", type: "badge", mobile: true },
      { key: "grossAmount", label: "Amount", type: "money" },
      { key: "discount", label: "Discount", type: "money" },
      { key: "netAmount", label: "Net", type: "money", mobile: true },
      { key: "paymentMode", label: "Mode" },
      { key: "reference", label: "Reference" },
    ],
    template: ["Date", "Patient ID", "Patient Name", "Doctor", "Specialty", "Consultation Type", "New/Old", "Amount", "Discount", "Net Amount", "Payment Mode", "Reference"],
    sample: [["01-09-2026", "DEMO-1001", "Demo Patient A", "Dr. Demo Rao", "Diabetes", "Consultation", "New", 800, 0, 800, "UPI", "UPI123456"]],
  },
  ipd: {
    key: "ipd",
    label: "IPD Admissions",
    singular: "IPD Admission",
    perm: "ipd",
    href: "/ipd",
    income: true,
    fields: [
      { ...dateField, key: "admissionDate", label: "Admission Date", aliases: [...(dateField.aliases ?? []), "admission date", "doa", "admitted on", "date of admission"] },
      { key: "dischargeDate", label: "Discharge Date", type: "date", aliases: ["discharge date", "dod", "discharged on", "date of discharge"] },
      ...patientFields,
      { key: "admissionTypeId", label: "Admission Type", type: "select", master: "admissionTypes", required: true, aliases: ["admission type", "admission", "category", "type", "admission category", "plan"] },
      { key: "doctorId", label: "Doctor", type: "select", master: "doctors", aliases: ["doctor", "consultant", "dr", "treating doctor"] },
      { key: "packageId", label: "Package", type: "select", master: "ipdPackages", aliases: ["package", "pkg", "package name", "scheme"] },
      { ...grossField, label: "Bill Amount", help: "Total billed value of the admission" },
      discountField,
      netField,
      { key: "initialPaymentType", label: "Payment Now", type: "ipdTxnType", help: "Optional: record an advance or full settlement with the admission", aliases: ["payment type", "payment status"] },
      { key: "initialPaymentAmount", label: "Amount Paid Now", type: "money", aliases: ["paid", "amount paid", "advance", "collected"] },
      { ...payField, required: false },
      refField,
      remarksField,
    ],
    columns: [
      { key: "admissionDate", label: "Admitted", type: "date", mobile: true },
      { key: "dischargeDate", label: "Discharged", type: "date" },
      { key: "patientCode", label: "Patient ID" },
      { key: "patientName", label: "Patient", mobile: true },
      { key: "admissionType", label: "Type", type: "badge", mobile: true },
      { key: "doctor", label: "Doctor" },
      { key: "package", label: "Package" },
      { key: "netAmount", label: "Billed", type: "money", mobile: true },
      { key: "collected", label: "Collected", type: "money" },
      { key: "balance", label: "Balance Due", type: "money", mobile: true },
      { key: "paymentStatus", label: "Payment", type: "badge" },
    ],
    template: ["Date", "Patient ID", "Patient Name", "Admission Type", "Doctor", "Package", "Amount", "Discount", "Net Amount", "Payment Mode"],
    sample: [["03-09-2026", "DEMO-2001", "Demo Patient B", "Sugar Control Plan", "Dr. Demo Rao", "SCP 5 Days", 45000, 5000, 40000, "Card"]],
  },
  "ipd-payment": {
    key: "ipd-payment",
    label: "IPD Payments",
    singular: "IPD Payment",
    perm: "ipd",
    href: "/ipd?tab=payments",
    income: true,
    fields: [
      { key: "admissionId", label: "Admission", type: "admission", required: true, formOnly: true },
      dateField,
      { key: "type", label: "Type", type: "ipdTxnType", required: true },
      { key: "amount", label: "Amount", type: "money", required: true },
      payField,
      refField,
      remarksField,
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "patientName", label: "Patient", mobile: true },
      { key: "admissionType", label: "Admission" },
      { key: "type", label: "Type", type: "badge", mobile: true },
      { key: "amount", label: "Amount", type: "money", mobile: true },
      { key: "paymentMode", label: "Mode" },
      { key: "reference", label: "Reference" },
    ],
    template: [],
    sample: [],
  },
  lab: {
    key: "lab",
    label: "Laboratory & Diagnostics",
    singular: "Lab Transaction",
    perm: "lab",
    href: "/lab",
    income: true,
    fields: [
      dateField,
      ...patientFields,
      { key: "investigationId", label: "Investigation", type: "select", master: "investigations", required: true, aliases: ["investigation", "test", "test name", "service", "procedure", "investigation name", "item", "particulars"] },
      { key: "quantity", label: "Quantity", type: "int", aliases: ["quantity", "qty", "count", "no of tests", "units", "nos"] },
      { key: "rate", label: "Rate", type: "money", aliases: ["rate", "price", "unit price", "mrp", "charge"] },
      discountField,
      { ...netField, aliases: [...(netField.aliases ?? []), "amount", "amt", "total"] },
      payField,
      { key: "referringDoctorId", label: "Referring Doctor", type: "select", master: "doctors", aliases: ["doctor", "referring doctor", "ref doctor", "referred by", "ref by", "dr"] },
      { key: "departmentId", label: "Department", type: "select", master: "departments", aliases: ["department", "dept", "section"] },
      refField,
      remarksField,
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "patientCode", label: "Patient ID" },
      { key: "patientName", label: "Patient", mobile: true },
      { key: "investigation", label: "Investigation", type: "badge", mobile: true },
      { key: "quantity", label: "Qty", type: "int" },
      { key: "rate", label: "Rate", type: "money" },
      { key: "discount", label: "Discount", type: "money" },
      { key: "netAmount", label: "Net", type: "money", mobile: true },
      { key: "paymentMode", label: "Mode" },
      { key: "referringDoctor", label: "Doctor" },
      { key: "department", label: "Dept" },
    ],
    template: ["Date", "Patient ID", "Patient Name", "Investigation", "Quantity", "Rate", "Discount", "Net Amount", "Payment Mode", "Doctor"],
    sample: [["02-09-2026", "DEMO-1001", "Demo Patient A", "Diabetic Profile", 1, 1500, 100, 1400, "Cash", "Dr. Demo Rao"]],
  },
  "pharmacy-sale": {
    key: "pharmacy-sale",
    label: "Pharmacy Sales",
    singular: "Pharmacy Sale",
    perm: "pharmacy",
    href: "/pharmacy",
    income: true,
    fields: [
      dateField,
      { key: "invoiceNo", label: "Invoice", type: "text", aliases: ["invoice", "invoice no", "inv no", "bill no", "bill number", "invoice number", "inv"] },
      ...patientFields,
      { ...grossField, label: "Sales Amount", aliases: ["sales", "sale", "sales amount", "sale amount", "gross sales", "amount", "amt", "bill amount"] },
      discountField,
      { key: "returnAmount", label: "Return", type: "money", importOnly: true, aliases: ["return", "returns", "sales return", "return amount", "refund"] },
      { ...netField, aliases: ["net sales", "net", "net amount", "net sale", "received", "collected"] },
      { key: "purchaseAmount", label: "Purchases", type: "money", importOnly: true, aliases: ["purchases", "purchase", "purchase amount", "stock purchase"] },
      payField,
      remarksField,
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "invoiceNo", label: "Invoice", mobile: true },
      { key: "patientName", label: "Patient" },
      { key: "grossAmount", label: "Sales", type: "money" },
      { key: "discount", label: "Discount", type: "money" },
      { key: "netAmount", label: "Net", type: "money", mobile: true },
      { key: "paymentMode", label: "Mode" },
    ],
    template: ["Date", "Invoice", "Patient", "Sales", "Discount", "Return", "Net Sales", "Purchases", "Payment Mode"],
    sample: [["04-09-2026", "PH-DEMO-0001", "Demo Patient C", 2450, 50, 0, 2400, 0, "UPI"]],
  },
  "pharmacy-return": {
    key: "pharmacy-return",
    label: "Pharmacy Returns",
    singular: "Pharmacy Return",
    perm: "pharmacy",
    href: "/pharmacy?tab=returns",
    income: true,
    fields: [
      dateField,
      { key: "invoiceNo", label: "Invoice", type: "text", aliases: ["invoice", "invoice no", "bill no"] },
      { key: "amount", label: "Return Value", type: "money", required: true, aliases: ["return", "return value", "amount", "amt", "refund"] },
      { ...payField, label: "Refund Mode" },
      { key: "reason", label: "Reason", type: "textarea", aliases: ["reason", "remarks"] },
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "invoiceNo", label: "Invoice", mobile: true },
      { key: "amount", label: "Return Value", type: "money", mobile: true },
      { key: "paymentMode", label: "Refund Mode" },
      { key: "reason", label: "Reason" },
    ],
    template: ["Date", "Invoice", "Return Value", "Payment Mode", "Reason"],
    sample: [["05-09-2026", "PH-DEMO-0001", 150, "Cash", "Unopened strip returned"]],
  },
  "pharmacy-purchase": {
    key: "pharmacy-purchase",
    label: "Pharmacy Purchases",
    singular: "Pharmacy Purchase",
    perm: "pharmacy",
    href: "/pharmacy?tab=purchases",
    income: false,
    fields: [
      dateField,
      { key: "supplier", label: "Supplier", type: "text", required: true, aliases: ["supplier", "vendor", "distributor", "party", "supplier name", "party name"] },
      { key: "invoiceNo", label: "Invoice", type: "text", aliases: ["invoice", "invoice no", "bill no", "inv no"] },
      { key: "amount", label: "Purchase Amount", type: "money", required: true, aliases: ["amount", "purchase amount", "purchases", "amt", "total", "value"] },
      { ...payField, required: false },
      remarksField,
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "supplier", label: "Supplier", mobile: true },
      { key: "invoiceNo", label: "Invoice" },
      { key: "amount", label: "Amount", type: "money", mobile: true },
      { key: "paymentMode", label: "Mode" },
    ],
    template: ["Date", "Supplier", "Invoice", "Purchase Amount", "Payment Mode", "Remarks"],
    sample: [["06-09-2026", "Demo Pharma Distributors", "DPD/2026/001", 38000, "Bank Transfer", "Monthly stock"]],
  },
  diet: {
    key: "diet",
    label: "Diet & Nutrition",
    singular: "Diet Transaction",
    perm: "diet",
    href: "/diet",
    income: true,
    fields: [
      dateField,
      ...patientFields,
      { key: "serviceId", label: "Service", type: "select", master: "dietServices", required: true, aliases: ["service", "diet service", "plan", "diet plan", "package", "particulars"] },
      { key: "dieticianId", label: "Dietician", type: "select", master: "dieticians", aliases: ["dietician", "dietitian", "nutritionist", "counsellor", "by"] },
      grossField,
      discountField,
      netField,
      payField,
      refField,
      remarksField,
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "patientName", label: "Patient", mobile: true },
      { key: "service", label: "Service", type: "badge", mobile: true },
      { key: "dietician", label: "Dietician" },
      { key: "grossAmount", label: "Amount", type: "money" },
      { key: "discount", label: "Discount", type: "money" },
      { key: "netAmount", label: "Net", type: "money", mobile: true },
      { key: "paymentMode", label: "Mode" },
    ],
    template: ["Date", "Patient ID", "Patient Name", "Service", "Dietician", "Amount", "Discount", "Net Amount", "Payment Mode"],
    sample: [["07-09-2026", "DEMO-1001", "Demo Patient A", "Diet Counselling", "Demo Dietician", 500, 0, 500, "UPI"]],
  },
  "other-income": {
    key: "other-income",
    label: "Other Income",
    singular: "Other Income",
    perm: "income",
    href: "/other-income",
    income: true,
    fields: [
      dateField,
      { key: "source", label: "Source", type: "text", required: true, aliases: ["source", "head", "income head", "particulars", "category"] },
      { key: "description", label: "Description", type: "textarea", aliases: ["description", "details", "narration"] },
      { key: "amount", label: "Amount", type: "money", required: true, aliases: ["amount", "amt", "value", "received"] },
      payField,
      refField,
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "source", label: "Source", mobile: true },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount", type: "money", mobile: true },
      { key: "paymentMode", label: "Mode" },
    ],
    template: ["Date", "Source", "Description", "Amount", "Payment Mode", "Reference"],
    sample: [["08-09-2026", "Canteen Rent", "September rent (demo)", 5000, "Bank Transfer", "NEFT-DEMO-1"]],
  },
  expense: {
    key: "expense",
    label: "Expenses",
    singular: "Expense",
    perm: "expense",
    href: "/expenses",
    income: false,
    fields: [
      dateField,
      { key: "departmentId", label: "Department", type: "select", master: "departments", aliases: ["department", "dept", "cost centre", "cost center"] },
      { key: "categoryId", label: "Category", type: "select", master: "expenseCategories", required: true, aliases: ["category", "head", "expense head", "expense category", "account", "type"] },
      { key: "subcategoryId", label: "Subcategory", type: "select", master: "expenseSubcategories", aliases: ["subcategory", "sub category", "sub head", "sub-category", "item"] },
      { key: "description", label: "Description", type: "text", required: true, aliases: ["description", "particulars", "details", "narration", "item description", "purpose"] },
      { key: "vendor", label: "Vendor / Person", type: "text", aliases: ["vendor", "person", "paid to", "party", "supplier", "payee", "vendor name"] },
      { key: "billNumber", label: "Bill Number", type: "text", aliases: ["bill number", "bill no", "invoice", "invoice no", "voucher", "voucher no", "receipt no"] },
      { key: "amount", label: "Amount", type: "money", required: true, aliases: ["amount", "amt", "expense", "value", "total", "paid", "debit"] },
      payField,
      remarksField,
      { key: "spreadMonth", label: "Spread over month", type: "text", importOnly: true, aliases: ["spread over month", "spread", "monthly expense"], help: "Yes for rent, salaries and other monthly payments: spread over the days of the month in daily figures" },
    ],
    columns: [
      { key: "date", label: "Date", type: "date", mobile: true },
      { key: "category", label: "Category", type: "badge", mobile: true },
      { key: "subcategory", label: "Subcategory" },
      { key: "description", label: "Description", mobile: true },
      { key: "department", label: "Dept" },
      { key: "vendor", label: "Vendor" },
      { key: "billNumber", label: "Bill No." },
      { key: "amount", label: "Amount", type: "money", mobile: true },
      { key: "paymentMode", label: "Mode" },
      { key: "attachments", label: "Bill", type: "int" },
    ],
    template: ["Date", "Department", "Category", "Subcategory", "Description", "Vendor", "Bill Number", "Amount", "Payment Mode", "Remarks", "Spread over month"],
    sample: [["09-09-2026", "Administration", "Stationery", "Printer paper", "A4 paper 10 reams (demo)", "Demo Stationers", "DS-101", 2600, "Cash", ""]],
  },
};

/** Import targets: all modules that have a template, plus the combined formats. */
export const IMPORT_TYPES = [
  { key: "opd", label: "OPD" },
  { key: "ipd", label: "IPD" },
  { key: "lab", label: "Laboratory" },
  { key: "pharmacy-sale", label: "Pharmacy (sales / returns / purchases)" },
  { key: "pharmacy-return", label: "Pharmacy Returns" },
  { key: "pharmacy-purchase", label: "Pharmacy Purchases" },
  { key: "diet", label: "Diet & Nutrition" },
  { key: "other-income", label: "Other Income" },
  { key: "expense", label: "Expenses" },
  { key: "combined-income", label: "Combined Income (Stream column)" },
  { key: "combined-expense", label: "Combined Expenditure (Type column)" },
  { key: "pharmacy-items", label: "Pharmacy medicine lines (sold / purchased)" },
  { key: "supplier-payments", label: "Supplier payments (against purchase invoices)" },
] as const;
export type ImportType = (typeof IMPORT_TYPES)[number]["key"];

export function isImportType(s: string): s is ImportType {
  return IMPORT_TYPES.some((t) => t.key === s);
}

/** Combined formats: each row is routed to a module by its Stream/Type column. */
export const COMBINED_INCOME_FIELDS: FieldDef[] = [
  { key: "stream", label: "Stream", type: "text", required: true, aliases: ["stream", "department", "dept", "income type", "type", "head", "section"] },
  dateField,
  ...patientFields,
  { key: "service", label: "Service / Test / Specialty", type: "text", aliases: ["service", "test", "investigation", "specialty", "particulars", "item", "description"] },
  { key: "doctor", label: "Doctor", type: "text", aliases: ["doctor", "consultant", "dr"] },
  { key: "visitType", label: "New / Old", type: "visitType", aliases: ["new/old", "visit", "visit type", "n/o"] },
  { key: "quantity", label: "Quantity", type: "int", aliases: ["qty", "quantity"] },
  grossField,
  discountField,
  netField,
  payField,
  { ...refField, aliases: [...(refField.aliases ?? []), "invoice", "invoice no"] },
];
export const COMBINED_INCOME_TEMPLATE = ["Stream", "Date", "Patient ID", "Patient Name", "Service", "Doctor", "New/Old", "Quantity", "Amount", "Discount", "Net Amount", "Payment Mode", "Reference"];
export const COMBINED_INCOME_SAMPLE = [
  ["OPD", "01-09-2026", "DEMO-1001", "Demo Patient A", "Diabetes", "Dr. Demo Rao", "New", "", 800, 0, 800, "UPI", ""],
  ["LAB", "01-09-2026", "DEMO-1001", "Demo Patient A", "ECG", "Dr. Demo Rao", "", 1, 400, 0, 400, "UPI", ""],
  ["PHARMACY", "01-09-2026", "", "Demo Patient A", "", "", "", "", 1200, 0, 1200, "Cash", "PH-DEMO-9"],
  ["DIET", "01-09-2026", "DEMO-1001", "Demo Patient A", "Diet Counselling", "", "", "", 500, 0, 500, "Cash", ""],
  ["OTHER", "01-09-2026", "", "", "Canteen Rent", "", "", "", 5000, 0, 5000, "Bank Transfer", ""],
];

export const COMBINED_EXPENSE_FIELDS: FieldDef[] = [
  { key: "expenseType", label: "Type", type: "text", aliases: ["type", "expense type", "kind", "nature"], help: "EXPENSE (default) or PHARMACY PURCHASE" },
  dateField,
  { key: "category", label: "Category", type: "text", aliases: ["category", "head", "expense head", "account"] },
  { key: "subcategory", label: "Subcategory", type: "text", aliases: ["subcategory", "sub category", "sub head"] },
  { key: "department", label: "Department", type: "text", aliases: ["department", "dept"] },
  { key: "description", label: "Description", type: "text", aliases: ["description", "particulars", "details", "narration"] },
  { key: "vendor", label: "Vendor / Supplier", type: "text", aliases: ["vendor", "supplier", "party", "paid to", "payee"] },
  { key: "billNumber", label: "Bill / Invoice No.", type: "text", aliases: ["bill number", "bill no", "invoice", "invoice no", "voucher"] },
  { key: "amount", label: "Amount", type: "money", required: true, aliases: ["amount", "amt", "value", "total", "debit", "paid"] },
  { ...payField, required: false },
  remarksField,
];
export const COMBINED_EXPENSE_TEMPLATE = ["Type", "Date", "Category", "Subcategory", "Department", "Description", "Vendor", "Bill Number", "Amount", "Payment Mode", "Remarks"];
export const COMBINED_EXPENSE_SAMPLE = [
  ["Expense", "01-09-2026", "Electricity", "", "Administration", "Electricity bill Aug (demo)", "TSSPDCL (demo)", "EB-0901", 42000, "Bank Transfer", ""],
  ["Pharmacy Purchase", "01-09-2026", "", "", "", "Stock purchase", "Demo Pharma Distributors", "DPD/2026/009", 38000, "Bank Transfer", ""],
];

/**
 * Medicine-level lines for pharmacy analytics (units sold, margin, purchases by supplier).
 * Not accounting records — see PharmacyItemLine in the schema.
 */
export const PHARMACY_ITEM_FIELDS: FieldDef[] = [
  { key: "kind", label: "Sale / Purchase", type: "text", required: true, aliases: ["type", "kind", "sale purchase", "transaction type"], help: "SALE or PURCHASE" },
  dateField,
  { key: "docNo", label: "Bill / Invoice No.", type: "text", aliases: ["bill no", "bill number", "invoice", "invoice no", "inv no"] },
  { key: "item", label: "Medicine", type: "text", required: true, aliases: ["drug", "drug name", "medicine", "item", "item name", "product", "product name"] },
  { key: "batchNo", label: "Batch", type: "text", aliases: ["batch", "batch no"] },
  { key: "expiry", label: "Expiry", type: "text", aliases: ["expiry", "expiry by", "exp", "expiry date"] },
  { key: "supplier", label: "Supplier", type: "text", aliases: ["supplier", "stockist", "stockiest name", "distributor", "vendor"] },
  { key: "manufacturer", label: "Manufacturer", type: "text", aliases: ["manufacturer", "mfg", "mfg name", "company"] },
  { key: "qty", label: "Quantity (units)", type: "int", required: true, aliases: ["qty", "quantity", "units"] },
  { key: "freeQty", label: "Free units", type: "int", aliases: ["free qty", "free", "free units"] },
  { key: "amount", label: "Amount incl. GST", type: "money", required: true, aliases: ["total", "amount", "net amount", "value"] },
  { key: "taxable", label: "Taxable amount", type: "money", aliases: ["taxable", "sales amount", "net value", "taxable value"] },
  { key: "tax", label: "GST", type: "money", aliases: ["tax", "gst", "sales tax", "tax amount"] },
  { key: "cost", label: "Cost of units sold (ex-GST)", type: "money", aliases: ["cost", "purchase amount", "cost amount"] },
];
export const PHARMACY_ITEM_TEMPLATE = ["Type", "Date", "Bill / Invoice No.", "Medicine", "Batch", "Expiry", "Supplier", "Manufacturer", "Quantity", "Free Qty", "Amount", "Taxable", "GST", "Cost"];
export const PHARMACY_ITEM_SAMPLE = [
  ["Sale", "01-09-2026", "PH-DEMO-1", "TAB DEMO 500MG", "B123", "", "", "", 30, 0, 315, 300, 15, 190],
  ["Purchase", "01-09-2026", "INV-DEMO-9", "TAB DEMO 500MG", "B123", "Dec-2027", "Demo Distributors", "Demo Pharma", 300, 30, 2100, 2000, 100, ""],
];

/** Payments to pharmacy suppliers. Not an expense (purchases already are); used for open invoices. */
export const SUPPLIER_PAYMENT_FIELDS: FieldDef[] = [
  dateField,
  { key: "supplier", label: "Supplier", type: "text", required: true, aliases: ["supplier", "stockist", "stockiest name", "vendor", "party", "paid to"] },
  { key: "reference", label: "Cheque / UTR No.", type: "text", aliases: ["cheque no", "utr", "reference", "ref no", "voucher", "bill no", "billno"] },
  { key: "invoices", label: "Invoices paid (comma-separated)", type: "text", aliases: ["invoices", "invoice no", "invoice numbers"] },
  { key: "details", label: "Details", type: "text", aliases: ["details", "narration", "remarks", "particulars"], help: 'OneGlance format "cheque,INVOICE NO A1,A2" is parsed automatically' },
  { key: "amount", label: "Amount paid", type: "money", required: true, aliases: ["paid amount", "amount", "amount paid", "paid"] },
];
export const SUPPLIER_PAYMENT_TEMPLATE = ["Date", "Supplier", "Cheque / UTR No.", "Invoices paid", "Amount paid"];
export const SUPPLIER_PAYMENT_SAMPLE = [["05-09-2026", "Demo Distributors", "UTR-DEMO-1", "INV-DEMO-9, INV-DEMO-10", 42000]];

export function importFieldsFor(type: ImportType): FieldDef[] {
  if (type === "supplier-payments") return SUPPLIER_PAYMENT_FIELDS;
  if (type === "pharmacy-items") return PHARMACY_ITEM_FIELDS;
  if (type === "combined-income") return COMBINED_INCOME_FIELDS;
  if (type === "combined-expense") return COMBINED_EXPENSE_FIELDS;
  return MODULES[type].fields.filter((f) => !f.formOnly);
}

export function templateFor(type: ImportType): { headers: string[]; sample: (string | number)[][] } {
  if (type === "pharmacy-items") return { headers: PHARMACY_ITEM_TEMPLATE, sample: PHARMACY_ITEM_SAMPLE };
  if (type === "supplier-payments") return { headers: SUPPLIER_PAYMENT_TEMPLATE, sample: SUPPLIER_PAYMENT_SAMPLE };
  if (type === "combined-income") return { headers: COMBINED_INCOME_TEMPLATE, sample: COMBINED_INCOME_SAMPLE };
  if (type === "combined-expense") return { headers: COMBINED_EXPENSE_TEMPLATE, sample: COMBINED_EXPENSE_SAMPLE };
  const m = MODULES[type];
  return { headers: m.template, sample: m.sample };
}

export function viewPerm(m: ModuleKey): PermissionCode {
  return `${MODULES[m].perm}.view` as PermissionCode;
}
export function writePerm(m: ModuleKey): PermissionCode {
  return `${MODULES[m].perm}.write` as PermissionCode;
}
