import { api, readJson } from "@/server/api";
import { listAssets, saveAsset } from "@/server/services/assets";

export const GET = api(async ({ actor }) => listAssets(actor));
export const POST = api(async ({ actor, req }) => saveAsset(actor, null, await readJson(req)));
