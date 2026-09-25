import { api } from "@/server/api";
import { badRequest } from "@/server/errors";
import { SECTION_KEYS, getSectionInsights, type SectionKey } from "@/server/services/insights";

export const GET = api<{ section: string }>(async ({ actor, params, url }) => {
  if (!SECTION_KEYS.includes(params.section as SectionKey)) throw badRequest("Unknown section");
  return getSectionInsights(actor, params.section as SectionKey, Object.fromEntries(url.searchParams));
});
