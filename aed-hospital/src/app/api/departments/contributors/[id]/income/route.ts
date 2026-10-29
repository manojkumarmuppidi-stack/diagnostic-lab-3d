import { api, readJson } from "@/server/api";
import { setContributorIncome } from "@/server/services/departments";

export const PUT = api<{ id: string }>(async ({ actor, params, req }) => setContributorIncome(actor, params.id, await readJson(req)));
