/**
 * Daily accounts, reconciliation and the closing workflow.
 */
import { z } from "zod";
import type { DayStatus, ReconGroup } from "@prisma/client";
import { reconVariance, totalExpenses, totalIncome } from "@/lib/accounting";
import { addDays, fromDbDate, isISODate, toDbDate, todayISO, type ISODate } from "@/lib/dates";
import { round2, toNum } from "@/lib/money";
import { audit } from "../audit";
import { requirePermission, type Actor } from "../authz";
import { nextStatus } from "../closing";
import { prisma, type Tx } from "../db";
import { badRequest } from "../errors";
import { expenseByKind, expenseByReconGroup, incomeByReconGroup, incomeByStream, incomeByStreamAndGroup, operationalCounts } from "./analytics";

export const RECON_GROUPS: ReconGroup[] = ["CASH", "CARD", "UPI", "BANK", "OTHER"];

function assertDate(date: string): ISODate {
  if (!isISODate(date)) throw badRequest("Invalid date");
  return date;
}

async function ensureDay(tx: Tx, date: ISODate) {
  return tx.dailyAccount.upsert({ where: { date: toDbDate(date) }, create: { date: toDbDate(date) }, update: {} });
}

/** Totals used for the statement and frozen in the closing snapshot. */
async function dayFigures(date: ISODate) {
  const r = { from: date, to: date };
  const [income, expense, counts, byGroup, expenseGroups, streamGroups] = await Promise.all([
    incomeByStream(r),
    expenseByKind(r),
    operationalCounts(r),
    incomeByReconGroup(r),
    expenseByReconGroup(r),
    incomeByStreamAndGroup(r),
  ]);
  const ti = totalIncome(income);
  const te = totalExpenses(expense);
  return { income, expense, counts, totalIncome: ti, totalExpenses: te, netOperatingResult: round2(ti - te), collectionsByMode: byGroup, paymentsByMode: expenseGroups, streamByMode: streamGroups };
}

export async function getDailyStatement(actor: Actor, dateRaw: string) {
  requirePermission(actor, "accounts.view");
  const date = assertDate(dateRaw);
  const [figures, day, pendingCorrections] = await Promise.all([
    dayFigures(date),
    prisma.dailyAccount.findUnique({
      where: { date: toDbDate(date) },
      include: { events: { orderBy: { createdAt: "asc" } }, reconciliations: true },
    }),
    prisma.correctionRequest.count({ where: { status: "PENDING" } }),
  ]);
  const userIds = [...new Set([day?.closedById, day?.reviewedById, day?.reconciledById, ...(day?.events.map((e) => e.userId) ?? [])].filter(Boolean) as string[])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const uname = (id?: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const snapshot = day?.closingSnapshot as { totalIncome: number; totalExpenses: number } | null;
  const drift =
    day?.status === "CLOSED" && snapshot
      ? { income: round2(figures.totalIncome - snapshot.totalIncome), expenses: round2(figures.totalExpenses - snapshot.totalExpenses) }
      : null;
  return {
    date,
    ...figures,
    status: (day?.status ?? "OPEN") as DayStatus,
    reviewedBy: uname(day?.reviewedById),
    reviewedAt: day?.reviewedAt ?? null,
    reconciledBy: uname(day?.reconciledById),
    reconciledAt: day?.reconciledAt ?? null,
    closedBy: uname(day?.closedById),
    closedAt: day?.closedAt ?? null,
    reopenCount: day?.reopenCount ?? 0,
    notes: day?.notes ?? null,
    events: (day?.events ?? []).map((e) => ({ ...e, userName: uname(e.userId) })),
    reconciliation: RECON_GROUPS.map((g) => {
      const saved = day?.reconciliations.find((x) => x.reconGroup === g);
      const expected = figures.collectionsByMode[g] ?? 0;
      return {
        group: g,
        expected,
        actual: saved ? toNum(saved.actual) : null,
        savedExpected: saved ? toNum(saved.expected) : null,
        variance: saved ? round2(toNum(saved.actual) - expected) : null,
        explanation: saved?.explanation ?? null,
        stale: saved ? toNum(saved.expected) !== expected : false,
      };
    }),
    closedDrift: drift && (drift.income !== 0 || drift.expenses !== 0) ? drift : null,
    pendingCorrections,
  };
}

const reconInput = z.object({
  lines: z
    .array(
      z.object({
        group: z.enum(["CASH", "CARD", "UPI", "BANK", "OTHER"]),
        actual: z.coerce.number().min(-99_99_99_999).max(99_99_99_999),
        explanation: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Save reconciliation (actual collected per mode). Expected amounts are always
 * recomputed on the server. Any non-zero variance needs an explanation.
 */
export async function saveReconciliation(actor: Actor, dateRaw: string, raw: unknown) {
  requirePermission(actor, "accounts.reconcile");
  const date = assertDate(dateRaw);
  const input = reconInput.parse(raw);
  const expected = await incomeByReconGroup({ from: date, to: date });
  const missing: string[] = [];
  for (const l of input.lines) {
    const v = reconVariance(expected[l.group] ?? 0, round2(l.actual));
    if (v.needsExplanation && !(l.explanation && l.explanation.length >= 5)) missing.push(l.group);
  }
  if (missing.length) throw badRequest(`Explain the variance for: ${missing.join(", ")}`, { missing });

  return prisma.$transaction(async (tx) => {
    const day = await ensureDay(tx, date);
    if (day.status === "CLOSED") throw badRequest("Day is closed. Reopen it to change the reconciliation.");
    if (day.status === "OPEN") throw badRequest("Mark the day as reviewed before reconciling.");
    const before = await tx.reconciliation.findMany({ where: { dailyAccountId: day.id } });
    for (const l of input.lines) {
      const exp = expected[l.group] ?? 0;
      const actual = round2(l.actual);
      const data = { expected: exp, actual, variance: round2(actual - exp), explanation: l.explanation || null, userId: actor.id };
      await tx.reconciliation.upsert({
        where: { dailyAccountId_reconGroup: { dailyAccountId: day.id, reconGroup: l.group } },
        create: { dailyAccountId: day.id, reconGroup: l.group, ...data },
        update: data,
      });
    }
    // Every group must have a saved line for the day to count as reconciled.
    const saved = await tx.reconciliation.findMany({ where: { dailyAccountId: day.id } });
    const complete = RECON_GROUPS.every((g) => saved.some((s) => s.reconGroup === g));
    const to = complete ? nextStatus("reconcile", day.status) : day.status;
    await tx.dailyAccount.update({
      where: { id: day.id },
      data: { status: to, notes: input.notes ?? day.notes, ...(complete ? { reconciledById: actor.id, reconciledAt: new Date() } : {}) },
    });
    if (to !== day.status) {
      await tx.dayEvent.create({ data: { dailyAccountId: day.id, fromStatus: day.status, toStatus: to, action: "RECONCILE", userId: actor.id } });
    }
    await audit(tx, actor, { action: "RECONCILE", entityType: "DailyAccount", entityId: day.id, before, after: saved, reason: input.notes ?? null });
    return { status: to };
  });
}

const statusInput = z.object({
  action: z.enum(["review", "close", "reopen"]),
  reason: z.string().trim().max(500).optional(),
});

export async function changeDayStatus(actor: Actor, dateRaw: string, raw: unknown) {
  const date = assertDate(dateRaw);
  const { action, reason } = statusInput.parse(raw);
  if (action === "review") requirePermission(actor, "accounts.reconcile");
  if (action === "close") requirePermission(actor, "accounts.close");
  if (action === "reopen") {
    requirePermission(actor, "accounts.reopen");
    if (!reason || reason.length < 5) throw badRequest("A reason is required to reopen a day");
  }
  if (action === "close" && date > todayISO()) throw badRequest("Cannot close a future date");

  const figures = action === "close" ? await dayFigures(date) : null;
  return prisma.$transaction(async (tx) => {
    const day = await ensureDay(tx, date);
    const to = nextStatus(action, day.status);
    if (action === "close") {
      const recon = await tx.reconciliation.findMany({ where: { dailyAccountId: day.id } });
      // The reconciliation must match today's expected amounts (nothing changed since).
      const stale = recon.filter((r) => toNum(r.expected) !== (figures!.collectionsByMode[r.reconGroup] ?? 0));
      if (stale.length) throw badRequest("Transactions changed after reconciliation. Reconcile again before closing.");
    }
    await tx.dailyAccount.update({
      where: { id: day.id },
      data: {
        status: to,
        ...(action === "review" ? { reviewedById: actor.id, reviewedAt: new Date() } : {}),
        ...(action === "close"
          ? { closedById: actor.id, closedAt: new Date(), closingSnapshot: JSON.parse(JSON.stringify({ ...figures, closedAt: new Date() })) }
          : {}),
        ...(action === "reopen" ? { reopenCount: { increment: 1 }, closedAt: null, closedById: null, reconciledAt: null, reconciledById: null } : {}),
      },
    });
    await tx.dayEvent.create({ data: { dailyAccountId: day.id, fromStatus: day.status, toStatus: to, action: action.toUpperCase(), reason: reason ?? null, userId: actor.id } });
    await audit(tx, actor, {
      action: `DAY_${action.toUpperCase()}`,
      entityType: "DailyAccount",
      entityId: day.id,
      before: { date, status: day.status },
      after: { date, status: to },
      reason: reason ?? null,
    });
    return { status: to };
  });
}

/** Day status list for a date range (calendar / "days not closed" alert). */
export async function listDays(actor: Actor, from: ISODate, to: ISODate) {
  requirePermission(actor, "accounts.view");
  const [days, activity] = await Promise.all([
    prisma.dailyAccount.findMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) } }, include: { reconciliations: true } }),
    prisma.$queryRaw<{ date: Date; income: number; lines: bigint }[]>`
      SELECT date, SUM(amount)::float AS income, COUNT(*) AS lines FROM v_income_line
       WHERE date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)} GROUP BY date`,
  ]);
  const expenses = await prisma.$queryRaw<{ date: Date; amount: number }[]>`
    SELECT date, SUM(amount)::float AS amount FROM v_expense_line WHERE date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)} GROUP BY date`;
  const out = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const day = days.find((x) => fromDbDate(x.date) === d);
    const act = activity.find((x) => fromDbDate(x.date) === d);
    const exp = expenses.find((x) => fromDbDate(x.date) === d);
    const variance = day?.reconciliations.reduce((a, r) => a + Math.abs(toNum(r.variance)), 0) ?? 0;
    out.push({
      date: d,
      status: day?.status ?? "OPEN",
      income: round2(act?.income ?? 0),
      expenses: round2(exp?.amount ?? 0),
      lines: Number(act?.lines ?? 0),
      absVariance: round2(variance),
      reopenCount: day?.reopenCount ?? 0,
    });
  }
  return out;
}
