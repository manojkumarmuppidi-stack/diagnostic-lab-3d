import { api } from "@/server/api";
import { dataFreshness } from "@/server/services/freshness";

// Any signed-in user may see whether the figures are up to date.
export const GET = api(async ({ url }) => dataFreshness(url.searchParams.get("to")));
