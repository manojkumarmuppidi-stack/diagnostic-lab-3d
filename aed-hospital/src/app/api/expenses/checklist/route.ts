import { api } from "@/server/api";
import { monthlyChecklist } from "@/server/services/expenses";

export const GET = api(async ({ actor, url }) => monthlyChecklist(actor, url.searchParams.get("month") ?? undefined));
