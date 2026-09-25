import { api, readJson } from "@/server/api";
import { badRequest } from "@/server/errors";
import { isModuleKey } from "@/lib/modules";
import { createTransaction, listTransactions } from "@/server/services/transactions";

export const GET = api<{ module: string }>(async ({ actor, params, url }) => {
  if (!isModuleKey(params.module)) throw badRequest("Unknown module");
  return listTransactions(actor, params.module, Object.fromEntries(url.searchParams));
});

export const POST = api<{ module: string }>(async ({ actor, params, req }) => {
  if (!isModuleKey(params.module)) throw badRequest("Unknown module");
  return createTransaction(actor, params.module, await readJson(req));
});
