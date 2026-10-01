import { addDays, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { resolvePeriod, type CompareMode, type PeriodPreset } from "@/lib/periods";
import { formatINR } from "@/lib/money";
import { totalIncome } from "@/lib/accounting";
import { can, requirePermission, type Actor } from "../authz";
import { prisma } from "../db";
import { getSettings, type AppSettings } from "../settings";
import { compareSummaries, incomeByReconGroup, incomeSeries, outstandingIpd, periodSummary } from "./analytics";
import { defaultGranularity } from "@/lib/periods";

export interface Alert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  href?: string;
}

export async function getDashboard(actor: Actor, q: { preset?: string; from?: string; to?: string; compareMode?: string; compareFrom?: string; compareTo?: string }) {
  requirePermission(actor, "dashboard.view");
  const settings = await getSettings();
  const today = todayISO();
  const period = resolvePeriod({
    preset: (q.preset as PeriodPreset) || "today",
    today,
    from: q.from,
    to: q.to,
    compareMode: (q.compareMode as CompareMode) || "like_for_like",
    fyStartMonth: settings.fiscalYearStartMonth,
    compareFrom: q.compareFrom,
    compareTo: q.compareTo,
  });
  const granularity = defaultGranularity(period.current.from, period.current.to);
  const trendRange = period.current.from === period.current.to ? { from: addDays(period.current.to, -13), to: period.current.to } : period.current;
  const trendGranularity = period.current.from === period.current.to ? "day" : granularity;
  const [current, previous, modes, trend] = await Promise.all([
    periodSummary(period.current),
    periodSummary(period.previous),
    incomeByReconGroup(period.current),
    incomeSeries(trendRange, trendGranularity),
  ]);
  const alerts = settings.alerts.enabled ? await computeAlerts(actor, settings, today, current, previous) : [];
  const expenseBasis = await expenseBasisFor(period.current);
  return { today, period, current, previous, comparison: compareSummaries(current, previous), collectionsByMode: modes, alerts, trend, trendGranularity, trendRange, expenseBasis };
}

/**
 * Why "Total Expenses" can differ from the expenses entered in the period: monthly items (salaries,
 * rent…) count only their daily share. Returns what was entered with dates in the period and how much
 * of the total is spread shares, both AED only (pharmacy-department costs excluded).
 */
async function expenseBasisFor(r: { from: ISODate; to: ISODate }) {
  const [entered, spread] = await Promise.all([
    prisma.$queryRaw<{ amount: number | null; n: bigint }[]>`
      SELECT SUM(e.amount)::float AS amount, COUNT(*) AS n FROM "Expense" e LEFT JOIN "Department" d ON d.id = e."departmentId"
       WHERE e.status = 'ACTIVE' AND e.date BETWEEN ${toDbDate(r.from)} AND ${toDbDate(r.to)} AND d.name IS DISTINCT FROM 'Pharmacy'`,
    prisma.$queryRaw<{ amount: number | null }[]>`
      SELECT SUM(amount)::float AS amount FROM v_expense_line
       WHERE spread AND kind IN ('HOSPITAL', 'OTHER') AND date BETWEEN ${toDbDate(r.from)} AND ${toDbDate(r.to)}`,
  ]);
  return { entered: Math.round((entered[0]?.amount ?? 0) * 100) / 100, enteredCount: Number(entered[0]?.n ?? 0), spreadShare: Math.round((spread[0]?.amount ?? 0) * 100) / 100 };
}

async function computeAlerts(
  actor: Actor,
  s: AppSettings,
  today: ISODate,
  current: Awaited<ReturnType<typeof periodSummary>>,
  previous: Awaited<ReturnType<typeof periodSummary>>,
): Promise<Alert[]> {
  const a = s.alerts;
  const alerts: Alert[] = [];
  const lookFrom = addDays(today, -a.unclosedDaysLookback);
  const yesterday = addDays(today, -1);

  // 1. Days with activity that are not closed (excluding today).
  if (can(actor, "accounts.view")) {
    const unclosed = await prisma.$queryRaw<{ date: Date }[]>`
      SELECT DISTINCT v.date FROM v_income_line v
        LEFT JOIN "DailyAccount" d ON d.date = v.date
       WHERE v.stream <> 'PHARMACY' AND v.date BETWEEN ${toDbDate(lookFrom)} AND ${toDbDate(yesterday)} AND COALESCE(d.status::text, 'OPEN') <> 'CLOSED'
       ORDER BY v.date`;
    if (unclosed.length) {
      alerts.push({
        id: "unclosed",
        severity: unclosed.length > 3 ? "critical" : "warning",
        title: `${unclosed.length} day(s) not closed`,
        detail: `Oldest: ${unclosed[0].date.toISOString().slice(0, 10)}. Review, reconcile and close them.`,
        href: "/accounting",
      });
    }
    // 2. Unreconciled variance.
    const variances = await prisma.reconciliation.findMany({
      where: { dailyAccount: { date: { gte: toDbDate(lookFrom) } }, NOT: { variance: 0 } },
      include: { dailyAccount: true },
    });
    const bad = variances.filter((v) => Math.abs(Number(v.variance)) > a.reconVarianceTolerance);
    if (bad.length) {
      alerts.push({ id: "variance", severity: "warning", title: `${bad.length} reconciliation variance(s)`, detail: "Collected amounts differ from the system's expected amounts.", href: "/accounting" });
    }
    // 3. Pending correction approvals.
    const pending = await prisma.correctionRequest.count({ where: { status: "PENDING" } });
    if (pending && can(actor, "corrections.approve")) {
      alerts.push({ id: "corrections", severity: "info", title: `${pending} correction request(s) awaiting approval`, detail: "Changes requested on closed days.", href: "/accounting?tab=corrections" });
    }
  }

  // 4. Missing department data: past days (in lookback) with OPD but no lab entries, or no entries at all.
  const missFrom = addDays(today, -a.missingDataLookbackDays);
  const perDay = await prisma.$queryRaw<{ date: Date; streams: string[] }[]>`
    SELECT date, array_agg(DISTINCT stream) AS streams FROM v_income_line
     WHERE date BETWEEN ${toDbDate(missFrom)} AND ${toDbDate(yesterday)} GROUP BY date`;
  const missingDays: string[] = [];
  for (let d = missFrom; d <= yesterday; d = addDays(d, 1)) {
    const hit = perDay.find((p) => p.date.toISOString().slice(0, 10) === d);
    const isSunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
    if (!isSunday && (!hit || !hit.streams.includes("OPD"))) missingDays.push(d);
  }
  if (missingDays.length) {
    alerts.push({ id: "missing", severity: "warning", title: `No OPD entries on ${missingDays.length} working day(s)`, detail: missingDays.slice(-5).join(", "), href: "/opd" });
  }

  // 5. Large expenses in the current period.
  if (can(actor, "expense.view_all")) {
    const big = await prisma.expense.findMany({
      where: { status: "ACTIVE", amount: { gte: a.largeExpenseAmount }, date: { gte: toDbDate(current.range.from), lte: toDbDate(current.range.to) } },
      orderBy: { amount: "desc" },
      take: 3,
    });
    if (big.length) {
      alerts.push({ id: "large-expense", severity: "info", title: `${big.length} large expense(s) ≥ ${formatINR(a.largeExpenseAmount)}`, detail: big.map((e) => `${e.description} (${formatINR(Number(e.amount))})`).join("; "), href: `/expenses?from=${current.range.from}&to=${current.range.to}` });
    }
  }

  // 6. Revenue significantly different from the previous period.
  const ci = totalIncome(current.income);
  const pi = totalIncome(previous.income);
  if (pi > 0) {
    const pct = ((ci - pi) / pi) * 100;
    if (Math.abs(pct) >= a.revenueDeviationPct) {
      alerts.push({ id: "revenue-deviation", severity: pct < 0 ? "warning" : "info", title: `Revenue ${pct < 0 ? "down" : "up"} ${Math.abs(pct).toFixed(0)}% vs ${previous.range.label}`, detail: `${formatINR(ci)} vs ${formatINR(pi)}`, href: "/analytics?tab=revenue" });
    }
  }

  // 7. Outstanding IPD balance.
  if (can(actor, "ipd.view")) {
    const out = await outstandingIpd(today);
    if (out.total >= a.outstandingIpdAmount && out.count) {
      alerts.push({ id: "ipd-outstanding", severity: "warning", title: `IPD outstanding ${formatINR(out.total)}`, detail: `${out.count} admission(s) with balance due`, href: "/ipd?tab=outstanding" });
    }
  }

  // 8. Duplicate imports (duplicate rows force-imported in the lookback window).
  if (can(actor, "import.run")) {
    const forced = await prisma.importRecord.count({ where: { forceImport: true, status: "IMPORTED", batch: { committedAt: { gte: toDbDate(lookFrom) } } } });
    const sameFile = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (SELECT "fileHash" FROM "ImportBatch" WHERE status = 'IMPORTED' GROUP BY "fileHash", "sheetName" HAVING COUNT(*) > 1) x`;
    const n = forced + Number(sameFile[0]?.n ?? 0);
    if (n) alerts.push({ id: "dup-import", severity: "warning", title: "Possible duplicate imports", detail: `${forced} duplicate row(s) force-imported; ${Number(sameFile[0]?.n ?? 0)} file(s) imported more than once.`, href: "/import?tab=history" });
  }
  if (can(actor, "expense.approve")) {
    const pendingExp = await prisma.expense.aggregate({ where: { status: "PENDING" }, _count: true, _sum: { amount: true } });
    if (pendingExp._count)
      alerts.push({
        id: "expense-approval",
        severity: "warning",
        title: `${pendingExp._count} expense(s) waiting for your approval`,
        detail: `${formatINR(Number(pendingExp._sum.amount ?? 0))} entered by staff — not counted until approved.`,
        href: "/expenses?tab=pending",
      });
  }
  return alerts;
}
