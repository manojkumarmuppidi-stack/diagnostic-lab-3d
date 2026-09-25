import { api } from "@/server/api";
import { getBoardPack } from "@/server/services/insights";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, url }) => {
  const pack = await getBoardPack(actor, Object.fromEntries(url.searchParams));
  await audit(prisma, actor, { action: "BOARD_PACK_VIEW", entityType: "Report", entityId: "board-pack", after: { from: pack.period.current.from, to: pack.period.current.to } });
  return pack;
});
