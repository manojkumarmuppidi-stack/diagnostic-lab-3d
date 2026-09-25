import {
  addDays,
  addMonths,
  daysBetweenInclusive,
  endOfMonth,
  formatDate,
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

function range(from: ISODate, to: ISODate, label?: string): DateRange {
  return { from, to, label: label ?? (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`) };
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
