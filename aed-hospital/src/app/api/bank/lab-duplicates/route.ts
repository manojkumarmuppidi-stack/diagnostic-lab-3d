import { api, readJson } from "@/server/api";
import { labBankDuplicates } from "@/server/services/bank";

/** GET: check the lab entries from the bank for duplicates. POST: remove them. */
export const GET = api(async ({ actor }) => labBankDuplicates(actor));
export const POST = api(async ({ actor, req }) => {
  const b = await readJson(req);
  return labBankDuplicates(actor, { apply: true, includeProbable: b.includeProbable === true, intoClosedDays: b.intoClosedDays === true });
});
