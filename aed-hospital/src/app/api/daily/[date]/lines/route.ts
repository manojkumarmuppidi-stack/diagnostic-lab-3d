import { api } from "@/server/api";
import { dayLines } from "@/server/services/day-lines";

export const GET = api<{ date: string }>(async ({ actor, params, req }) => dayLines(actor, params.date, new URL(req.url).searchParams.get("key") ?? ""));
