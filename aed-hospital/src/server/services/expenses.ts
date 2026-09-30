/**
 * Expense approvals, the monthly checklist of recurring heads, and month-wise segregation.
 *
 * Staff-entered expenses are stored with status PENDING (see insertRecord). Every figure in the
 * app counts ACTIVE rows only, so a pending expense is invisible to totals until an approver
 * approves it (→ ACTIVE) or rejects it (→ VOIDED with the reason). The DB status guard allows
 * exactly those two moves out of PENDING.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { addMonths, endOfMonth, fromDbDate, isISODate, startOfMonth, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { toNum, round2 } from "@/lib/money";
import { audit } from "../audit";
import { can, requirePermission, type Actor } from "../authz";
import { assertDayWritable, onDayMutated } from "../closing";
import { prisma } from "../db";
import { badRequest, notFound } from "../errors";

const D = toDbDate;

export async function listPendingExpenses(actor: Actor) {
  requirePermission(actor, "expense.view");
  const rows = await prisma.expense.findMany({
    where: { status: "PENDING", ...(can(actor, "expense.approve") ? {} : { createdById: actor.id }) },
    include: { category: true, subcategory: true, paymentMode: true, head: true, _count: { select: { attachments: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return {
    canApprove: can(actor, "expense.approve"),
    total: round2(rows.reduce((a, r) => a + toNum(r.amount), 0)),
    rows: rows.map((r) => ({
      id: r.id,
      date: fromDbDate(r.date),
      head: r.head?.name ?? null,
      category: r.category.name,
      subcategory: r.subcategory?.name ?? null,
      description: r.description,
      vendor: r.vendor,
      billNumber: r.billNumber,
      amount: toNum(r.amount),
      paymentMode: r.paymentMode?.name ?? null,
      remarks: r.remarks,
      attachments: r._count.attachments,
      enteredBy: byId.get(r.createdById) ?? "—",
      enteredAt: r.createdAt,
    })),
  };
}

const decisionInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(500).optional(),
});

export async function decideExpense(actor: Actor, id: string, raw: unknown) {
  requirePermission(actor, "expense.approve");
  const { decision, reason } = decisionInput.parse(raw);
  if (decision === "REJECT" && (!reason || reason.length < 3)) throw badRequest("Give a reason for rejecting (at least 3 characters)");
  return prisma.$transaction(async (tx) => {
    const row = await tx.expense.findUnique({ where: { id } });
    if (!row) throw notFound("Expense not found");
    if (row.status !== "PENDING") throw badRequest(`This expense is already ${row.status.toLowerCase()}`);
    const date = fromDbDate(row.date);
    // Approving changes the day's figures, so a closed day must be reopened first.
    if (decision === "APPROVE") await assertDayWritable(tx, date);
    const updated = await tx.expense.update({
      where: { id },
      data: decision === "APPROVE" ? { status: "ACTIVE", approvedById: actor.id, approvedAt: new Date() } : { status: "VOIDED", voidReason: `Rejected: ${reason}` },
    });
    await audit(tx, actor, {
      action: decision === "APPROVE" ? "EXPENSE_APPROVE" : "EXPENSE_REJECT",
      entityType: "Expense",
      entityId: id,
      before: { status: "PENDING" },
      after: { status: updated.status, amount: toNum(updated.amount), description: updated.description },
      reason: reason ?? null,
    });
    if (decision === "APPROVE") await onDayMutated(tx, actor, date, "Expense approved");
    return { id, status: updated.status };
  });
}

export async function pendingExpenseCount(actor: Actor) {
  if (!can(actor, "expense.approve")) return 0;
  return prisma.expense.count({ where: { status: "PENDING" } });
}

/**
 * For a month: every monthly head, what has been entered against it (approved and pending),
 * and what was paid last month — so staff see at a glance what is still missing.
 */
export async function monthlyChecklist(actor: Actor, monthRaw?: string) {
  requirePermission(actor, "expense.view");
  const month = monthRaw && /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : todayISO().slice(0, 7);
  const from = `${month}-01` as ISODate;
  const to = endOfMonth(from);
  const prevFrom = addMonths(from, -1);
  const prevTo = endOfMonth(prevFrom);
  const [heads, cur, prev] = await Promise.all([
    prisma.expenseHead.findMany({ where: { active: true }, include: { category: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.expense.groupBy({ by: ["headId", "status"], where: { headId: { not: null }, status: { in: ["ACTIVE", "PENDING"] }, date: { gte: D(from), lte: D(to) } }, _sum: { amount: true }, _count: true }),
    prisma.expense.groupBy({ by: ["headId"], where: { headId: { not: null }, status: "ACTIVE", date: { gte: D(prevFrom), lte: D(prevTo) } }, _sum: { amount: true } }),
  ]);
  const key = (h: string | null, s: string) => `${h}|${s}`;
  const curMap = new Map(cur.map((c) => [key(c.headId, c.status), { amount: toNum(c._sum.amount), count: c._count }]));
  const prevMap = new Map(prev.map((p) => [p.headId, toNum(p._sum.amount)]));
  const rows = heads.map((h) => {
    const approved = curMap.get(key(h.id, "ACTIVE"));
    const pending = curMap.get(key(h.id, "PENDING"));
    return {
      id: h.id,
      name: h.name,
      category: h.category.name,
      vendor: h.vendor,
      monthly: h.monthly,
      approved: approved?.amount ?? 0,
      pending: pending?.amount ?? 0,
      entries: (approved?.count ?? 0) + (pending?.count ?? 0),
      lastMonth: prevMap.get(h.id) ?? 0,
      expected: h.typicalAmount === null ? prevMap.get(h.id) ?? null : toNum(h.typicalAmount),
      state: approved ? "done" : pending ? "pending" : h.monthly ? "missing" : "optional",
    };
  });
  return {
    month,
    rows,
    summary: {
      heads: rows.filter((r) => r.monthly).length,
      done: rows.filter((r) => r.monthly && r.state === "done").length,
      pending: rows.filter((r) => r.state === "pending").length,
      missing: rows.filter((r) => r.state === "missing").length,
      expectedMissing: round2(rows.filter((r) => r.state === "missing").reduce((a, r) => a + (r.expected ?? 0), 0)),
    },
  };
}

/**
 * Month-wise segregation: approved expenses by category (or head) × month for a range, plus
 * pharmacy purchases as their own line so the grand total equals Total Expenses.
 */
export async function expensePivot(actor: Actor, q: { from?: string; to?: string; by?: string }) {
  requirePermission(actor, "expense.view");
  const to = q.to && isISODate(q.to) ? q.to : todayISO();
  const from = q.from && isISODate(q.from) ? q.from : startOfMonth(addMonths(to, -5));
  const by = q.by === "head" ? "head" : q.by === "subcategory" ? "subcategory" : "category";
  const rows = await prisma.$queryRaw<{ label: string; grp: string; month: string; amount: Prisma.Decimal; n: bigint }[]>`
    SELECT ${
      by === "head"
        ? Prisma.sql`COALESCE(h.name, '(no head) ' || c.name)`
        : by === "subcategory"
          ? Prisma.sql`c.name || COALESCE(' / ' || s.name, '')`
          : Prisma.sql`c.name`
    } AS label, c."group"::text AS grp, to_char(e.date, 'YYYY-MM') AS month, SUM(e.amount) AS amount, COUNT(*) AS n
      FROM "Expense" e
      JOIN "ExpenseCategory" c ON c.id = e."categoryId"
      LEFT JOIN "ExpenseCategory" s ON s.id = e."subcategoryId"
      LEFT JOIN "ExpenseHead" h ON h.id = e."headId"
     WHERE e.status = 'ACTIVE' AND e.date BETWEEN ${D(from as ISODate)} AND ${D(to as ISODate)}
     GROUP BY 1, 2, 3`;
  const purchases = await prisma.$queryRaw<{ month: string; amount: Prisma.Decimal; n: bigint }[]>`
    SELECT to_char(date, 'YYYY-MM') AS month, SUM(amount) AS amount, COUNT(*) AS n FROM "PharmacyPurchase"
     WHERE status = 'ACTIVE' AND date BETWEEN ${D(from as ISODate)} AND ${D(to as ISODate)} GROUP BY 1`;
  const months: string[] = [];
  for (let m = startOfMonth(from as ISODate); m <= to; m = addMonths(m, 1)) months.push(m.slice(0, 7));
  const table = new Map<string, { label: string; group: string; byMonth: Record<string, number>; total: number; entries: number }>();
  const add = (label: string, group: string, month: string, amount: number, n: number) => {
    const r = table.get(label) ?? { label, group, byMonth: {}, total: 0, entries: 0 };
    r.byMonth[month] = round2((r.byMonth[month] ?? 0) + amount);
    r.total = round2(r.total + amount);
    r.entries += n;
    table.set(label, r);
  };
  for (const r of rows) add(r.label, r.grp, r.month, toNum(r.amount), Number(r.n));
  for (const p of purchases) add("Pharmacy purchases (stock)", "PHARMACY_PURCHASE", p.month, toNum(p.amount), Number(p.n));
  const lines = [...table.values()].sort((a, b) => b.total - a.total);
  const totals: Record<string, number> = {};
  for (const m of months) totals[m] = round2(lines.reduce((a, l) => a + (l.byMonth[m] ?? 0), 0));
  return { from, to, by, months, lines, totals, grandTotal: round2(lines.reduce((a, l) => a + l.total, 0)) };
}
