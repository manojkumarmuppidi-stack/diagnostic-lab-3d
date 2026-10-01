/**
 * What needs someone's attention, per person: shown in the bell and popped up (in the app, and as
 * a phone/desktop notification when allowed) while the app is open. Each item's id changes when
 * its content changes (e.g. the count), so the same reminder pops up only once until it changes.
 */
import { addDays, formatDayMonth, todayISO } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { monthLabel } from "@/lib/expenses";
import { can, type Actor } from "../authz";
import { prisma } from "../db";
import { monthlyChecklist } from "./expenses";
import { dataFreshness } from "./freshness";
import { listDays } from "./daily";

export interface Notice {
  id: string;
  tone: "bad" | "warn" | "info";
  title: string;
  detail?: string;
  href: string;
}

/** Monthly routine bills are flagged from this day of the month on. */
export const ROUTINE_REMINDER_DAY = 5;

export async function notificationsFor(actor: Actor): Promise<{ items: Notice[]; generatedAt: string }> {
  const today = todayISO();
  const items: Notice[] = [];
  const jobs: Promise<void>[] = [];

  if (can(actor, "expense.approve"))
    jobs.push(
      prisma.expense.aggregate({ where: { status: "PENDING" }, _count: true, _sum: { amount: true } }).then((p) => {
        if (p._count)
          items.push({ id: `approvals:${p._count}`, tone: "warn", title: `${p._count} expense${p._count === 1 ? "" : "s"} waiting for your approval`, detail: `${formatINR(Number(p._sum.amount ?? 0))} in total`, href: "/expenses?tab=pending" });
      }),
    );
  else if (can(actor, "expense.write"))
    jobs.push(
      prisma.expense.findMany({ where: { createdById: actor.id, status: "VOIDED", voidReason: { startsWith: "Rejected:" }, updatedAt: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: { updatedAt: "desc" }, take: 5 }).then((rs) => {
        for (const r of rs) items.push({ id: `rejected:${r.id}`, tone: "bad", title: `Expense not approved: ${r.description}`, detail: r.voidReason!.replace(/^Rejected:\s*/, ""), href: "/expenses?tab=list" });
      }),
    );

  if (can(actor, "expense.view_all") && Number(today.slice(8)) >= ROUTINE_REMINDER_DAY)
    jobs.push(
      monthlyChecklist(actor, today.slice(0, 7)).then((c) => {
        const missing = c.rows.filter((r) => r.state === "missing");
        if (missing.length)
          items.push({
            id: `routine:${today.slice(0, 7)}:${missing.length}`,
            tone: "info",
            title: `${missing.length} monthly expense${missing.length === 1 ? "" : "s"} not booked yet for ${monthLabel(today.slice(0, 7))}`,
            detail: missing.slice(0, 4).map((r) => r.name).join(", ") + (missing.length > 4 ? "…" : "") + (c.summary.expectedMissing ? ` · about ${formatINR(c.summary.expectedMissing)}` : ""),
            href: "/expenses?tab=checklist",
          });
      }),
    );

  if (can(actor, "accounts.view")) {
    jobs.push(
      dataFreshness().then((f) => {
        for (const s of f.behind)
          items.push({
            id: `stale:${s.key}:${s.lastDate ?? "never"}`,
            tone: "bad",
            title: `${s.label} not updated${s.lastDate ? ` since ${formatDayMonth(s.lastDate)}` : ""}`,
            detail: s.lastDate ? `${s.daysBehind} days without entries` : "No entries yet",
            href: s.href,
          });
      }),
    );
    if (can(actor, "accounts.close"))
      jobs.push(
        listDays(actor, addDays(today, -60), addDays(today, -1)).then((days) => {
          const open = days.filter((d) => d.status !== "CLOSED" && d.lines > 0);
          if (open.length)
            items.push({ id: `close:${open.length}:${open[open.length - 1].date}`, tone: "warn", title: `${open.length} day${open.length === 1 ? "" : "s"} to reconcile and close`, detail: `Oldest: ${formatDayMonth(open[open.length - 1].date)}`, href: "/accounting" });
        }),
      );
  }
  await Promise.all(jobs);
  const order = { bad: 0, warn: 1, info: 2 };
  items.sort((a, b) => order[a.tone] - order[b.tone]);
  return { items, generatedAt: new Date().toISOString() };
}
