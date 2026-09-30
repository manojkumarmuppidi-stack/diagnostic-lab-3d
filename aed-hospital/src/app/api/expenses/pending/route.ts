import { api } from "@/server/api";
import { listPendingExpenses } from "@/server/services/expenses";

export const GET = api(async ({ actor }) => listPendingExpenses(actor));
