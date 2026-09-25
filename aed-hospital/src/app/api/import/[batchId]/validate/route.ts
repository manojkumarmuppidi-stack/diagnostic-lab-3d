import { api, readJson } from "@/server/api";
import { validateBatch } from "@/server/services/import";

export const POST = api<{ batchId: string }>(async ({ actor, params, req }) => validateBatch(actor, params.batchId, await readJson(req)));
