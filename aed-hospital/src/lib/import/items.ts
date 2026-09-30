/**
 * Pharmacy medicine lines (import type "pharmacy-items"): normalisation and fingerprints.
 * These feed medicine-level analytics only; they are not income or expense records.
 */
import type { Mapping } from "./mapping";
import { fingerprintKey } from "./fingerprint";
import { norm } from "./text";
import { parseAmount, parseDate, parseInteger } from "./values";

export interface ItemLineInput {
  kind: "SALE" | "PURCHASE";
  date: string;
  docNo?: string;
  item: string;
  batchNo?: string;
  expiry?: string;
  supplier?: string;
  manufacturer?: string;
  qty: number;
  freeQty: number;
  amount: number;
  taxable?: number;
  tax?: number;
  cost?: number;
}

const FORMS = ["TAB", "CAP", "INJ", "SYR", "PWD", "GEL", "OINT", "CREAM", "LOTION", "LIQD", "SUSP", "DROPS", "EYE-DPS", "EAR-DPS", "VIAL", "IV", "DEVICE", "SACHET", "SPRAY", "SOAP", "INHALER", "PATCH"];

/** "TAB JANUMET 50/500MG" → "TAB"; unknown prefixes → "OTHER". */
export function itemForm(name: string): string {
  const first = name.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  return FORMS.includes(first) ? first : "OTHER";
}

/** Canonical medicine name: trimmed, single spaces, upper case (HMS names vary only in case/spacing). */
export function canonicalItemName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toUpperCase();
}

export function itemFingerprint(i: ItemLineInput): string {
  return fingerprintKey({ module: `item-${i.kind.toLowerCase()}`, date: i.date, patient: i.item, reference: `${i.docNo ?? ""}|${i.batchNo ?? ""}|${i.qty}`, service: i.supplier ?? null, amount: i.amount });
}

export function normalizeItemRow(values: Record<string, unknown>, mapping: Mapping, today: string) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cell = (k: string): unknown => {
    const m = mapping[k];
    if (!m) return null;
    if (m.startsWith("=")) return m.slice(1);
    const v = values[m];
    return typeof v === "string" ? v.trim() || null : v ?? null;
  };
  const text = (k: string, max = 120) => {
    const v = cell(k);
    return v === null || v === undefined || v === "" ? undefined : String(v).replace(/\s+/g, " ").trim().slice(0, max) || undefined;
  };
  const money = (k: string, label: string, required = false) => {
    const r = parseAmount(cell(k));
    if (!r.ok) return errors.push(`${label}: ${r.error}`), undefined;
    if (r.value === null) return required ? (errors.push(`Missing ${label.toLowerCase()}`), undefined) : undefined;
    if (r.value < 0) return errors.push(`${label} is negative (${r.value})`), undefined;
    return r.value;
  };
  const int = (k: string, label: string, required = false) => {
    const r = parseInteger(cell(k));
    if (!r.ok) return errors.push(`${label}: ${r.error}`), undefined;
    if (r.value === null) return required ? (errors.push(`Missing ${label.toLowerCase()}`), undefined) : undefined;
    if (r.value < 0) return errors.push(`${label} is negative (${r.value})`), undefined;
    return r.value;
  };

  const k = norm(cell("kind"));
  const kind = /^(sale|sales|sold|s)$/.test(k) ? "SALE" : /^(purchase|purchases|bought|p|inward)$/.test(k) ? "PURCHASE" : null;
  if (!kind) errors.push(`Type must be Sale or Purchase, got "${String(cell("kind") ?? "")}"`);
  const d = parseDate(cell("date"), { max: today });
  if (!d.ok) errors.push(d.error);
  else if (d.warning) warnings.push(d.warning);
  const itemRaw = text("item", 200);
  if (!itemRaw) errors.push("Missing medicine name");
  const qty = int("qty", "Quantity", true);
  const amount = money("amount", "Amount", true);
  const input: ItemLineInput | null =
    errors.length || !kind || !d.ok || !itemRaw || qty === undefined || amount === undefined
      ? null
      : {
          kind,
          date: d.value,
          docNo: text("docNo", 60),
          item: canonicalItemName(itemRaw),
          batchNo: text("batchNo", 40),
          expiry: text("expiry", 20),
          supplier: text("supplier", 120),
          manufacturer: text("manufacturer", 80),
          qty,
          freeQty: int("freeQty", "Free units") ?? 0,
          amount,
          taxable: money("taxable", "Taxable amount"),
          tax: money("tax", "GST"),
          cost: money("cost", "Cost"),
        };
  if (input && input.qty === 0 && input.amount === 0) warnings.push("Zero quantity and amount");
  if (input && input.kind === "SALE" && input.cost !== undefined && input.taxable !== undefined && input.cost > input.taxable * 3) warnings.push(`Cost ${input.cost} is far above the sale value ${input.taxable}`);
  return { input: errors.length ? null : input, errors, warnings, amount: errors.length ? 0 : amount ?? 0 };
}
