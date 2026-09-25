/**
 * Zod input schemas for every transaction module. The same schema validates
 * manual entry (API) and each imported row after name→id resolution, so both
 * paths obey identical rules.
 */
import { z } from "zod";
import { isISODate } from "./dates";
import type { ModuleKey } from "./modules";

const MAX_AMOUNT = 99_99_99_999; // < NUMERIC(12,2) limit

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const zDate = z.string().refine(isISODate, "Invalid date (expected YYYY-MM-DD)");
export const zOptDate = z.preprocess(emptyToUndef, zDate.optional());

/** Non-negative money with at most 2 decimals. */
export const zMoney = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
  z
    .number({ invalid_type_error: "Must be a number", required_error: "Required" })
    .finite()
    .min(0, "Cannot be negative")
    .max(MAX_AMOUNT, "Amount too large")
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "At most 2 decimal places"),
);
export const zOptMoney = z.preprocess(emptyToUndef, zMoney.optional());
export const zPositiveMoney = zMoney.refine((n) => n > 0, "Must be greater than zero");

const zId = z.string().min(1).max(40);
const zOptId = z.preprocess(emptyToUndef, zId.optional());
const zText = (max = 200) => z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max));
const zOptText = (max = 200) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v ?? undefined), z.string().max(max).optional());

const patient = {
  patientCode: zOptText(40),
  patientName: zOptText(120),
};

const discountOk = (v: { grossAmount: number; discount?: number }) => (v.discount ?? 0) <= v.grossAmount;
const discountMsg = { message: "Discount cannot exceed amount", path: ["discount"] };

export const opdSchema = z.object({
  date: zDate,
  ...patient,
  doctorId: zOptId,
  specialtyId: zId,
  consultationTypeId: zOptId,
  visitType: z.enum(["NEW", "OLD"]),
  grossAmount: zMoney,
  discount: zOptMoney,
  paymentModeId: zId,
  reference: zOptText(80),
  remarks: zOptText(500),
}).refine(discountOk, discountMsg);

export const ipdSchema = z.object({
  admissionDate: zDate,
  dischargeDate: zOptDate,
  ...patient,
  admissionTypeId: zId,
  doctorId: zOptId,
  packageId: zOptId,
  grossAmount: zMoney,
  discount: zOptMoney,
  initialPaymentType: z.preprocess(emptyToUndef, z.enum(["ADVANCE", "PAYMENT", "FINAL_SETTLEMENT"]).optional()),
  initialPaymentAmount: zOptMoney,
  paymentModeId: zOptId,
  reference: zOptText(80),
  remarks: zOptText(500),
}).refine(discountOk, discountMsg)
  .refine((v) => !v.dischargeDate || v.dischargeDate >= v.admissionDate, {
    message: "Discharge date cannot be before admission date",
    path: ["dischargeDate"],
  })
  .refine((v) => !v.initialPaymentAmount || (!!v.initialPaymentType && !!v.paymentModeId), {
    message: "Payment type and payment mode are required when an amount is paid now",
    path: ["paymentModeId"],
  });

export const ipdPaymentSchema = z.object({
  admissionId: zId,
  date: zDate,
  type: z.enum(["ADVANCE", "PAYMENT", "FINAL_SETTLEMENT", "REFUND"]),
  amount: zPositiveMoney,
  paymentModeId: zId,
  reference: zOptText(80),
  remarks: zOptText(500),
});

export const labSchema = z
  .object({
    date: zDate,
    ...patient,
    investigationId: zId,
    quantity: z.preprocess((v) => (v === "" || v == null ? 1 : Number(v)), z.number().int().min(1).max(1000)),
    /** When omitted the investigation's master rate is used. */
    rate: zOptMoney,
    discount: zOptMoney,
    paymentModeId: zId,
    referringDoctorId: zOptId,
    departmentId: zOptId,
    reference: zOptText(80),
    remarks: zOptText(500),
  });

export const pharmacySaleSchema = z.object({
  date: zDate,
  invoiceNo: zOptText(60),
  ...patient,
  grossAmount: zMoney,
  discount: zOptMoney,
  paymentModeId: zId,
  remarks: zOptText(500),
}).refine(discountOk, discountMsg);

export const pharmacyReturnSchema = z.object({
  date: zDate,
  invoiceNo: zOptText(60),
  amount: zPositiveMoney,
  paymentModeId: zId,
  reason: zOptText(500),
});

export const pharmacyPurchaseSchema = z.object({
  date: zDate,
  supplier: zText(120).pipe(z.string().min(1, "Required")),
  invoiceNo: zOptText(60),
  amount: zPositiveMoney,
  paymentModeId: zOptId,
  remarks: zOptText(500),
});

export const dietSchema = z.object({
  date: zDate,
  ...patient,
  serviceId: zId,
  dieticianId: zOptId,
  grossAmount: zMoney,
  discount: zOptMoney,
  paymentModeId: zId,
  reference: zOptText(80),
  remarks: zOptText(500),
}).refine(discountOk, discountMsg);

export const otherIncomeSchema = z.object({
  date: zDate,
  source: zText(120).pipe(z.string().min(1, "Required")),
  description: zOptText(500),
  amount: zPositiveMoney,
  paymentModeId: zId,
  reference: zOptText(80),
});

export const expenseSchema = z.object({
  date: zDate,
  departmentId: zOptId,
  categoryId: zId,
  subcategoryId: zOptId,
  description: zText(300).pipe(z.string().min(1, "Required")),
  vendor: zOptText(120),
  billNumber: zOptText(60),
  amount: zPositiveMoney,
  paymentModeId: zId,
  remarks: zOptText(500),
});

export const MODULE_SCHEMAS = {
  opd: opdSchema,
  ipd: ipdSchema,
  "ipd-payment": ipdPaymentSchema,
  lab: labSchema,
  "pharmacy-sale": pharmacySaleSchema,
  "pharmacy-return": pharmacyReturnSchema,
  "pharmacy-purchase": pharmacyPurchaseSchema,
  diet: dietSchema,
  "other-income": otherIncomeSchema,
  expense: expenseSchema,
} satisfies Record<ModuleKey, z.ZodTypeAny>;

export type ModuleInput<K extends ModuleKey> = z.infer<(typeof MODULE_SCHEMAS)[K]>;

export const reasonSchema = z.object({
  reason: z.string().trim().min(5, "Please give a reason (at least 5 characters)").max(500),
});

export function zodErrorMap(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const k = issue.path.join(".") || "_";
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}
