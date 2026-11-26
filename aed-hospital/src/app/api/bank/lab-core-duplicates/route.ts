import { api, readJson } from "@/server/api";
import { labCoreDuplicates } from "@/server/services/bank";

/** GET: lab bills entered twice inside the core accounts. POST: remove them. */
export const GET = api(async ({ actor }) => labCoreDuplicates(actor));
export const POST = api(async ({ actor, req }) => {
  const b = await readJson(req);
  return labCoreDuplicates(actor, { apply: true, includeProbable: b.includeProbable === true, intoClosedDays: b.intoClosedDays === true });
});
