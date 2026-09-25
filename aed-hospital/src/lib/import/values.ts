/**
 * Cell-value parsers for historical spreadsheets. Each returns either a value or
 * a human-readable problem. Pure functions — unit tested.
 */
import { isISODate } from "../dates";
import { norm } from "./text";

export type Parsed<T> = { ok: true; value: T; warning?: string } | { ok: false; error: string };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isISODate(s) ? s : null;
}

/** Excel serial date → ISO (1900 date system, with the Lotus leap-year bug). */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Math.round((Math.floor(serial) - 25569) * 86_400_000);
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

export interface DateParseOptions {
  /** Earliest acceptable date (default 2000-01-01). */
  min?: string;
  /** Latest acceptable date (default: none). */
  max?: string;
}

/**
 * Accepts Date objects, Excel serials and strings: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YY,
 * YYYY-MM-DD, 01-Sep-2026, 1 Sep 2026, Sep 1, 2026, ISO timestamps.
 * Slash/dash dates are read day-first (Indian convention); if that's impossible but
 * month-first works, it is used with a warning.
 */
export function parseDate(v: unknown, opts: DateParseOptions = {}): Parsed<string> {
  const min = opts.min ?? "2000-01-01";
  const check = (s: string | null, warning?: string): Parsed<string> => {
    if (!s) return { ok: false, error: `Invalid date "${String(v)}"` };
    if (s < min) return { ok: false, error: `Date ${s} is before ${min}` };
    if (opts.max && s > opts.max) return { ok: false, error: `Date ${s} is in the future` };
    return warning ? { ok: true, value: s, warning } : { ok: true, value: s };
  };

  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return { ok: false, error: "Missing date" };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { ok: false, error: "Invalid date" };
    // Spreadsheet libraries give UTC-midnight dates; a local-midnight date from IST
    // would be 18:30 of the previous day in UTC, so round to the nearest day.
    const rounded = new Date(Math.round(v.getTime() / 86_400_000) * 86_400_000);
    return check(rounded.toISOString().slice(0, 10));
  }
  if (typeof v === "number") return check(excelSerialToISO(v));

  const s = String(v).trim();
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/))) return check(iso(+m[1], +m[2], +m[3]));

  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/))) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    const dayFirst = iso(y, b, a);
    if (dayFirst) return check(dayFirst);
    const monthFirst = iso(y, a, b);
    if (monthFirst) return check(monthFirst, `Read "${s}" as month-first (MM/DD)`);
    return { ok: false, error: `Invalid date "${s}"` };
  }

  if ((m = s.match(/^(\d{1,2})[-\s/.]?([A-Za-z]{3,9})[-\s/.,]*(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? check(iso(+m[3], mon, +m[1])) : { ok: false, error: `Invalid date "${s}"` };
  }
  if ((m = s.match(/^([A-Za-z]{3,9})[-\s.]+(\d{1,2})(?:st|nd|rd|th)?,?[-\s]+(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[1].toLowerCase()];
    return mon ? check(iso(+m[3], mon, +m[2])) : { ok: false, error: `Invalid date "${s}"` };
  }
  if (/^\d+(\.\d+)?$/.test(s)) return check(excelSerialToISO(Number(s)));
  return { ok: false, error: `Invalid date "${s}"` };
}

/**
 * "₹ 1,25,000.50", "Rs.500/-", "(250)" → numbers. Blank → null (caller decides
 * whether blank is allowed). Parentheses and a leading minus mean negative.
 */
export function parseAmount(v: unknown): Parsed<number | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { ok: false, error: "Invalid amount" };
    return { ok: true, value: Math.round(v * 100) / 100 };
  }
  let s = String(v).trim();
  if (!s || s === "-" || s === "—") return { ok: true, value: null };
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|rs\.?|inr|\/-|,|\s/gi, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: `Invalid amount "${String(v)}"` };
  const n = Math.round(Number(s) * 100) / 100;
  return { ok: true, value: negative ? -n : n };
}

export function parseInteger(v: unknown): Parsed<number | null> {
  const a = parseAmount(v);
  if (!a.ok) return { ok: false, error: `Invalid number "${String(v)}"` };
  if (a.value === null) return a;
  if (!Number.isInteger(a.value)) return { ok: false, error: `Expected a whole number, got ${a.value}` };
  return { ok: true, value: a.value };
}

export function parseVisitType(v: unknown): Parsed<"NEW" | "OLD"> {
  const s = norm(v);
  if (!s) return { ok: false, error: "Missing New/Old" };
  if (["new", "n", "first", "first visit", "fresh", "new patient", "new visit", "new consultation", "1st visit"].includes(s))
    return { ok: true, value: "NEW" };
  if (["old", "o", "follow up", "followup", "f u", "fu", "review", "revisit", "repeat", "existing", "old patient", "old visit", "follow"].includes(s))
    return { ok: true, value: "OLD" };
  return { ok: false, error: `Unrecognised New/Old value "${String(v)}"` };
}

export type ReconCode = "CASH" | "CARD" | "UPI" | "BANK" | "OTHER";

const MODE_SYNONYMS: Record<ReconCode, string[]> = {
  CASH: ["cash", "csh", "ca", "cash payment"],
  CARD: ["card", "credit card", "debit card", "cc", "dc", "pos", "swipe", "visa", "mastercard", "master card", "rupay", "card payment"],
  UPI: ["upi", "gpay", "g pay", "google pay", "phonepe", "phone pe", "paytm", "bhim", "qr", "qr code", "upi payment", "online upi"],
  BANK: ["bank", "bank transfer", "neft", "rtgs", "imps", "transfer", "cheque", "chq", "check", "dd", "demand draft", "net banking", "netbanking", "online transfer"],
  OTHER: ["other", "others", "insurance", "tpa", "credit", "wallet", "adjustment"],
};

export interface ModeLike {
  id: string;
  code: string;
  name: string;
  reconGroup: ReconCode;
}

/**
 * Resolve a payment-mode cell against the PaymentMode master: exact code/name first,
 * then synonyms → the first active mode of that reconciliation group.
 */
export function parsePaymentMode(v: unknown, modes: ModeLike[]): Parsed<ModeLike> {
  const s = norm(v);
  const other = modes.find((m) => m.reconGroup === "OTHER");
  if (!s) {
    return other
      ? { ok: true, value: other, warning: "Payment mode missing — recorded as Other" }
      : { ok: false, error: "Missing payment mode" };
  }
  const exact = modes.find((m) => norm(m.code) === s || norm(m.name) === s);
  if (exact) return { ok: true, value: exact };
  for (const [group, words] of Object.entries(MODE_SYNONYMS) as [ReconCode, string[]][]) {
    if (words.includes(s) || words.some((w) => s.split(" ").includes(w) && w.length >= 3)) {
      const m = modes.find((x) => x.reconGroup === group && norm(x.code) === norm(group)) ?? modes.find((x) => x.reconGroup === group);
      if (m) return { ok: true, value: m };
    }
  }
  return other
    ? { ok: true, value: other, warning: `Invalid payment mode "${String(v)}" — recorded as Other` }
    : { ok: false, error: `Invalid payment mode "${String(v)}"` };
}

export type IpdPayType = "ADVANCE" | "PAYMENT" | "FINAL_SETTLEMENT" | "REFUND";
export function parseIpdTxnType(v: unknown): Parsed<IpdPayType | null> {
  const s = norm(v);
  if (!s) return { ok: true, value: null };
  if (["advance", "adv", "deposit"].includes(s)) return { ok: true, value: "ADVANCE" };
  if (["payment", "part payment", "partial", "part paid", "partially paid", "interim"].includes(s)) return { ok: true, value: "PAYMENT" };
  if (["final", "final settlement", "settlement", "settled", "paid", "full", "full payment", "fully paid", "final bill"].includes(s))
    return { ok: true, value: "FINAL_SETTLEMENT" };
  if (["refund", "refunded"].includes(s)) return { ok: true, value: "REFUND" };
  if (["due", "pending", "unpaid", "not paid", "credit"].includes(s)) return { ok: true, value: null };
  return { ok: false, error: `Unrecognised payment type "${String(v)}"` };
}

/** Income stream names used by the combined-income format. */
export function parseStream(v: unknown): Parsed<"OPD" | "IPD" | "LAB" | "PHARMACY" | "DIET" | "OTHER"> {
  const s = norm(v);
  const table: Record<string, "OPD" | "IPD" | "LAB" | "PHARMACY" | "DIET" | "OTHER"> = {
    opd: "OPD", consultation: "OPD", consultations: "OPD", op: "OPD", outpatient: "OPD",
    ipd: "IPD", ip: "IPD", inpatient: "IPD", admission: "IPD", admissions: "IPD",
    lab: "LAB", laboratory: "LAB", diagnostics: "LAB", investigation: "LAB", investigations: "LAB", radiology: "LAB",
    pharmacy: "PHARMACY", medicine: "PHARMACY", medicines: "PHARMACY", pharma: "PHARMACY",
    diet: "DIET", nutrition: "DIET", "diet and nutrition": "DIET", dietician: "DIET",
    other: "OTHER", others: "OTHER", "other income": "OTHER", misc: "OTHER", miscellaneous: "OTHER",
  };
  const hit = table[s];
  return hit ? { ok: true, value: hit } : { ok: false, error: `Unknown income stream "${String(v)}"` };
}
