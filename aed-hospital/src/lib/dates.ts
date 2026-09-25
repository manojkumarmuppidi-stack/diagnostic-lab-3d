/**
 * Business dates are plain calendar dates ("YYYY-MM-DD") in the hospital's
 * timezone (Asia/Kolkata). In PostgreSQL they are DATE columns; Prisma maps
 * them to JS Date objects at UTC midnight. Always convert through these helpers.
 */

export const APP_TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ISODate = string;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's business date in the hospital timezone. */
export function todayISO(now: Date = new Date(), tz: string = APP_TZ): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "YYYY-MM-DD" → Date at UTC midnight (what Prisma expects for @db.Date). */
export function toDbDate(iso: ISODate): Date {
  if (!isISODate(iso)) throw new Error(`Invalid date: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Date (UTC midnight from DB) → "YYYY-MM-DD". */
export function fromDbDate(d: Date | string): ISODate {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = toDbDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

export function addMonths(iso: ISODate, months: number): ISODate {
  const [y, m, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromDbDate(target);
}

/** Inclusive day count between two ISO dates. */
export function daysBetweenInclusive(from: ISODate, to: ISODate): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000) + 1;
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(iso: ISODate): number {
  const d = toDbDate(iso).getUTCDay();
  return d === 0 ? 7 : d;
}

export function startOfWeek(iso: ISODate): ISODate {
  return addDays(iso, 1 - isoWeekday(iso));
}

export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(iso), 1), -1);
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const shortFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const dayMonthFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** 25 Sep 2026 */
export function formatDate(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  return shortFmt.format(toDbDate(iso.slice(0, 10)));
}
export function formatDayMonth(iso: ISODate): string {
  return dayMonthFmt.format(toDbDate(iso.slice(0, 10)));
}
export function formatMonth(iso: ISODate): string {
  return monthFmt.format(toDbDate(`${iso.slice(0, 7)}-01`));
}

export function formatDateTime(d: Date | string | null | undefined, tz: string = APP_TZ): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}
