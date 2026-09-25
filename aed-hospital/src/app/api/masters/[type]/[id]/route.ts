import { api, readJson } from "@/server/api";
import { badRequest } from "@/server/errors";
import { isMasterType, updateMaster } from "@/server/services/masters";

export const PATCH = api<{ type: string; id: string }>(async ({ actor, params, req }) => {
  if (!isMasterType(params.type)) throw badRequest("Unknown master type");
  return updateMaster(actor, params.type, params.id, await readJson(req));
});
