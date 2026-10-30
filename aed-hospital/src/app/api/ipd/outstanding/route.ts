import { api } from "@/server/api";
import { ipdBalances } from "@/server/services/ipd-settle";

export const GET = api(async ({ actor, url }) => ipdBalances(actor, { from: url.searchParams.get("from"), to: url.searchParams.get("to") }));
