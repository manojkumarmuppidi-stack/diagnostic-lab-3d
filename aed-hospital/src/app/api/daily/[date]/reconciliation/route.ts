import { api, readJson } from "@/server/api";
import { getDailyStatement, saveReconciliation } from "@/server/services/daily";

export const GET = api<{ date: string }>(async ({ actor, params }) => (await getDailyStatement(actor, params.date)).reconciliation);
export const PUT = api<{ date: string }>(async ({ actor, params, req }) => saveReconciliation(actor, params.date, await readJson(req)));
