import { api, readJson } from "@/server/api";
import { reverseBatch } from "@/server/services/import";

export const POST = api<{ batchId: string }>(async ({ actor, params, req }) => reverseBatch(actor, params.batchId, await readJson(req)));
