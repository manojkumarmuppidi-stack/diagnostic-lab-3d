/**
 * Server-side persistence adapters for every transaction module.
 * Each adapter turns validated input into Prisma data (resolving patients, computing
 * net amounts from master rates, building the duplicate fingerprint) and maps DB rows
 * into flat rows for the UI / exports.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Prisma } from "@prisma/client";
import { fromDbDate, toDbDate, type ISODate } from "@/lib/dates";
import { fingerprintKey } from "@/lib/import/fingerprint";
import { MODULE_SCHEMAS, type ModuleInput } from "@/lib/schemas";
import type { ModuleKey } from "@/lib/modules";
import { maskName } from "@/lib/permissions";
import { round2, toNum } from "@/lib/money";
import { ipdBalance } from "@/lib/accounting";
import type { Tx } from "../db";
import { badRequest } from "../errors";
import { bulkCache } from "../bulk-cache";

export interface Built {
  data: Record<string, any>;
  /** Business date the row belongs to (drives day locking). */
  date: ISODate;
  fingerprint: string;
  amount: number;
  /** Extra rows to create after the main one (e.g. IPD initial payment). */
  after?: (tx: Tx, created: { id: string }, meta: { createdById: string; importBatchId?: string | null }) => Promise<void>;
}

export interface ListFilters {
  from?: string;
  to?: string;
  q?: string;
  status?: "ACTIVE" | "ALL";
  [key: string]: string | undefined;
}

export interface Adapter {
  key: ModuleKey;
  entityType: string; // Prisma model name (also used in audit log)
  delegate: (tx: Tx) => any;
  dateField: "date" | "admissionDate";
  amountField: "netAmount" | "amount";
  build: (tx: Tx, input: any) => Promise<Built>;
  include?: Record<string, any>;
  toRow: (r: any, opts: { mask: boolean }) => Record<string, unknown>;
  searchWhere: (q: string) => Prisma.JsonObject[] | any[];
  filterWhere: (f: ListFilters) => Record<string, unknown>;
  /** Columns summed into the list footer. */
  sumFields: string[];
}

// ─────────────────────────── helpers ───────────────────────────

async function resolvePatient(tx: Tx, code?: string, name?: string): Promise<{ patientId: string | null; patientName: string | null }> {
  const cleanName = name?.trim() || null;
  const cleanCode = code?.trim().toUpperCase() || null;
  if (!cleanCode) return { patientId: null, patientName: cleanName };
  const cache = bulkCache();
  const hit = cache?.patients.get(cleanCode);
  if (hit) return { patientId: hit.id, patientName: cleanName ?? hit.name };
  const existing = await tx.patient.findUnique({ where: { patientCode: cleanCode } });
  const row = existing ?? (await tx.patient.create({ data: { patientCode: cleanCode, name: cleanName ?? cleanCode } }));
  cache?.patients.set(cleanCode, { id: row.id, name: row.name });
  return { patientId: row.id, patientName: cleanName ?? row.name };
}

async function ensure(model: any, id: string | undefined | null, label: string) {
  if (!id) return null;
  const cache = bulkCache();
  const key = `${label}:${id}`;
  if (cache?.rows.has(key)) return cache.rows.get(key) as any;
  const row = await model.findUnique({ where: { id } });
  if (!row) throw badRequest(`${label} not found`, { field: label });
  cache?.rows.set(key, row);
  return row;
}

const name = (r: any) => r?.name ?? null;
const d = (v: Date | null | undefined) => (v ? fromDbDate(v) : null);

function common(r: any, mask: boolean) {
  return {
    id: r.id,
    status: r.status,
    patientCode: r.patient?.patientCode ?? null,
    patientName: mask ? maskName(r.patientName) : r.patientName ?? null,
    paymentMode: r.paymentMode?.name ?? null,
    paymentModeId: r.paymentModeId ?? null,
    reference: r.reference ?? null,
    remarks: r.remarks ?? null,
    importBatchId: r.importBatchId ?? null,
    correctionOfId: r.correctionOfId ?? null,
    voidReason: r.voidReason ?? null,
    createdAt: r.createdAt,
  };
}

function dateRange(field: string, f: ListFilters) {
  const w: Record<string, Date> = {};
  if (f.from) w.gte = toDbDate(f.from);
  if (f.to) w.lte = toDbDate(f.to);
  return Object.keys(w).length ? { [field]: w } : {};
}

function eq(f: ListFilters, ...keys: string[]) {
  const w: Record<string, string> = {};
  for (const k of keys) if (f[k]) w[k] = f[k]!;
  return w;
}

function modeGroup(f: ListFilters) {
  return f.reconGroup ? { paymentMode: { reconGroup: f.reconGroup } } : {};
}

const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });

const baseInclude = { patient: { select: { patientCode: true } }, paymentMode: { select: { name: true, reconGroup: true } } };

/**
 * Duplicate fingerprint for a validated input. Shared by manual entry and import
 * validation so both detect the same duplicates. `net` is the computed net amount.
 */
export function fingerprintFor(module: ModuleKey, input: any, net: number): string {
  const patient = input.patientCode || input.patientName || null;
  switch (module) {
    case "opd":
      return fingerprintKey({ module, date: input.date, patient, reference: input.reference, service: input.specialtyId, amount: net });
    case "ipd":
      return fingerprintKey({ module, date: input.admissionDate, patient, reference: input.reference, service: input.admissionTypeId, amount: net });
    case "ipd-payment":
      return fingerprintKey({ module, date: input.date, patient: input.admissionId, reference: input.reference, service: input.type, amount: net });
    case "lab":
      return fingerprintKey({ module, date: input.date, patient, reference: input.reference, service: input.investigationId, amount: net });
    case "pharmacy-sale":
      return fingerprintKey({ module, date: input.date, patient, reference: input.invoiceNo, service: null, amount: net });
    case "pharmacy-return":
      return fingerprintKey({ module, date: input.date, patient: null, reference: input.invoiceNo, service: null, amount: net });
    case "pharmacy-purchase":
      return fingerprintKey({ module, date: input.date, patient: input.supplier, reference: input.invoiceNo, service: null, amount: net });
    case "diet":
      return fingerprintKey({ module, date: input.date, patient, reference: input.reference, service: input.serviceId, amount: net });
    case "other-income":
      return fingerprintKey({ module, date: input.date, patient: input.source, reference: input.reference, service: null, amount: net });
    case "expense":
      return fingerprintKey({ module, date: input.date, patient: input.vendor, reference: input.billNumber, service: input.categoryId, amount: net });
  }
}

// ─────────────────────────── adapters ───────────────────────────

const opd: Adapter = {
  key: "opd",
  entityType: "Consultation",
  delegate: (tx) => tx.consultation,
  dateField: "date",
  amountField: "netAmount",
  sumFields: ["grossAmount", "discount", "netAmount"],
  include: { ...baseInclude, doctor: true, specialty: true, consultationType: true },
  async build(tx, input: ModuleInput<"opd">) {
    await ensure(tx.specialty, input.specialtyId, "Specialty");
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    await ensure(tx.doctor, input.doctorId, "Doctor");
    await ensure(tx.consultationType, input.consultationTypeId, "Consultation type");
    const p = await resolvePatient(tx, input.patientCode, input.patientName);
    const discount = input.discount ?? 0;
    const net = round2(input.grossAmount - discount);
    return {
      date: input.date,
      amount: net,
      fingerprint: fingerprintFor("opd", input, net),
      data: {
        date: toDbDate(input.date),
        ...p,
        doctorId: input.doctorId ?? null,
        specialtyId: input.specialtyId,
        consultationTypeId: input.consultationTypeId ?? null,
        visitType: input.visitType,
        grossAmount: input.grossAmount,
        discount,
        netAmount: net,
        paymentModeId: input.paymentModeId,
        reference: input.reference ?? null,
        remarks: input.remarks ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({
    ...common(r, mask),
    date: d(r.date),
    doctor: name(r.doctor),
    doctorId: r.doctorId,
    specialty: name(r.specialty),
    specialtyId: r.specialtyId,
    consultationType: name(r.consultationType),
    consultationTypeId: r.consultationTypeId,
    visitType: r.visitType,
    grossAmount: toNum(r.grossAmount),
    discount: toNum(r.discount),
    netAmount: toNum(r.netAmount),
  }),
  searchWhere: (q) => [{ patientName: ci(q) }, { reference: ci(q) }, { patient: { patientCode: ci(q) } }, { doctor: { name: ci(q) } }],
  filterWhere: (f) => ({ ...dateRange("date", f), ...eq(f, "doctorId", "specialtyId", "consultationTypeId", "visitType", "paymentModeId", "importBatchId"), ...modeGroup(f) }),
};

const ipd: Adapter = {
  key: "ipd",
  entityType: "IpdAdmission",
  delegate: (tx) => tx.ipdAdmission,
  dateField: "admissionDate",
  amountField: "netAmount",
  sumFields: ["grossAmount", "discount", "netAmount", "collected", "balance"],
  include: {
    patient: { select: { patientCode: true } },
    admissionType: true,
    doctor: true,
    package: true,
    transactions: { where: { status: "ACTIVE" }, select: { type: true, amount: true } },
  },
  async build(tx, input: ModuleInput<"ipd">) {
    await ensure(tx.admissionType, input.admissionTypeId, "Admission type");
    await ensure(tx.doctor, input.doctorId, "Doctor");
    const pkg = await ensure(tx.ipdPackage, input.packageId, "Package");
    if (input.paymentModeId) await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    const p = await resolvePatient(tx, input.patientCode, input.patientName);
    const gross = input.grossAmount || (pkg ? toNum(pkg.rate) : 0);
    const discount = input.discount ?? 0;
    if (discount > gross) throw badRequest("Discount cannot exceed amount");
    const net = round2(gross - discount);
    const payAmt = input.initialPaymentAmount ?? 0;
    return {
      date: input.admissionDate,
      amount: net,
      fingerprint: fingerprintFor("ipd", input, net),
      data: {
        admissionDate: toDbDate(input.admissionDate),
        dischargeDate: input.dischargeDate ? toDbDate(input.dischargeDate) : null,
        ...p,
        admissionTypeId: input.admissionTypeId,
        doctorId: input.doctorId ?? null,
        packageId: input.packageId ?? null,
        grossAmount: gross,
        discount,
        netAmount: net,
        reference: input.reference ?? null,
        remarks: input.remarks ?? null,
      },
      after:
        payAmt > 0 && input.initialPaymentType
          ? async (tx2, created, meta) => {
              await tx2.ipdTransaction.create({
                data: {
                  admissionId: created.id,
                  date: toDbDate(input.admissionDate),
                  type: input.initialPaymentType!,
                  amount: payAmt,
                  paymentModeId: input.paymentModeId ?? null,
                  reference: input.reference ?? null,
                  fingerprint: fingerprintKey({ module: "ipd-payment", date: input.admissionDate, patient: created.id, reference: input.reference, service: input.initialPaymentType, amount: payAmt }),
                  createdById: meta.createdById,
                  importBatchId: meta.importBatchId ?? null,
                },
              });
            }
          : undefined,
    };
  },
  toRow: (r, { mask }) => {
    const sums = { advances: 0, payments: 0, refunds: 0 };
    for (const t of r.transactions ?? []) {
      const a = toNum(t.amount);
      if (t.type === "ADVANCE") sums.advances += a;
      else if (t.type === "REFUND") sums.refunds += a;
      else sums.payments += a;
    }
    const bal = ipdBalance({ billed: toNum(r.netAmount), ...sums });
    return {
      ...common(r, mask),
      admissionDate: d(r.admissionDate),
      date: d(r.admissionDate),
      dischargeDate: d(r.dischargeDate),
      admissionType: name(r.admissionType),
      admissionTypeId: r.admissionTypeId,
      doctor: name(r.doctor),
      doctorId: r.doctorId,
      package: name(r.package),
      packageId: r.packageId,
      grossAmount: toNum(r.grossAmount),
      discount: toNum(r.discount),
      netAmount: toNum(r.netAmount),
      advances: round2(sums.advances),
      collected: bal.collected,
      balance: bal.balance,
      paymentStatus: bal.status,
    };
  },
  searchWhere: (q) => [{ patientName: ci(q) }, { reference: ci(q) }, { patient: { patientCode: ci(q) } }],
  filterWhere: (f) => ({
    ...dateRange("admissionDate", f),
    ...eq(f, "doctorId", "admissionTypeId", "packageId", "importBatchId"),
    ...(f.open === "1" ? { dischargeDate: null } : {}),
  }),
};

const ipdPayment: Adapter = {
  key: "ipd-payment",
  entityType: "IpdTransaction",
  delegate: (tx) => tx.ipdTransaction,
  dateField: "date",
  amountField: "amount",
  sumFields: ["amount", "signedAmount"],
  include: {
    paymentMode: { select: { name: true, reconGroup: true } },
    admission: { include: { admissionType: true, patient: { select: { patientCode: true } } } },
  },
  async build(tx, input: ModuleInput<"ipd-payment">) {
    const adm = await tx.ipdAdmission.findUnique({ where: { id: input.admissionId }, include: { transactions: { where: { status: "ACTIVE" } } } });
    if (!adm || adm.status !== "ACTIVE") throw badRequest("Admission not found or no longer active");
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    if (input.date < fromDbDate(adm.admissionDate)) throw badRequest("Payment date cannot be before the admission date");
    if (input.type === "REFUND") {
      const collected = adm.transactions.reduce((s, t) => s + (t.type === "REFUND" ? -toNum(t.amount) : toNum(t.amount)), 0);
      if (input.amount > round2(collected)) throw badRequest(`Refund (${input.amount}) exceeds amount collected (${round2(collected)})`);
    }
    return {
      date: input.date,
      amount: input.amount,
      fingerprint: fingerprintFor("ipd-payment", input, input.amount),
      data: {
        admissionId: input.admissionId,
        date: toDbDate(input.date),
        type: input.type,
        amount: input.amount,
        paymentModeId: input.paymentModeId,
        reference: input.reference ?? null,
        remarks: input.remarks ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({
    ...common(r, mask),
    patientCode: r.admission?.patient?.patientCode ?? null,
    patientName: mask ? maskName(r.admission?.patientName) : r.admission?.patientName ?? null,
    admissionId: r.admissionId,
    admissionType: r.admission?.admissionType?.name ?? null,
    date: d(r.date),
    type: r.type,
    amount: toNum(r.amount),
    signedAmount: r.type === "REFUND" ? -toNum(r.amount) : toNum(r.amount),
  }),
  searchWhere: (q) => [{ reference: ci(q) }, { admission: { patientName: ci(q) } }, { admission: { patient: { patientCode: ci(q) } } }],
  filterWhere: (f) => ({ ...dateRange("date", f), ...eq(f, "admissionId", "type", "paymentModeId", "importBatchId"), ...modeGroup(f) }),
};

const lab: Adapter = {
  key: "lab",
  entityType: "LabTransaction",
  delegate: (tx) => tx.labTransaction,
  dateField: "date",
  amountField: "netAmount",
  sumFields: ["quantity", "grossAmount", "discount", "netAmount"],
  include: { ...baseInclude, investigation: true, referringDoctor: true, department: true },
  async build(tx, input: ModuleInput<"lab">) {
    const inv = await ensure(tx.labInvestigation, input.investigationId, "Investigation");
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    await ensure(tx.doctor, input.referringDoctorId, "Referring doctor");
    await ensure(tx.department, input.departmentId, "Department");
    const p = await resolvePatient(tx, input.patientCode, input.patientName);
    const rate = input.rate ?? toNum(inv.rate); // master rate by default — never hard-coded
    const gross = round2(rate * input.quantity);
    const discount = input.discount ?? 0;
    if (discount > gross) throw badRequest("Discount cannot exceed amount", { discount: "Discount cannot exceed amount" });
    const net = round2(gross - discount);
    return {
      date: input.date,
      amount: net,
      fingerprint: fingerprintFor("lab", input, net),
      data: {
        date: toDbDate(input.date),
        ...p,
        investigationId: input.investigationId,
        quantity: input.quantity,
        rate,
        grossAmount: gross,
        discount,
        netAmount: net,
        paymentModeId: input.paymentModeId,
        referringDoctorId: input.referringDoctorId ?? null,
        departmentId: input.departmentId ?? inv.departmentId ?? null,
        reference: input.reference ?? null,
        remarks: input.remarks ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({
    ...common(r, mask),
    date: d(r.date),
    investigation: name(r.investigation),
    investigationId: r.investigationId,
    quantity: r.quantity,
    rate: toNum(r.rate),
    grossAmount: toNum(r.grossAmount),
    discount: toNum(r.discount),
    netAmount: toNum(r.netAmount),
    referringDoctor: name(r.referringDoctor),
    referringDoctorId: r.referringDoctorId,
    department: name(r.department),
    departmentId: r.departmentId,
  }),
  searchWhere: (q) => [{ patientName: ci(q) }, { reference: ci(q) }, { patient: { patientCode: ci(q) } }, { investigation: { name: ci(q) } }],
  filterWhere: (f) => ({
    ...dateRange("date", f),
    ...eq(f, "investigationId", "departmentId", "paymentModeId", "importBatchId"),
    ...(f.doctorId ? { referringDoctorId: f.doctorId } : {}),
    ...(f.category ? { investigation: { category: f.category } } : {}),
    ...modeGroup(f),
  }),
};

const pharmacySale: Adapter = {
  key: "pharmacy-sale",
  entityType: "PharmacySale",
  delegate: (tx) => tx.pharmacySale,
  dateField: "date",
  amountField: "netAmount",
  sumFields: ["grossAmount", "discount", "netAmount"],
  include: baseInclude,
  async build(tx, input: ModuleInput<"pharmacy-sale">) {
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    const p = await resolvePatient(tx, input.patientCode, input.patientName);
    const discount = input.discount ?? 0;
    const net = round2(input.grossAmount - discount);
    return {
      date: input.date,
      amount: net,
      fingerprint: fingerprintFor("pharmacy-sale", input, net),
      data: {
        date: toDbDate(input.date),
        invoiceNo: input.invoiceNo ?? null,
        ...p,
        grossAmount: input.grossAmount,
        discount,
        netAmount: net,
        paymentModeId: input.paymentModeId,
        remarks: input.remarks ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({
    ...common(r, mask),
    date: d(r.date),
    invoiceNo: r.invoiceNo,
    grossAmount: toNum(r.grossAmount),
    discount: toNum(r.discount),
    netAmount: toNum(r.netAmount),
  }),
  searchWhere: (q) => [{ patientName: ci(q) }, { invoiceNo: ci(q) }, { patient: { patientCode: ci(q) } }],
  filterWhere: (f) => ({ ...dateRange("date", f), ...eq(f, "paymentModeId", "importBatchId"), ...modeGroup(f) }),
};

const pharmacyReturn: Adapter = {
  key: "pharmacy-return",
  entityType: "PharmacyReturn",
  delegate: (tx) => tx.pharmacyReturn,
  dateField: "date",
  amountField: "amount",
  sumFields: ["amount"],
  include: { paymentMode: { select: { name: true, reconGroup: true } } },
  async build(tx, input: ModuleInput<"pharmacy-return">) {
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    return {
      date: input.date,
      amount: input.amount,
      fingerprint: fingerprintFor("pharmacy-return", input, input.amount),
      data: {
        date: toDbDate(input.date),
        invoiceNo: input.invoiceNo ?? null,
        amount: input.amount,
        paymentModeId: input.paymentModeId,
        reason: input.reason ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({ ...common(r, mask), date: d(r.date), invoiceNo: r.invoiceNo, amount: toNum(r.amount), reason: r.reason }),
  searchWhere: (q) => [{ invoiceNo: ci(q) }, { reason: ci(q) }],
  filterWhere: (f) => ({ ...dateRange("date", f), ...eq(f, "paymentModeId", "importBatchId"), ...modeGroup(f) }),
};

const pharmacyPurchase: Adapter = {
  key: "pharmacy-purchase",
  entityType: "PharmacyPurchase",
  delegate: (tx) => tx.pharmacyPurchase,
  dateField: "date",
  amountField: "amount",
  sumFields: ["amount"],
  include: { paymentMode: { select: { name: true, reconGroup: true } } },
  async build(tx, input: ModuleInput<"pharmacy-purchase">) {
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    return {
      date: input.date,
      amount: input.amount,
      fingerprint: fingerprintFor("pharmacy-purchase", input, input.amount),
      data: {
        date: toDbDate(input.date),
        supplier: input.supplier,
        invoiceNo: input.invoiceNo ?? null,
        amount: input.amount,
        paymentModeId: input.paymentModeId ?? null,
        remarks: input.remarks ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({ ...common(r, mask), date: d(r.date), supplier: r.supplier, invoiceNo: r.invoiceNo, amount: toNum(r.amount) }),
  searchWhere: (q) => [{ supplier: ci(q) }, { invoiceNo: ci(q) }],
  filterWhere: (f) => ({ ...dateRange("date", f), ...eq(f, "paymentModeId", "importBatchId"), ...modeGroup(f) }),
};

const diet: Adapter = {
  key: "diet",
  entityType: "DietTransaction",
  delegate: (tx) => tx.dietTransaction,
  dateField: "date",
  amountField: "netAmount",
  sumFields: ["grossAmount", "discount", "netAmount"],
  include: { ...baseInclude, service: true, dietician: true },
  async build(tx, input: ModuleInput<"diet">) {
    await ensure(tx.dietService, input.serviceId, "Service");
    await ensure(tx.doctor, input.dieticianId, "Dietician");
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    const p = await resolvePatient(tx, input.patientCode, input.patientName);
    const discount = input.discount ?? 0;
    const net = round2(input.grossAmount - discount);
    return {
      date: input.date,
      amount: net,
      fingerprint: fingerprintFor("diet", input, net),
      data: {
        date: toDbDate(input.date),
        ...p,
        serviceId: input.serviceId,
        dieticianId: input.dieticianId ?? null,
        grossAmount: input.grossAmount,
        discount,
        netAmount: net,
        paymentModeId: input.paymentModeId,
        reference: input.reference ?? null,
        remarks: input.remarks ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({
    ...common(r, mask),
    date: d(r.date),
    service: name(r.service),
    serviceId: r.serviceId,
    dietician: name(r.dietician),
    dieticianId: r.dieticianId,
    grossAmount: toNum(r.grossAmount),
    discount: toNum(r.discount),
    netAmount: toNum(r.netAmount),
  }),
  searchWhere: (q) => [{ patientName: ci(q) }, { reference: ci(q) }, { patient: { patientCode: ci(q) } }],
  filterWhere: (f) => ({ ...dateRange("date", f), ...eq(f, "serviceId", "dieticianId", "paymentModeId", "importBatchId"), ...modeGroup(f) }),
};

const otherIncome: Adapter = {
  key: "other-income",
  entityType: "OtherIncome",
  delegate: (tx) => tx.otherIncome,
  dateField: "date",
  amountField: "amount",
  sumFields: ["amount"],
  include: { paymentMode: { select: { name: true, reconGroup: true } } },
  async build(tx, input: ModuleInput<"other-income">) {
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    return {
      date: input.date,
      amount: input.amount,
      fingerprint: fingerprintFor("other-income", input, input.amount),
      data: {
        date: toDbDate(input.date),
        source: input.source,
        description: input.description ?? null,
        amount: input.amount,
        paymentModeId: input.paymentModeId,
        reference: input.reference ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({ ...common(r, mask), date: d(r.date), source: r.source, description: r.description, amount: toNum(r.amount) }),
  searchWhere: (q) => [{ source: ci(q) }, { description: ci(q) }, { reference: ci(q) }],
  filterWhere: (f) => ({ ...dateRange("date", f), ...eq(f, "paymentModeId", "importBatchId"), ...modeGroup(f) }),
};

const expense: Adapter = {
  key: "expense",
  entityType: "Expense",
  delegate: (tx) => tx.expense,
  dateField: "date",
  amountField: "amount",
  sumFields: ["amount"],
  include: {
    paymentMode: { select: { name: true, reconGroup: true } },
    department: true,
    category: true,
    subcategory: true,
    _count: { select: { attachments: true } },
  },
  async build(tx, input: ModuleInput<"expense">) {
    const cat = await ensure(tx.expenseCategory, input.categoryId, "Category");
    if (cat.parentId) throw badRequest("Choose a top-level category (subcategories go in the Subcategory field)");
    const sub = await ensure(tx.expenseCategory, input.subcategoryId, "Subcategory");
    if (sub && sub.parentId !== cat.id) throw badRequest(`Subcategory "${sub.name}" does not belong to "${cat.name}"`);
    await ensure(tx.department, input.departmentId, "Department");
    await ensure(tx.paymentMode, input.paymentModeId, "Payment mode");
    return {
      date: input.date,
      amount: input.amount,
      fingerprint: fingerprintFor("expense", input, input.amount),
      data: {
        date: toDbDate(input.date),
        departmentId: input.departmentId ?? null,
        categoryId: input.categoryId,
        subcategoryId: input.subcategoryId ?? null,
        description: input.description,
        vendor: input.vendor ?? null,
        billNumber: input.billNumber ?? null,
        amount: input.amount,
        paymentModeId: input.paymentModeId,
        remarks: input.remarks ?? null,
        headId: input.headId ?? null,
      },
    };
  },
  toRow: (r, { mask }) => ({
    ...common(r, mask),
    date: d(r.date),
    department: name(r.department),
    departmentId: r.departmentId,
    category: name(r.category),
    categoryId: r.categoryId,
    categoryGroup: r.category?.group ?? null,
    subcategory: name(r.subcategory),
    subcategoryId: r.subcategoryId,
    description: r.description,
    vendor: r.vendor,
    billNumber: r.billNumber,
    amount: toNum(r.amount),
    attachments: r._count?.attachments ?? 0,
  }),
  searchWhere: (q) => [{ description: ci(q) }, { vendor: ci(q) }, { billNumber: ci(q) }, { category: { name: ci(q) } }],
  filterWhere: (f) => ({
    ...dateRange("date", f),
    ...eq(f, "categoryId", "subcategoryId", "departmentId", "paymentModeId", "importBatchId"),
    ...(f.group ? { category: { group: f.group } } : {}),
    ...modeGroup(f),
  }),
};

export const ADAPTERS: Record<ModuleKey, Adapter> = {
  opd,
  ipd,
  "ipd-payment": ipdPayment,
  lab,
  "pharmacy-sale": pharmacySale,
  "pharmacy-return": pharmacyReturn,
  "pharmacy-purchase": pharmacyPurchase,
  diet,
  "other-income": otherIncome,
  expense,
};

export function parseInput<K extends ModuleKey>(module: K, raw: unknown): ModuleInput<K> {
  return MODULE_SCHEMAS[module].parse(raw) as ModuleInput<K>;
}

/** Turn a stored row back into form input (used to prefill a correction). */
export function rowToInput(module: ModuleKey, row: Record<string, any>): Record<string, unknown> {
  const pick = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? ""]));
  switch (module) {
    case "opd":
      return pick("date", "patientCode", "patientName", "doctorId", "specialtyId", "consultationTypeId", "visitType", "grossAmount", "discount", "paymentModeId", "reference", "remarks");
    case "ipd":
      return pick("admissionDate", "dischargeDate", "patientCode", "patientName", "admissionTypeId", "doctorId", "packageId", "grossAmount", "discount", "reference", "remarks");
    case "ipd-payment":
      return pick("admissionId", "date", "type", "amount", "paymentModeId", "reference", "remarks");
    case "lab":
      return pick("date", "patientCode", "patientName", "investigationId", "quantity", "rate", "discount", "paymentModeId", "referringDoctorId", "departmentId", "reference", "remarks");
    case "pharmacy-sale":
      return pick("date", "invoiceNo", "patientCode", "patientName", "grossAmount", "discount", "paymentModeId", "remarks");
    case "pharmacy-return":
      return pick("date", "invoiceNo", "amount", "paymentModeId", "reason");
    case "pharmacy-purchase":
      return pick("date", "supplier", "invoiceNo", "amount", "paymentModeId", "remarks");
    case "diet":
      return pick("date", "patientCode", "patientName", "serviceId", "dieticianId", "grossAmount", "discount", "paymentModeId", "reference", "remarks");
    case "other-income":
      return pick("date", "source", "description", "amount", "paymentModeId", "reference");
    case "expense":
      return pick("date", "departmentId", "categoryId", "subcategoryId", "description", "vendor", "billNumber", "amount", "paymentModeId", "remarks");
  }
}
