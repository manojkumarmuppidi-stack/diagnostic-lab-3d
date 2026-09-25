import { api, readJson } from "@/server/api";
import { commitBatch } from "@/server/services/import";

export const POST = api<{ batchId: string }>(async ({ actor, params, req }) => commitBatch(actor, params.batchId, await readJson(req)));
