import { api, readJson } from "@/server/api";
import { restoreProbableLab } from "@/server/services/bank";

export const POST = api(async ({ actor, req }) => {
  const b = await readJson(req);
  return restoreProbableLab(actor, { from: typeof b.from === "string" ? b.from : null, intoClosedDays: b.intoClosedDays === true });
});
