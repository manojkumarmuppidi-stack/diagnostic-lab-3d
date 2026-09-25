import { api } from "@/server/api";
import { getDailyStatement } from "@/server/services/daily";

export const GET = api<{ date: string }>(async ({ actor, params }) => getDailyStatement(actor, params.date));
