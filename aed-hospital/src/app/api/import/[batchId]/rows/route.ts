import { api, readJson } from "@/server/api";
import { listRows, setDuplicateDecision } from "@/server/services/import";

export const GET = api<{ batchId: string }>(async ({ actor, params, url }) => listRows(actor, params.batchId, Object.fromEntries(url.searchParams)));
export const PATCH = api<{ batchId: string }>(async ({ actor, params, req }) => setDuplicateDecision(actor, params.batchId, await readJson(req)));
