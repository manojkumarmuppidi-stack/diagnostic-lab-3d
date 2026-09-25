import { api } from "@/server/api";
import { addDays, isISODate, todayISO } from "@/lib/dates";
import { listDays } from "@/server/services/daily";

export const GET = api(async ({ actor, url }) => {
  const to = isISODate(url.searchParams.get("to")) ? url.searchParams.get("to")! : todayISO();
  const from = isISODate(url.searchParams.get("from")) ? url.searchParams.get("from")! : addDays(to, -30);
  return listDays(actor, from, to);
});
