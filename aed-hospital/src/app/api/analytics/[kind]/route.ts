import { api } from "@/server/api";
import { requirePermission } from "@/server/authz";
import { badRequest } from "@/server/errors";
import { todayISO } from "@/lib/dates";
import { defaultGranularity, resolvePeriod, type Granularity, type PeriodPreset } from "@/lib/periods";
import { getSettings } from "@/server/settings";
import {
  expenseAnalytics,
  ipdAnalytics,
  labAnalytics,
  labTestTrend,
  opdAnalytics,
  pharmacyAnalytics,
  pharmacyItemAnalytics,
  pharmacyMedicineTrend,
  supplierPayables,
  profitabilityAnalytics,
  revenueAnalytics,
} from "@/server/services/analytics";

export const GET = api<{ kind: string }>(async ({ actor, params, url }) => {
  requirePermission(actor, "analytics.view");
  const q = Object.fromEntries(url.searchParams);
  const settings = await getSettings();
  const period = resolvePeriod({ preset: (q.preset as PeriodPreset) || "this_month", today: todayISO(), from: q.from, to: q.to, fyStartMonth: settings.fiscalYearStartMonth });
  const r = period.current;
  const g = (["day", "week", "month"].includes(q.granularity) ? q.granularity : defaultGranularity(r.from, r.to)) as Granularity;
  const f = { doctorId: q.doctorId || undefined, specialtyId: q.specialtyId || undefined, departmentId: q.departmentId || undefined, stream: q.stream || undefined, categoryId: q.categoryId || undefined };
  let data: unknown;
  switch (params.kind) {
    case "revenue":
      data = await revenueAnalytics(r, g, f);
      break;
    case "opd":
      data = await opdAnalytics(r, g, f);
      break;
    case "ipd":
      data = await ipdAnalytics(r, g, f);
      break;
    case "lab": {
      // Per-test comparison with the previous period, plus an optional single-test trend ("ECGs per week").
      const [cur, prev, selected] = await Promise.all([
        labAnalytics(r, g, f),
        labAnalytics(period.previous, g, f),
        q.investigationId ? labTestTrend(r, g, q.investigationId, f) : Promise.resolve(null),
      ]);
      const prevById = new Map(prev.investigations.map((x) => [x.id, x]));
      const seen = new Set(cur.investigations.map((x) => x.id));
      data = {
        ...cur,
        previousTotals: prev.totals,
        investigations: [
          ...cur.investigations.map((x) => ({ ...x, prevTests: prevById.get(x.id)?.tests ?? 0, prevRevenue: prevById.get(x.id)?.revenue ?? 0 })),
          // Tests done last period but not this one still matter ("no ECGs this week?").
          ...prev.investigations.filter((x) => !seen.has(x.id)).map((x) => ({ ...x, tests: 0, revenue: 0, avg: null, prevTests: x.tests, prevRevenue: x.revenue })),
        ],
        selected,
      };
      break;
    }
    case "pharmacy": {
      const [base, items, prevItems, medicine, payables] = await Promise.all([
        pharmacyAnalytics(r, g),
        pharmacyItemAnalytics(r),
        pharmacyItemAnalytics(period.previous),
        q.medicine && q.medicine.trim().length >= 2 ? pharmacyMedicineTrend(r, g, q.medicine.slice(0, 60)) : Promise.resolve(null),
        supplierPayables(r),
      ]);
      const prevById = new Map(prevItems.medicines.map((m) => [m.id, m]));
      const seen = new Set(items.medicines.map((m) => m.id));
      data = {
        ...base,
        items: {
          ...items,
          previousTotals: prevItems.totals,
          medicines: [
            ...items.medicines.map((m) => ({ ...m, prevUnits: prevById.get(m.id)?.units ?? 0, prevRevenue: prevById.get(m.id)?.revenue ?? 0 })),
            ...prevItems.medicines.filter((m) => !seen.has(m.id)).map((m) => ({ ...m, units: 0, bills: 0, revenue: 0, margin: 0, marginPct: null, prevUnits: m.units, prevRevenue: m.revenue })),
          ],
        },
        medicine,
        payables,
      };
      break;
    }
    case "expense":
      data = await expenseAnalytics(r, g, f);
      break;
    case "profitability":
      data = await profitabilityAnalytics(r, g);
      break;
    default:
      throw badRequest("Unknown analytics kind");
  }
  return { period, granularity: g, data };
});
