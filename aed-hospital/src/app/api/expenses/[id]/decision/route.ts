import { api } from "@/server/api";
import { decideExpense } from "@/server/services/expenses";

export const POST = api<{ id: string }>(async ({ actor, params, req }) => decideExpense(actor, params.id, await req.json()));
