import { api, readJson } from "@/server/api";
import { validateBatch } from "@/server/services/import";

/** Vercel function time limit (60 s is allowed on every Vercel plan). */
export const maxDuration = 60;

export const POST = api<{ batchId: string }>(async ({ actor, params, req }) => validateBatch(actor, params.batchId, await readJson(req)));
