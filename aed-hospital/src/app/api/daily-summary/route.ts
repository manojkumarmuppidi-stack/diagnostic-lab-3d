import { api } from "@/server/api";
import { getDailySummary } from "@/server/services/daily-summary";

export const GET = api(async ({ actor, url }) => getDailySummary(actor, url.searchParams.get("date") ?? undefined));
