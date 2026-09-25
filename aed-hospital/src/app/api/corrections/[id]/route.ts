import { z } from "zod";
import { api, readJson } from "@/server/api";
import { reviewCorrection } from "@/server/services/transactions";

const body = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(500).optional() });

export const POST = api<{ id: string }>(async ({ actor, params, req }) => {
  const { decision, note } = body.parse(await readJson(req));
  return reviewCorrection(actor, params.id, decision, note);
});
