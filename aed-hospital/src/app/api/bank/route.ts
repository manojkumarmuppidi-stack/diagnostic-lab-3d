import { api } from "@/server/api";
import { bankReport } from "@/server/services/bank";

export const GET = api(async ({ actor, url }) => bankReport(actor, { from: url.searchParams.get("from"), to: url.searchParams.get("to") }));
