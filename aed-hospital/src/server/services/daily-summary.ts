/**
 * One-page "Today at AED" summary: the day's income, counts, payment modes, top tests and
 * medicines, compared with the day before, the same weekday last week and a typical
 * (average of the last four same weekdays) day — plus plain-language insights.
 */
import { addDays, isISODate, todayISO, type ISODate } from "@/lib/dates";
import { STREAM_LABELS, totalIncome, AED_INCOME_STREAMS } from "@/lib/accounting";
import { insightsFromComparison, insightsFromKpis, rankInsights, type Comparison, type Insight, type KpiCompare } from "@/lib/insights";
import { round2 } from "@/lib/money";
import { can, requirePermission, type Actor } from "../authz";
import { getDayStatuses } from "../closing";
import { prisma } from "../db";
import { incomeByReconGroup, incomeByStream, incomeSeries, labAnalytics, periodSummary, pharmacyItemAnalytics } from "./analytics";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function getDailySummary(actor: Actor, dateRaw?: string) {
  requirePermission(actor, "dashboard.view");
  const date: ISODate = dateRaw && isISODate(dateRaw) ? dateRaw : todayISO();
  const day = (d: ISODate) => ({ from: d, to: d });
  const yesterday = addDays(date, -1);
  const lastWeek = addDays(date, -7);
  const sameDays = [7, 14, 21, 28].map((n) => addDays(date, -n));
  const detail = can(actor, "analytics.view");

  const [cur, prevDay, prevWeek, typicalRows, modes, trend, statuses, lab, labLastWeek, items] = await Promise.all([
    periodSummary(day(date)),
    periodSummary(day(yesterday)),
    periodSummary(day(lastWeek)),
    Promise.all(sameDays.map((d) => incomeByStream(day(d)))),
    incomeByReconGroup(day(date)),
    incomeSeries({ from: addDays(date, -13), to: date }, "day"),
    getDayStatuses(prisma, [date]),
    detail ? labAnalytics(day(date), "day") : Promise.resolve(null),
    detail ? labAnalytics(day(lastWeek), "day") : Promise.resolve(null),
    detail ? pharmacyItemAnalytics(day(date)) : Promise.resolve(null),
  ]);

  // "Typical" = average of the last four same weekdays that had any income (closed days don't drag it down).
  const typicalTotals = typicalRows.map((r) => totalIncome(r)).filter((v) => v > 0);
  const typical = typicalTotals.length ? round2(typicalTotals.reduce((a, b) => a + b, 0) / typicalTotals.length) : null;

  const income = totalIncome(cur.income);
  const weekday = WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const lastWeekLabel = `last ${weekday}`;
  const kpis: KpiCompare[] = [
    { key: "income", label: "AED income", current: income, previous: totalIncome(prevWeek.income), unit: "money" },
    { key: "patients", label: "Patients", current: cur.counts.patients, previous: prevWeek.counts.patients, unit: "int" },
    { key: "consultations", label: "Consultations", current: cur.counts.consultations, previous: prevWeek.counts.consultations, unit: "int" },
    { key: "new", label: "New patients", current: cur.counts.newConsultations, previous: prevWeek.counts.newConsultations, unit: "int" },
    { key: "labTests", label: "Lab tests", current: cur.counts.labTests, previous: prevWeek.counts.labTests, unit: "int" },
  ];
  const streams: Comparison = {
    id: "daily-streams",
    title: "Income by stream",
    noun: "stream",
    unit: "money",
    rows: AED_INCOME_STREAMS.map((s) => ({ key: s, name: STREAM_LABELS[s], current: cur.income[s], previous: prevWeek.income[s] })),
  };
  const extra: Insight[] = [];
  if (typical !== null && typical > 0 && income > 0) {
    const pct = Math.round(((income - typical) / typical) * 100);
    if (Math.abs(pct) >= 10)
      extra.push({
        id: "vs-typical",
        tone: pct > 0 ? ("positive" as const) : ("negative" as const),
        headline: `Income ${pct > 0 ? "above" : "below"} a typical ${weekday} by ${Math.abs(pct)}%`,
        detail: `Average of the last ${typicalTotals.length} ${weekday}s with activity.`,
        weight: 90 + Math.abs(pct),
      });
  }
  const other = modes.OTHER ?? 0;
  if (income > 0 && other / income > 0.3)
    extra.push({
      id: "modes-other",
      tone: "neutral" as const,
      headline: `${Math.round((other / income) * 100)}% of collections have no payment mode`,
      detail: "Rows imported from OneGlance reports without a payment-mode column are recorded as Other.",
      weight: 40,
    });
  const insights = rankInsights([...extra, ...insightsFromKpis(kpis, lastWeekLabel), ...insightsFromComparison(streams, lastWeekLabel)], 6);

  const labPrev = new Map((labLastWeek?.investigations ?? []).map((x) => [x.id, x.tests]));
  return {
    date,
    weekday,
    status: statuses.get(date) ?? "OPEN",
    generatedAt: new Date().toISOString(),
    compare: { yesterday, lastWeek, lastWeekLabel, typicalOver: typicalTotals.length },
    today: {
      income,
      byStream: cur.income,
      expenses: cur.kpis.totalExpenses, // AED only
      pharmacySales: cur.income.PHARMACY,
      pharmacyCosts: cur.expense.PHARMACY_PURCHASE,
      net: cur.kpis.netOperatingResult,
      counts: cur.counts,
      pharmacyBills: items?.hasData ? items.totals.bills : null,
      pharmacyMargin: items?.hasData ? items.totals.margin : null,
    },
    yesterday: { income: totalIncome(prevDay.income), counts: prevDay.counts },
    lastWeek: { income: totalIncome(prevWeek.income), byStream: prevWeek.income, counts: prevWeek.counts },
    typical,
    modes,
    trend: trend.map((t) => ({ bucket: t.bucket, income: t.income, expenses: t.expenses })),
    topTests: lab ? [...lab.investigations].sort((a, b) => b.tests - a.tests).slice(0, 8).map((x) => ({ name: x.name, tests: x.tests, lastWeek: labPrev.get(x.id) ?? 0, revenue: x.revenue })) : null,
    topMedicines: items?.hasData ? [...items.medicines].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((x) => ({ name: x.name, units: x.units, revenue: x.revenue })) : null,
    insights,
  };
}
