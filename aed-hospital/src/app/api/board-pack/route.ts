import { api } from "@/server/api";
import { getBoardPack } from "@/server/services/insights";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";

/** Vercel function time limit (60 s is allowed on every Vercel plan). */
export const maxDuration = 60;

export const GET = api(async ({ actor, url }) => {
  const pack = await getBoardPack(actor, Object.fromEntries(url.searchParams));
  await audit(prisma, actor, { action: "BOARD_PACK_VIEW", entityType: "Report", entityId: "board-pack", after: { from: pack.period.current.from, to: pack.period.current.to } });
  return pack;
});
