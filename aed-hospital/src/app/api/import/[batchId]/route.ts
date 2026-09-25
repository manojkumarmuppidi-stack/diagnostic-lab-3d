import { api } from "@/server/api";
import { cancelBatch, getBatch } from "@/server/services/import";

export const GET = api<{ batchId: string }>(async ({ actor, params }) => getBatch(actor, params.batchId));
export const DELETE = api<{ batchId: string }>(async ({ actor, params }) => cancelBatch(actor, params.batchId));
