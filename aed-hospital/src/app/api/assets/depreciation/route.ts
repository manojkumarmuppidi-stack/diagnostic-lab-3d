import { api, readJson } from "@/server/api";
import { postDepreciation } from "@/server/services/assets";

/** Post a finished financial year's depreciation as expenses. */
export const POST = api(async ({ actor, req }) => {
  const b = await readJson(req);
  return postDepreciation(actor, { fy: typeof b.fy === "string" ? b.fy : undefined, intoClosedDays: b.intoClosedDays === true });
});
