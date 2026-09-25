import { api } from "@/server/api";
import { badRequest } from "@/server/errors";
import { isModuleKey } from "@/lib/modules";
import { getTransaction } from "@/server/services/transactions";
import { rowToInput } from "@/server/services/modules";

export const GET = api<{ module: string; id: string }>(async ({ actor, params }) => {
  if (!isModuleKey(params.module)) throw badRequest("Unknown module");
  const d = await getTransaction(actor, params.module, params.id);
  return { ...d, input: d.input ? rowToInput(params.module, d.input) : null };
});
