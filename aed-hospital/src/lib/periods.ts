import {
  addDays,
  addMonths,
  daysBetweenInclusive,
  endOfMonth,
  isISODate,
  startOfMonth,
  startOfWeek,
  type ISODate,
} from "./dates";

export const PERIOD_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "this_quarter", label: "This Quarter" },
  { key: "last_quarter", label: "Last Quarter" },
  { key: "this_year", label: "This Year" },
  { key: "previous_year", label: "Previous Year" },
  { key: "last_30", label: "Last 30 Days" },
  { key: "custom", label: "Custom Range" },
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["key"];

/**
 * like_for_like: a period that is still running (this week / month / quarter / year)
 *   is compared with the SAME number of elapsed days of the previous period
 *   (e.g. Mon–Thu vs last Mon–Thu). This is the default because comparing a partial
 *   week with a full week always shows a misleading drop.
 * full: compare with the whole previous period.
 */
export type CompareMode = "like_for_like" | "full";

export interface DateRange {
  from: ISODate;
  to: ISODate;
  label: string;
}

export interface ResolvedPeriod {
  preset: PeriodPreset;
  current: DateRange;
  previous: DateRange;
}

/** Start of the quarter containing `iso`, for a fiscal year starting in `fyStartMonth` (1–12). */
export function startOfQuarter(iso: ISODate, fyStartMonth = 1): ISODate {
  const [y, m] = iso.split("-").map(Number);
  const offset = (m - fyStartMonth + 12) % 12; // months since FY start
  const qStartOffset = offset - (offset % 3);
  return addMonths(`${y}-${String(m).padStart(2, "0")}-01`, qStartOffset - offset);
}

/** Start of the (fiscal) year containing `iso`. fyStartMonth=4 → Indian FY (Apr–Mar). */
export function startOfYear(iso: ISODate, fyStartMonth = 1): ISODate {
  const [y, m] = iso.split("-").map(Number);
  const startYear = m >= fyStartMonth ? y : y - 1;
  return `${startYear}-${String(fyStartMonth).padStart(2, "0")}-01`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact range label: "1–25 Sep 2026", "28 Aug – 3 Sep 2026", "1 Dec 2025 – 5 Jan 2026". */
export function shortRangeLabel(from: ISODate, to: ISODate): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (from === to) return `${td} ${MON[tm - 1]} ${ty}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MON[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${MON[fm - 1]} – ${td} ${MON[tm - 1]} ${ty}`;
  return `${fd} ${MON[fm - 1]} ${fy} – ${td} ${MON[tm - 1]} ${ty}`;
}

function range(from: ISODate, to: ISODate, label?: string): DateRange {
  return { from, to, label: label ?? shortRangeLabel(from, to) };
}

/** Clip `to` so it never exceeds `max`. */
function clip(r: DateRange, max: ISODate): DateRange {
  return r.to > max ? range(r.from, max, r.label) : r;
}

/** The previous period of equal length immediately before `r`. */
export function precedingRange(r: { from: ISODate; to: ISODate }): DateRange {
  const len = daysBetweenInclusive(r.from, r.to);
  const to = addDays(r.from, -1);
  return range(addDays(to, -(len - 1)), to);
}

export function resolvePeriod(opts: {
  preset: PeriodPreset;
  today: ISODate;
  from?: string;
  to?: string;
  compareMode?: CompareMode;
  fyStartMonth?: number;
  compareFrom?: string;
  compareTo?: string;
}): ResolvedPeriod {
  const { preset, today } = opts;
  const mode: CompareMode = opts.compareMode ?? "like_for_like";
  const fy = opts.fyStartMonth ?? 1;
  let current: DateRange;
  let previous: DateRange;

  // Previous period for a running period: either same elapsed length or the full period.
  const running = (start: ISODate, prevStart: ISODate, prevEndFull: ISODate, label: string, prevLabel: string) => {
    current = range(start, today, label);
    const elapsed = daysBetweenInclusive(start, today);
    const prevTo = mode === "full" ? prevEndFull : minDate(addDays(prevStart, elapsed - 1), prevEndFull);
    previous = range(prevStart, prevTo, prevLabel);
  };

  switch (preset) {
    case "today":
      current = range(today, today, "Today");
      previous = range(addDays(today, -1), addDays(today, -1), "Yesterday");
      break;
    case "yesterday": {
      const y = addDays(today, -1);
      current = range(y, y, "Yesterday");
      previous = range(addDays(y, -1), addDays(y, -1));
      break;
    }
    case "this_week": {
      const s = startOfWeek(today);
      running(s, addDays(s, -7), addDays(s, -1), "This Week", "Last Week");
      break;
    }
    case "last_week": {
      const s = addDays(startOfWeek(today), -7);
      current = range(s, addDays(s, 6), "Last Week");
      previous = range(addDays(s, -7), addDays(s, -1), "Week Before");
      break;
    }
    case "this_month": {
      const s = startOfMonth(today);
      const ps = addMonths(s, -1);
      running(s, ps, endOfMonth(ps), "This Month", "Last Month");
      break;
    }
    case "last_month": {
      const s = addMonths(startOfMonth(today), -1);
      const ps = addMonths(s, -1);
      current = range(s, endOfMonth(s), "Last Month");
      previous = range(ps, endOfMonth(ps), "Month Before");
      break;
    }
    case "this_quarter": {
      const s = startOfQuarter(today, fy);
      const ps = addMonths(s, -3);
      running(s, ps, addDays(s, -1), "This Quarter", "Last Quarter");
      break;
    }
    case "last_quarter": {
      const s = addMonths(startOfQuarter(today, fy), -3);
      const ps = addMonths(s, -3);
      current = range(s, addDays(addMonths(s, 3), -1), "Last Quarter");
      previous = range(ps, addDays(s, -1), "Quarter Before");
      break;
    }
    case "this_year": {
      const s = startOfYear(today, fy);
      const ps = addMonths(s, -12);
      running(s, ps, addDays(s, -1), "This Year", "Previous Year");
      break;
    }
    case "previous_year": {
      const s = addMonths(startOfYear(today, fy), -12);
      const ps = addMonths(s, -12);
      current = range(s, addDays(addMonths(s, 12), -1), "Previous Year");
      previous = range(ps, addDays(s, -1), "Year Before");
      break;
    }
    case "last_30": {
      current = range(addDays(today, -29), today, "Last 30 Days");
      previous = precedingRange(current);
      previous.label = "Previous 30 Days";
      break;
    }
    case "custom": {
      if (!isISODate(opts.from) || !isISODate(opts.to) || opts.from > opts.to) {
        throw new Error("Custom range needs valid from/to dates with from ≤ to");
      }
      current = range(opts.from, opts.to);
      previous = precedingRange(current);
      // Whole calendar months (e.g. "February 2026") compare with the same number of whole months before.
      const months = wholeMonths(opts.from, opts.to);
      if (months) {
        const ps = addMonths(opts.from, -months);
        current.label = monthRangeLabel(opts.from, opts.to);
        previous = range(ps, addDays(opts.from, -1), monthRangeLabel(ps, addDays(opts.from, -1)));
      }
      break;
    }
    default:
      throw new Error(`Unknown period preset: ${preset satisfies never}`);
  }

  // Explicit comparison range overrides the default (e.g. Sep 2026 vs Sep 2025).
  if (isISODate(opts.compareFrom) && isISODate(opts.compareTo) && opts.compareFrom <= opts.compareTo) {
    previous = range(opts.compareFrom, opts.compareTo);
  }

  return { preset, current: clip(current!, maxDate(today, current!.to)), previous: previous! };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Number of whole calendar months from..to, or 0 when the range does not start and end on month boundaries. */
export function wholeMonths(from: ISODate, to: ISODate): number {
  if (from !== startOfMonth(from) || to !== endOfMonth(to) || to < from) return 0;
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
}
/** "February 2026", or "Jan – Mar 2026" for several months. */
export function monthRangeLabel(from: ISODate, to: ISODate): string {
  const a = `${MONTH_NAMES[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return a;
  const b = `${MONTH_NAMES[Number(to.slice(5, 7)) - 1].slice(0, 3)} ${to.slice(0, 4)}`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${a.slice(0, 3)} – ${b}` : `${a.slice(0, 3)} ${from.slice(0, 4)} – ${b}`;
}
/** The last `n` calendar months up to the one containing `today`, newest first, as {value: "2026-02", label}. */
export function recentMonths(today: ISODate, n = 18): { value: string; label: string; from: ISODate; to: ISODate }[] {
  const out = [];
  let m = startOfMonth(today);
  for (let i = 0; i < n; i++, m = addMonths(m, -1)) out.push({ value: m.slice(0, 7), label: monthRangeLabel(m, m), from: m, to: endOfMonth(m) });
  return out;
}

function minDate(a: ISODate, b: ISODate) {
  return a < b ? a : b;
}
function maxDate(a: ISODate, b: ISODate) {
  return a > b ? a : b;
}

export type Granularity = "day" | "week" | "month";

/** Sensible default chart bucket for a range length. */
export function defaultGranularity(from: ISODate, to: ISODate): Granularity {
  const days = daysBetweenInclusive(from, to);
  if (days <= 45) return "day";
  if (days <= 190) return "week";
  return "month";
}
