import { api, readJson } from "@/server/api";
import { changeDayStatus } from "@/server/services/daily";

export const POST = api<{ date: string }>(async ({ actor, params, req }) => changeDayStatus(actor, params.date, await readJson(req)));
