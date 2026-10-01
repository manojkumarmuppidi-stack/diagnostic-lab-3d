import { api } from "@/server/api";
import { requirePermission } from "@/server/authz";
import { badRequest } from "@/server/errors";
import { isISODate, startOfMonth, todayISO } from "@/lib/dates";
import { defaultGranularity } from "@/lib/periods";
import { isModuleKey, viewPerm } from "@/lib/modules";
import { expenseAnalytics, incomeByStream, ipdAnalytics, labAnalytics, opdAnalytics, pharmacyAnalytics } from "@/server/services/analytics";

/** Compact per-module summary shown above each transaction list (needs only the module's view permission). */
export const GET = api<{ module: string }>(async ({ actor, params, url }) => {
  if (!isModuleKey(params.module)) throw badRequest("Unknown module");
  requirePermission(actor, params.module === "expense" ? "expense.view_all" : viewPerm(params.module));
  const today = todayISO();
  const from = isISODate(url.searchParams.get("from")) ? url.searchParams.get("from")! : startOfMonth(today);
  const to = isISODate(url.searchParams.get("to")) ? url.searchParams.get("to")! : today;
  const r = { from, to };
  const g = defaultGranularity(from, to);
  switch (params.module) {
    case "opd":
      return { kind: "opd", ...(await opdAnalytics(r, g)) };
    case "lab":
      return { kind: "lab", ...(await labAnalytics(r, g)) };
    case "ipd":
    case "ipd-payment":
      return { kind: "ipd", ...(await ipdAnalytics(r, g)) };
    case "pharmacy-sale":
    case "pharmacy-purchase":
    case "pharmacy-return":
      return { kind: "pharmacy", ...(await pharmacyAnalytics(r, g)) };
    case "expense":
      return { kind: "expense", ...(await expenseAnalytics(r, g)) };
    default:
      return { kind: "income", income: await incomeByStream(r) };
  }
});
