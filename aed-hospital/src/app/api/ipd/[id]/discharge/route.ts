import { api, readJson } from "@/server/api";
import { dischargeAdmission } from "@/server/services/transactions";

export const POST = api<{ id: string }>(async ({ actor, params, req }) => {
  const b = await readJson(req);
  return dischargeAdmission(actor, params.id, String(b.dischargeDate ?? ""));
});
