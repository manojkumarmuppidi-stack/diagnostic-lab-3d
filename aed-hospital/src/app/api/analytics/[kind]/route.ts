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
  opdAnalytics,
  pharmacyAnalytics,
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
    case "lab":
      data = await labAnalytics(r, g, f);
      break;
    case "pharmacy":
      data = await pharmacyAnalytics(r, g);
      break;
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
