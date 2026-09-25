/**
 * Money helpers. Amounts are stored as NUMERIC(12,2) and summed in SQL; in JS we
 * only round results to paise to avoid floating-point artefacts in presentation
 * and in derived ratios.
 */

export type DecimalLike = number | string | { toString(): string } | null | undefined;

/** Convert Prisma.Decimal / string / number / null to a JS number rounded to 2 dp. */
export function toNum(v: DecimalLike): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? round2(n) : 0;
}

export function round2(n: number): number {
  // Math.round is asymmetric for negatives; use sign-aware rounding.
  // toPrecision(12) removes binary noise (1.005 * 100 = 100.49999999999999) before rounding half away from zero.
  const s = Math.sign(n) || 1;
  return (s * Math.round(Number((Math.abs(n) * 100).toPrecision(12)))) / 100;
}

export function sum(values: number[]): number {
  // Work in integer paise so that 0.1 + 0.2 style errors never appear.
  return values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});
const inrFormatter2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const numFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹4,25,000 (Indian digit grouping). */
export function formatINR(n: number | null | undefined, opts: { paise?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return (opts.paise ? inrFormatter2 : inrFormatter).format(n);
}

/** Compact: ₹4.25 L, ₹1.2 Cr — for KPI cards on small screens. */
export function formatINRCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  const trim = (x: number, d: number) => String(Number(x.toFixed(d)));
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7, 2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5, 2)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3, 1)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return numFormatter.format(n);
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}
