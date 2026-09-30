/**
 * Supplier payments (import type "supplier-payments"): money paid to pharmacy suppliers
 * against purchase invoices. Not an expense — the purchases already are — but it shows
 * what has been paid and which invoices are still open.
 */
import type { Mapping } from "./mapping";
import { fingerprintKey } from "./fingerprint";
import { parseAmount, parseDate } from "./values";

export interface SupplierPaymentInput {
  date: string;
  supplier: string;
  reference?: string;
  invoiceRefs: string[];
  details?: string;
  amount: number;
}

/** Canonical invoice number for matching: upper case, no spaces. */
export const canonicalInvoice = (s: string) => s.replace(/\s+/g, "").toUpperCase();
/** Canonical supplier name for matching: upper case, single spaces. */
export const canonicalSupplier = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

/**
 * OneGlance "Details": "636907,INVOICE NO MK13683,MK13806" → reference 636907, invoices [MK13683, MK13806].
 * Tolerates the typos seen in real exports ("INVOICDE NO", "INVOICE" without "NO").
 */
export function parsePaymentDetails(details: string): { reference?: string; invoices: string[] } {
  const m = /^\s*([^,]*?)\s*,?\s*INVOI\w*\s*(?:NO\b\.?)?\s*(.*)$/i.exec(details);
  if (!m) return { reference: details.split(",")[0]?.trim() || undefined, invoices: [] };
  const invoices = m[2]
    .split(/[,;]/)
    .map((x) => canonicalInvoice(x))
    .filter((x) => x.length >= 2);
  return { reference: m[1].trim() || undefined, invoices: [...new Set(invoices)] };
}

export function paymentFingerprint(p: SupplierPaymentInput): string {
  return fingerprintKey({ module: "supplier-payment", date: p.date, patient: canonicalSupplier(p.supplier), reference: p.reference ?? p.invoiceRefs.join(","), service: null, amount: p.amount });
}

export function normalizePaymentRow(values: Record<string, unknown>, mapping: Mapping, today: string) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cell = (k: string): unknown => {
    const m = mapping[k];
    if (!m) return null;
    if (m.startsWith("=")) return m.slice(1);
    const v = values[m];
    return typeof v === "string" ? v.trim() || null : v ?? null;
  };
  const text = (k: string, max: number) => {
    const v = cell(k);
    return v === null || v === undefined || v === "" ? undefined : String(v).replace(/\s+/g, " ").trim().slice(0, max) || undefined;
  };
  const d = parseDate(cell("date"), { max: today });
  if (!d.ok) errors.push(d.error);
  const supplier = text("supplier", 160);
  if (!supplier) errors.push("Missing supplier");
  const a = parseAmount(cell("amount"));
  let amount: number | undefined;
  if (!a.ok) errors.push(`Amount: ${a.error}`);
  else if (a.value === null) errors.push("Missing amount");
  else if (a.value <= 0) errors.push(`Amount must be positive (${a.value})`);
  else amount = a.value;
  const details = text("details", 2000);
  const parsed = details ? parsePaymentDetails(details) : { reference: undefined, invoices: [] as string[] };
  const listed = text("invoices", 2000);
  const invoiceRefs = listed ? [...new Set(listed.split(/[,;]/).map(canonicalInvoice).filter((x) => x.length >= 2))] : parsed.invoices;
  const reference = text("reference", 60) ?? parsed.reference;
  if (!invoiceRefs.length) warnings.push("No invoice numbers found — the payment counts for the supplier but is not matched to invoices");
  const input: SupplierPaymentInput | null =
    errors.length || !d.ok || !supplier || amount === undefined ? null : { date: d.value, supplier, reference, invoiceRefs, details, amount };
  return { input, errors, warnings, amount: amount ?? 0 };
}
