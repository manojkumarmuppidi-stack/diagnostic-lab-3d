/**
 * Row normalisation for imports: raw spreadsheet row + column mapping + master data
 * → validated module input, with errors (block import) and warnings (need approval).
 * Pure function (no DB) — unit tested in tests/unit/import-normalize.test.ts.
 */
import type { ISODate } from "../dates";
import type { ImportType, ModuleKey } from "../modules";
import { round2 } from "../money";
import type { Mapping } from "./mapping";
import { matchByName, norm, type NamedItem } from "./text";
import {
  parseAmount,
  parseDate,
  parseInteger,
  parseIpdTxnType,
  parsePaymentMode,
  parseStream,
  parseVisitType,
  type ModeLike,
} from "./values";

export type NewMasterType =
  | "specialties"
  | "doctors"
  | "dieticians"
  | "consultationTypes"
  | "admissionTypes"
  | "ipdPackages"
  | "investigations"
  | "dietServices"
  | "departments"
  | "expenseCategories"
  | "expenseSubcategories";

export interface MasterCtx {
  specialties: NamedItem[];
  doctors: NamedItem[];
  dieticians: NamedItem[];
  consultationTypes: NamedItem[];
  admissionTypes: NamedItem[];
  ipdPackages: (NamedItem & { rate: number })[];
  investigations: (NamedItem & { rate: number })[];
  dietServices: NamedItem[];
  departments: NamedItem[];
  categories: (NamedItem & { group: string })[];
  subcategories: (NamedItem & { parentId: string })[];
  paymentModes: ModeLike[];
  today: ISODate;
}

export type Flag =
  | "missingDate"
  | "missingAmount"
  | "unknownService"
  | "unknownCategory"
  | "invalidPaymentMode"
  | "totalsRow"
  | "negative";

export interface NormalizedRow {
  module: ModuleKey | null;
  input: Record<string, unknown> | null;
  extras: { module: ModuleKey; input: Record<string, unknown> }[];
  errors: string[];
  warnings: string[];
  flags: Flag[];
  /** Net amount of the main record (for batch totals). */
  amount: number;
}

export const NEW_PREFIX = "__new__:";
export const placeholder = (type: NewMasterType, name: string, parent?: string) =>
  `${NEW_PREFIX}${type}:${name.trim()}${parent ? `::${parent}` : ""}`;
export function parsePlaceholder(v: unknown): { type: NewMasterType; name: string; parent?: string } | null {
  if (typeof v !== "string" || !v.startsWith(NEW_PREFIX)) return null;
  const rest = v.slice(NEW_PREFIX.length);
  const i = rest.indexOf(":");
  const [name, parent] = rest.slice(i + 1).split("::");
  return { type: rest.slice(0, i) as NewMasterType, name, parent };
}

const TOTAL_WORDS = new Set(["total", "grand total", "sub total", "subtotal", "totals", "net total", "day total", "total amount"]);

class RowBuilder {
  errors: string[] = [];
  warnings: string[] = [];
  flags = new Set<Flag>();
  constructor(
    private values: Record<string, unknown>,
    private mapping: Mapping,
    private ctx: MasterCtx,
  ) {}

  /** Mapped value; mappings starting with "=" are fixed values for the whole file. */
  cell(key: string): unknown {
    const m = this.mapping[key];
    if (!m) return null;
    if (m.startsWith("=")) return m.slice(1);
    const v = this.values[m];
    return typeof v === "string" ? v.trim() || null : v ?? null;
  }
  text(key: string, max = 200): string | undefined {
    const v = this.cell(key);
    if (v === null || v === undefined || v === "") return undefined;
    return String(v).trim().slice(0, max) || undefined;
  }
  date(key: string): string | null {
    const r = parseDate(this.cell(key), { max: this.ctx.today });
    if (!r.ok) {
      this.errors.push(r.error);
      if (r.error.startsWith("Missing")) this.flags.add("missingDate");
      return null;
    }
    if (r.warning) this.warnings.push(r.warning);
    return r.value;
  }
  optDate(key: string): string | undefined {
    if (this.cell(key) === null) return undefined;
    return this.date(key) ?? undefined;
  }
  money(key: string, label: string): number | null {
    const r = parseAmount(this.cell(key));
    if (!r.ok) {
      this.errors.push(`${label}: ${r.error}`);
      return null;
    }
    if (r.value !== null && r.value < 0) {
      this.errors.push(`${label} is negative (${r.value}). Record refunds/returns as separate entries.`);
      this.flags.add("negative");
      return null;
    }
    return r.value;
  }
  mode(key = "paymentModeId"): string | undefined {
    const r = parsePaymentMode(this.cell(key), this.ctx.paymentModes);
    if (!r.ok) {
      this.errors.push(r.error);
      this.flags.add("invalidPaymentMode");
      return undefined;
    }
    if (r.warning) {
      this.warnings.push(r.warning);
      if (r.warning.startsWith("Invalid")) this.flags.add("invalidPaymentMode");
    }
    return r.value.id;
  }
  /**
   * Resolve a master name to an id. Unknown names become placeholders that are created
   * on commit (with a warning); blank values use `fallback` if given.
   */
  master(
    type: NewMasterType,
    raw: unknown,
    items: NamedItem[],
    o: { label: string; required?: boolean; fallback?: string; create?: boolean; flag?: Flag; parent?: string },
  ): string | undefined {
    const value = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!value) {
      if (o.fallback) {
        const fb = matchByName(o.fallback, items);
        if (fb) {
          this.warnings.push(`${o.label} missing — recorded as "${fb.item.name}"`);
          return fb.item.id;
        }
        this.warnings.push(`${o.label} missing — "${o.fallback}" will be created`);
        return placeholder(type, o.fallback, o.parent);
      }
      if (o.required) this.errors.push(`Missing ${o.label.toLowerCase()}`);
      return undefined;
    }
    const hit = matchByName(value, items);
    if (hit) {
      if (!hit.exact) this.warnings.push(`${o.label} "${value}" matched to "${hit.item.name}"`);
      return hit.item.id;
    }
    if (o.create === false) {
      this.errors.push(`Unknown ${o.label.toLowerCase()} "${value}"`);
      if (o.flag) this.flags.add(o.flag);
      return undefined;
    }
    this.warnings.push(`New ${o.label.toLowerCase()} "${value}" will be added to master data`);
    if (o.flag) this.flags.add(o.flag);
    return placeholder(type, value, o.parent);
  }

  /**
   * Resolve gross / discount / net. Net is what was collected, so when the three
   * disagree the net is kept and the gross is recomputed (with a warning).
   */
  amounts(): { gross: number; discount: number; net: number } | null {
    const g = this.money("grossAmount", "Amount");
    const d = this.money("discount", "Discount") ?? 0;
    const n = this.money("netAmount", "Net amount");
    if (this.errors.length) return null;
    if (g === null && n === null) {
      this.errors.push("Missing amount");
      this.flags.add("missingAmount");
      return null;
    }
    let gross = g ?? round2((n as number) + d);
    let net = n ?? round2(gross - d);
    if (g !== null && n !== null && Math.abs(round2(g - d) - n) > 0.01) {
      this.warnings.push(`Net ${n} ≠ Amount ${g} − Discount ${d}; kept Net and set Amount to ${round2(n + d)}`);
      gross = round2(n + d);
      net = n;
    }
    if (d > gross) {
      this.errors.push(`Discount ${d} exceeds amount ${gross}`);
      return null;
    }
    if (net === 0) this.warnings.push("Zero amount");
    return { gross, discount: d, net };
  }
}

function isTotalsRow(values: Record<string, unknown>): boolean {
  return Object.values(values).some((v) => typeof v === "string" && TOTAL_WORDS.has(norm(v)));
}

/** Normalise one row for `type`. Combined formats route rows to their module. */
export function normalizeRow(type: ImportType, values: Record<string, unknown>, mapping: Mapping, ctx: MasterCtx): NormalizedRow {
  const b = new RowBuilder(values, mapping, ctx);
  const done = (module: ModuleKey | null, input: Record<string, unknown> | null, amount: number, extras: NormalizedRow["extras"] = []): NormalizedRow => ({
    module,
    input: b.errors.length ? null : input,
    extras: b.errors.length ? [] : extras,
    errors: b.errors,
    warnings: b.warnings,
    flags: [...b.flags],
    amount: b.errors.length ? 0 : amount,
  });

  if (isTotalsRow(values)) {
    b.errors.push("Looks like a totals row — not imported (it would double count)");
    b.flags.add("totalsRow");
    return done(null, null, 0);
  }

  const patient = () => ({ patientCode: b.text("patientCode", 40), patientName: b.text("patientName", 120) });
  const doctors = ctx.doctors;

  if (type === "combined-income") {
    const s = parseStream(b.cell("stream"));
    if (!s.ok) {
      b.errors.push(s.error);
      return done(null, null, 0);
    }
    const date = b.date("date");
    const amt = b.amounts();
    const paymentModeId = b.mode();
    const service = b.cell("service");
    const reference = b.text("reference", 80);
    if (!date || !amt) return done(null, null, 0);
    switch (s.value) {
      case "OPD": {
        const vt = parseVisitType(b.cell("visitType"));
        if (!vt.ok) b.errors.push(vt.error);
        const input = {
          date, ...patient(), reference, paymentModeId,
          specialtyId: b.master("specialties", service, ctx.specialties, { label: "Specialty", fallback: "General", flag: "unknownService" }),
          doctorId: b.master("doctors", b.cell("doctor"), doctors, { label: "Doctor" }),
          visitType: vt.ok ? vt.value : undefined,
          grossAmount: amt.gross, discount: amt.discount,
        };
        return done("opd", input, amt.net);
      }
      case "IPD": {
        const input = {
          admissionDate: date, ...patient(), reference, paymentModeId,
          admissionTypeId: b.master("admissionTypes", service, ctx.admissionTypes, { label: "Admission type", fallback: "Other", flag: "unknownService" }),
          doctorId: b.master("doctors", b.cell("doctor"), doctors, { label: "Doctor" }),
          grossAmount: amt.gross, discount: amt.discount,
          initialPaymentType: amt.net > 0 ? "FINAL_SETTLEMENT" : undefined,
          initialPaymentAmount: amt.net > 0 ? amt.net : undefined,
        };
        return done("ipd", input, amt.net);
      }
      case "LAB": {
        const qty = parseInteger(b.cell("quantity"));
        const quantity = qty.ok && qty.value ? qty.value : 1;
        const input = {
          date, ...patient(), reference, paymentModeId,
          investigationId: b.master("investigations", service, ctx.investigations, { label: "Investigation", required: true, flag: "unknownService" }),
          referringDoctorId: b.master("doctors", b.cell("doctor"), doctors, { label: "Doctor" }),
          quantity, rate: round2(amt.gross / quantity), discount: amt.discount,
        };
        return done("lab", input, amt.net);
      }
      case "PHARMACY":
        return done("pharmacy-sale", { date, ...patient(), invoiceNo: reference, paymentModeId, grossAmount: amt.gross, discount: amt.discount }, amt.net);
      case "DIET": {
        const input = {
          date, ...patient(), reference, paymentModeId,
          serviceId: b.master("dietServices", service, ctx.dietServices, { label: "Diet service", fallback: "Diet Counselling", flag: "unknownService" }),
          grossAmount: amt.gross, discount: amt.discount,
        };
        return done("diet", input, amt.net);
      }
      case "OTHER":
        if (amt.net <= 0) b.errors.push("Other income must be greater than zero");
        return done("other-income", { date, source: service ? String(service).slice(0, 120) : "Other", amount: amt.net, paymentModeId, reference }, amt.net);
    }
  }

  if (type === "combined-expense") {
    const kind = norm(b.cell("expenseType"));
    const date = b.date("date");
    const amount = b.money("amount", "Amount");
    if (amount === null && !b.errors.length) {
      b.errors.push("Missing amount");
      b.flags.add("missingAmount");
    }
    if (amount === 0) b.errors.push("Amount must be greater than zero");
    const vendor = b.text("vendor", 120);
    const billNumber = b.text("billNumber", 60);
    if (kind.includes("pharmacy") || kind === "purchase" || kind === "stock purchase") {
      const paymentModeId = b.cell("paymentModeId") ? b.mode() : undefined;
      return done("pharmacy-purchase", { date, supplier: vendor ?? "Unknown supplier", invoiceNo: billNumber, amount, paymentModeId, remarks: b.text("remarks", 500) }, amount ?? 0);
    }
    return done("expense", expenseInput(b, ctx, date, amount, vendor, billNumber, "category", "subcategory", "department"), amount ?? 0);
  }

  // Single-module formats.
  switch (type) {
    case "opd": {
      const date = b.date("date");
      const amt = b.amounts();
      const vt = parseVisitType(b.cell("visitType"));
      if (!vt.ok) b.errors.push(vt.error);
      const input = {
        date, ...patient(),
        doctorId: b.master("doctors", b.cell("doctorId"), doctors, { label: "Doctor" }),
        specialtyId: b.master("specialties", b.cell("specialtyId"), ctx.specialties, { label: "Specialty", fallback: "General", flag: "unknownService" }),
        consultationTypeId: b.master("consultationTypes", b.cell("consultationTypeId"), ctx.consultationTypes, { label: "Consultation type" }),
        visitType: vt.ok ? vt.value : undefined,
        grossAmount: amt?.gross, discount: amt?.discount,
        paymentModeId: b.mode(), reference: b.text("reference", 80), remarks: b.text("remarks", 500),
      };
      return done("opd", input, amt?.net ?? 0);
    }
    case "ipd": {
      const admissionDate = b.date("admissionDate");
      const dischargeDate = b.optDate("dischargeDate");
      const amt = b.amounts();
      const payType = parseIpdTxnType(b.cell("initialPaymentType"));
      if (!payType.ok) b.errors.push(payType.error);
      const paidRaw = b.money("initialPaymentAmount", "Amount paid");
      // Without payment columns, historical admissions are treated as fully settled on the admission date.
      const mappedPayment = !!(mapping.initialPaymentType || mapping.initialPaymentAmount);
      const type2 = payType.ok ? payType.value : null;
      const paid = mappedPayment ? (paidRaw ?? (type2 ? amt?.net ?? 0 : 0)) : amt?.net ?? 0;
      const initialPaymentType = mappedPayment ? (paid > 0 ? type2 ?? "PAYMENT" : undefined) : paid > 0 ? "FINAL_SETTLEMENT" : undefined;
      const input = {
        admissionDate, dischargeDate, ...patient(),
        admissionTypeId: b.master("admissionTypes", b.cell("admissionTypeId"), ctx.admissionTypes, { label: "Admission type", fallback: "Other", flag: "unknownService" }),
        doctorId: b.master("doctors", b.cell("doctorId"), doctors, { label: "Doctor" }),
        packageId: b.master("ipdPackages", b.cell("packageId"), ctx.ipdPackages, { label: "Package" }),
        grossAmount: amt?.gross, discount: amt?.discount,
        initialPaymentType, initialPaymentAmount: paid > 0 ? paid : undefined,
        paymentModeId: paid > 0 ? b.mode() : undefined,
        reference: b.text("reference", 80), remarks: b.text("remarks", 500),
      };
      if (amt && paid > amt.net) b.warnings.push(`Amount paid ${paid} exceeds net bill ${amt.net}`);
      return done("ipd", input, amt?.net ?? 0);
    }
    case "lab": {
      const date = b.date("date");
      const investigationId = b.master("investigations", b.cell("investigationId"), ctx.investigations, { label: "Investigation", required: true, flag: "unknownService" });
      const q = parseInteger(b.cell("quantity"));
      if (!q.ok) b.errors.push(q.error);
      const quantity = q.ok && q.value && q.value > 0 ? q.value : 1;
      const rateCell = b.money("rate", "Rate");
      const discount = b.money("discount", "Discount") ?? 0;
      const net = b.money("netAmount", "Net amount");
      const masterRate = ctx.investigations.find((i) => i.id === investigationId)?.rate;
      let rate = rateCell ?? (net !== null ? round2((net + discount) / quantity) : masterRate ?? null);
      let disc = discount;
      if (rate === null) {
        b.errors.push("Missing amount (no rate, net amount or master rate)");
        b.flags.add("missingAmount");
      } else if (net !== null) {
        const gross = round2(rate * quantity);
        const implied = round2(gross - net);
        if (Math.abs(implied - discount) > 0.01) {
          if (implied >= 0 && b.cell("discount") === null) {
            disc = implied;
            if (implied > 0) b.warnings.push(`Discount ${implied} inferred (rate × qty − net)`);
          } else {
            rate = round2((net + discount) / quantity);
            b.warnings.push(`Rate × Qty − Discount ≠ Net; rate set to ${rate}`);
          }
        }
      }
      const gross = rate === null ? 0 : round2(rate * quantity);
      if (disc > gross) b.errors.push(`Discount ${disc} exceeds amount ${gross}`);
      const input = {
        date, ...patient(), investigationId, quantity, rate: rate ?? undefined, discount: disc,
        paymentModeId: b.mode(),
        referringDoctorId: b.master("doctors", b.cell("referringDoctorId"), doctors, { label: "Doctor" }),
        departmentId: b.master("departments", b.cell("departmentId"), ctx.departments, { label: "Department" }),
        reference: b.text("reference", 80), remarks: b.text("remarks", 500),
      };
      return done("lab", input, round2(gross - disc));
    }
    case "pharmacy-sale": {
      const date = b.date("date");
      const invoiceNo = b.text("invoiceNo", 60);
      const returns = b.money("returnAmount", "Return") ?? 0;
      const purchases = b.money("purchaseAmount", "Purchases") ?? 0;
      // "Net Sales" in the template = Sales − Discount − Return; the return is stored separately.
      const g = b.money("grossAmount", "Sales");
      const d = b.money("discount", "Discount") ?? 0;
      const n = b.money("netAmount", "Net sales");
      const paymentModeId = b.mode();
      const extras: NormalizedRow["extras"] = [];
      let gross = g;
      if (gross === null && n !== null) gross = round2(n + d + returns);
      const hasSale = gross !== null && gross > 0;
      if (!hasSale && !returns && !purchases && !b.errors.length) {
        b.errors.push("Missing amount");
        b.flags.add("missingAmount");
      }
      if (g !== null && n !== null && Math.abs(round2(g - d - returns) - n) > 0.01) {
        b.warnings.push(`Net sales ${n} ≠ Sales ${g} − Discount ${d} − Return ${returns}; Sales kept`);
      }
      if (gross !== null && d > gross) b.errors.push(`Discount ${d} exceeds sales ${gross}`);
      if (date && returns > 0) extras.push({ module: "pharmacy-return", input: { date, invoiceNo, amount: returns, paymentModeId, reason: "Imported with sales row" } });
      if (date && purchases > 0) extras.push({ module: "pharmacy-purchase", input: { date, supplier: "Pharmacy sheet import", invoiceNo, amount: purchases } });
      const input = hasSale ? { date, invoiceNo, ...patient(), grossAmount: gross, discount: d, paymentModeId, remarks: b.text("remarks", 500) } : null;
      if (!hasSale && extras.length) {
        const first = extras.shift()!;
        return done(first.module, first.input, 0, extras);
      }
      return done("pharmacy-sale", input, hasSale ? round2((gross as number) - d) : 0, extras);
    }
    case "pharmacy-return": {
      const date = b.date("date");
      const amount = b.money("amount", "Return value");
      if (amount === null && !b.errors.length) {
        b.errors.push("Missing amount");
        b.flags.add("missingAmount");
      }
      return done("pharmacy-return", { date, invoiceNo: b.text("invoiceNo", 60), amount, paymentModeId: b.mode(), reason: b.text("reason", 500) }, amount ?? 0);
    }
    case "pharmacy-purchase": {
      const date = b.date("date");
      const amount = b.money("amount", "Purchase amount");
      if (amount === null && !b.errors.length) {
        b.errors.push("Missing amount");
        b.flags.add("missingAmount");
      }
      const supplier = b.text("supplier", 120);
      if (!supplier) b.warnings.push('Supplier missing — recorded as "Unknown supplier"');
      const paymentModeId = b.cell("paymentModeId") ? b.mode() : undefined;
      return done("pharmacy-purchase", { date, supplier: supplier ?? "Unknown supplier", invoiceNo: b.text("invoiceNo", 60), amount, paymentModeId, remarks: b.text("remarks", 500) }, amount ?? 0);
    }
    case "diet": {
      const date = b.date("date");
      const amt = b.amounts();
      const input = {
        date, ...patient(),
        serviceId: b.master("dietServices", b.cell("serviceId"), ctx.dietServices, { label: "Diet service", fallback: "Diet Counselling", flag: "unknownService" }),
        dieticianId: b.master("dieticians", b.cell("dieticianId"), ctx.dieticians, { label: "Dietician" }),
        grossAmount: amt?.gross, discount: amt?.discount,
        paymentModeId: b.mode(), reference: b.text("reference", 80), remarks: b.text("remarks", 500),
      };
      return done("diet", input, amt?.net ?? 0);
    }
    case "other-income": {
      const date = b.date("date");
      const amount = b.money("amount", "Amount");
      if (amount === null && !b.errors.length) {
        b.errors.push("Missing amount");
        b.flags.add("missingAmount");
      }
      return done("other-income", { date, source: b.text("source", 120) ?? "Other", description: b.text("description", 500), amount, paymentModeId: b.mode(), reference: b.text("reference", 80) }, amount ?? 0);
    }
    case "expense": {
      const date = b.date("date");
      const amount = b.money("amount", "Amount");
      if (amount === null && !b.errors.length) {
        b.errors.push("Missing amount");
        b.flags.add("missingAmount");
      }
      return done("expense", expenseInput(b, ctx, date, amount, b.text("vendor", 120), b.text("billNumber", 60), "categoryId", "subcategoryId", "departmentId"), amount ?? 0);
    }
  }
  b.errors.push(`Unsupported import type ${type}`);
  return done(null, null, 0);
}

function expenseInput(
  b: RowBuilder,
  ctx: MasterCtx,
  date: string | null,
  amount: number | null,
  vendor: string | undefined,
  billNumber: string | undefined,
  catKey: string,
  subKey: string,
  deptKey: string,
) {
  const catRaw = b.cell(catKey);
  const categoryId = b.master("expenseCategories", catRaw, ctx.categories, { label: "Category", fallback: "Other", flag: "unknownCategory" });
  const subRaw = b.cell(subKey);
  let subcategoryId: string | undefined;
  if (subRaw !== null && subRaw !== "" && categoryId) {
    const siblings = categoryId.startsWith(NEW_PREFIX) ? [] : ctx.subcategories.filter((s) => s.parentId === categoryId);
    subcategoryId = b.master("expenseSubcategories", subRaw, siblings, { label: "Subcategory", flag: "unknownCategory", parent: categoryId });
  }
  const description = b.text("description", 300) ?? (subRaw ? String(subRaw) : catRaw ? String(catRaw) : undefined);
  if (!description) b.errors.push("Missing description");
  return {
    date,
    departmentId: b.master("departments", b.cell(deptKey), ctx.departments, { label: "Department" }),
    categoryId,
    subcategoryId,
    description,
    vendor,
    billNumber,
    amount,
    paymentModeId: b.mode(),
    remarks: b.text("remarks", 500),
    spreadMonth: b.text("spreadMonth", 20),
  };
}
