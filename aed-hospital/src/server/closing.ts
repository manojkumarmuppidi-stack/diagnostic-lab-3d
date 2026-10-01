/**
 * Daily closing state machine:  OPEN → REVIEW → RECONCILED → CLOSED,  CLOSED → OPEN (reopen, Admin).
 * A missing DailyAccount row means OPEN.
 */
import type { DayStatus } from "@prisma/client";
import { toDbDate, type ISODate } from "@/lib/dates";
import { audit } from "./audit";
import type { Actor } from "./authz";
import type { Tx } from "./db";
import { badRequest, dayLocked } from "./errors";
import { bulkCache } from "./bulk-cache";

export const DAY_TRANSITIONS: Record<string, { from: DayStatus[]; to: DayStatus }> = {
  review: { from: ["OPEN"], to: "REVIEW" },
  reconcile: { from: ["REVIEW", "RECONCILED"], to: "RECONCILED" },
  close: { from: ["RECONCILED"], to: "CLOSED" },
  reopen: { from: ["CLOSED", "REVIEW", "RECONCILED"], to: "OPEN" },
};

export function nextStatus(action: keyof typeof DAY_TRANSITIONS, current: DayStatus): DayStatus {
  const t = DAY_TRANSITIONS[action];
  if (!t) throw badRequest(`Unknown action ${action}`);
  if (!t.from.includes(current)) throw badRequest(`Cannot ${action} a day that is ${current}`);
  return t.to;
}

export async function getDayStatus(tx: Tx, date: ISODate): Promise<DayStatus> {
  const d = await tx.dailyAccount.findUnique({ where: { date: toDbDate(date) }, select: { status: true } });
  return d?.status ?? "OPEN";
}

/** Map of date → status for many dates (missing ⇒ OPEN). */
export async function getDayStatuses(tx: Tx, dates: ISODate[]): Promise<Map<ISODate, DayStatus>> {
  const unique = [...new Set(dates)];
  const rows = unique.length
    ? await tx.dailyAccount.findMany({ where: { date: { in: unique.map(toDbDate) } }, select: { date: true, status: true } })
    : [];
  const m = new Map<ISODate, DayStatus>(unique.map((d) => [d, "OPEN"]));
  for (const r of rows) m.set(r.date.toISOString().slice(0, 10), r.status);
  return m;
}

/**
 * Throw 423 if the business date is CLOSED. Applies to every role, Admin included (Admin must reopen),
 * except inside an Admin's historical-backfill import, which re-snapshots the closed days it touches.
 */
export async function assertDayWritable(tx: Tx, date: ISODate) {
  const cache = bulkCache();
  if (cache?.allowClosed) return;
  let status = cache?.days.get(date);
  if (!status) {
    status = await getDayStatus(tx, date);
    cache?.days.set(date, status);
  }
  if (status === "CLOSED") throw dayLocked(date);
}

/**
 * Called after any financial change on `date`. A RECONCILED day becomes stale and
 * drops back to REVIEW so it must be reconciled again before closing.
 */
export async function onDayMutated(tx: Tx, actor: Actor | null, date: ISODate, what: string) {
  const d = await tx.dailyAccount.findUnique({ where: { date: toDbDate(date) } });
  if (d?.status === "RECONCILED") {
    await tx.dailyAccount.update({ where: { id: d.id }, data: { status: "REVIEW", reconciledAt: null, reconciledById: null } });
    await tx.dayEvent.create({
      data: { dailyAccountId: d.id, fromStatus: "RECONCILED", toStatus: "REVIEW", action: "AUTO_UNRECONCILE", reason: `Changed after reconciliation: ${what}`, userId: actor?.id },
    });
    await audit(tx, actor, { action: "DAY_AUTO_UNRECONCILE", entityType: "DailyAccount", entityId: d.id, reason: what, after: { date } });
  }
}
