import { api } from "@/server/api";
import { expensePivot } from "@/server/services/expenses";

export const GET = api(async ({ actor, url }) => expensePivot(actor, Object.fromEntries(url.searchParams)));
