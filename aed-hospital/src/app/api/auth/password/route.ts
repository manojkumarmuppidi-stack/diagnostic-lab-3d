import { z } from "zod";
import { api, readJson } from "@/server/api";
import { changePassword } from "@/server/auth";

const body = z.object({ current: z.string().min(1), next: z.string().min(8) });

export const POST = api(async ({ req, actor }) => {
  const { current, next } = body.parse(await readJson(req));
  await changePassword(actor, current, next);
  return { ok: true };
}, { allowPasswordChange: true });
