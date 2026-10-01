import { api } from "@/server/api";
import { entityAccounts } from "@/server/services/entities";

export const GET = api(async ({ actor, url }) => entityAccounts(actor, { from: url.searchParams.get("from"), to: url.searchParams.get("to") }));
