import { api, readJson } from "@/server/api";
import { getSpacePool, saveSpacePool } from "@/server/services/departments";

export const GET = api(async ({ actor, req }) => getSpacePool(actor, { year: new URL(req.url).searchParams.get("year") }));
export const PUT = api(async ({ actor, req }) => saveSpacePool(actor, await readJson(req)));
