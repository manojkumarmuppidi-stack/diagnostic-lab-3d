import { api } from "@/server/api";
import { departmentAccounts } from "@/server/services/departments";

export const GET = api(async ({ actor, url }) => departmentAccounts(actor, { from: url.searchParams.get("from"), to: url.searchParams.get("to") }));
