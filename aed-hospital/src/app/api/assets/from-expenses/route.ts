import { api, readJson } from "@/server/api";
import { assetFromExpenses, capitalExpenses } from "@/server/services/assets";

/** GET: capital purchases entered as expenses. POST: turn the ticked ones into one fixed asset. */
export const GET = api(async ({ actor }) => capitalExpenses(actor));
export const POST = api(async ({ actor, req }) => assetFromExpenses(actor, await readJson(req)));
