import { api, readJson } from "@/server/api";
import { badRequest } from "@/server/errors";
import { createMaster, isMasterType, listMaster } from "@/server/services/masters";

export const GET = api<{ type: string }>(async ({ params }) => {
  if (!isMasterType(params.type)) throw badRequest("Unknown master type");
  return listMaster(params.type);
});

export const POST = api<{ type: string }>(async ({ actor, params, req }) => {
  if (!isMasterType(params.type)) throw badRequest("Unknown master type");
  return createMaster(actor, params.type, await readJson(req));
});
