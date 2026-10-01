/**
 * Are the accounts up to date? For each income stream and for expenses: the last date that has any
 * entry. A stream is "behind" when that date is more than its allowance older than the day being
 * looked at (today, or the end of the period on screen). Used for the "not updated" banner and the
 * dashboard alert, so nobody reads a total that silently stops at an earlier date.
 */
import { Prisma } from "@prisma/client";
import { addDays, daysBetweenInclusive, fromDbDate, isISODate, todayISO, type ISODate } from "@/lib/dates";
import { prisma } from "../db";

/** Days a stream may go without entries before it is flagged (quiet units get more slack). */
export const FRESHNESS_STREAMS = [
  { key: "opd", label: "OPD", table: "Consultation", allowance: 2, href: "/opd", core: true },
  { key: "lab", label: "Laboratory", table: "LabTransaction", allowance: 2, href: "/lab", core: true },
  { key: "pharmacy", label: "Hormonal Pharmacy sales", table: "PharmacySale", allowance: 2, href: "/pharmacy", core: true },
  { key: "expense", label: "Expenses", table: "Expense", allowance: 3, href: "/expenses", core: true },
  { key: "purchase", label: "Pharmacy purchases", table: "PharmacyPurchase", allowance: 7, href: "/pharmacy?tab=purchases", core: false },
  { key: "ipd", label: "IPD collections", table: "IpdTransaction", allowance: 7, href: "/ipd", core: false },
  { key: "diet", label: "Diet & Nutrition", table: "DietTransaction", allowance: 7, href: "/diet", core: false },
] as const;

export interface StreamFreshness {
  key: string;
  label: string;
  href: string;
  lastDate: ISODate | null;
  /** Days between the last entry and the reference day (0 = has entries on it). */
  daysBehind: number | null;
  behind: boolean;
}

export async function dataFreshness(toRaw?: string | null) {
  const today = todayISO();
  const ref: ISODate = toRaw && isISODate(toRaw) && toRaw < today ? (toRaw as ISODate) : today;
  const parts = FRESHNESS_STREAMS.map(
    (s) => Prisma.sql`SELECT ${s.key} AS key, MAX(date) AS last FROM ${Prisma.raw(`"${s.table}"`)} WHERE status = 'ACTIVE' AND date <= ${new Date(`${ref}T00:00:00Z`)}`,
  );
  const rows = await prisma.$queryRaw<{ key: string; last: Date | null }[]>`${Prisma.join(parts, " UNION ALL ")}`;
  const last = new Map(rows.map((r) => [r.key, r.last ? fromDbDate(r.last) : null]));
  const streams: StreamFreshness[] = FRESHNESS_STREAMS.map((s) => {
    const d = last.get(s.key) ?? null;
    const behindDays = d ? daysBetweenInclusive(d, ref) - 1 : null;
    // Streams never used at all are only flagged when they are core (OPD, lab, pharmacy, expenses).
    const behind = d ? behindDays! > s.allowance : s.core;
    return { key: s.key, label: s.label, href: s.href, lastDate: d, daysBehind: behindDays, behind };
  });
  return { today, ref, refIsToday: ref === today, streams, behind: streams.filter((s) => s.behind), yesterday: addDays(today, -1) };
}
