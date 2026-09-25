import { api } from "@/server/api";
import { queryAudit } from "@/server/services/misc";

export const GET = api(async ({ actor, url }) => queryAudit(actor, Object.fromEntries(url.searchParams)));
