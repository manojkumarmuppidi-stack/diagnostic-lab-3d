import { api, readJson } from "@/server/api";
import { removeAsset, saveAsset } from "@/server/services/assets";

export const PATCH = api<{ id: string }>(async ({ actor, params, req }) => saveAsset(actor, params.id, await readJson(req)));
export const DELETE = api<{ id: string }>(async ({ actor, params }) => removeAsset(actor, params.id));
