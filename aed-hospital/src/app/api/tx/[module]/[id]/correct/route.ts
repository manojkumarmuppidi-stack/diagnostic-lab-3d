import { api, readJson } from "@/server/api";
import { badRequest } from "@/server/errors";
import { isModuleKey } from "@/lib/modules";
import { correctTransaction } from "@/server/services/transactions";

export const POST = api<{ module: string; id: string }>(async ({ actor, params, req }) => {
  if (!isModuleKey(params.module)) throw badRequest("Unknown module");
  return correctTransaction(actor, params.module, params.id, await readJson(req));
});
