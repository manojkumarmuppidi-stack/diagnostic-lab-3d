import { api } from "@/server/api";
import { requireAnyPermission } from "@/server/authz";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, url }) => {
  requireAnyPermission(actor, "corrections.approve", "accounts.view");
  const status = url.searchParams.get("status") || "PENDING";
  const rows = await prisma.correctionRequest.findMany({ where: status === "ALL" ? {} : { status: status as "PENDING" }, orderBy: { requestedAt: "desc" }, take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.reviewedById].filter(Boolean) as string[]))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({ ...r, requestedBy: users.find((u) => u.id === r.requestedById)?.name, reviewedBy: users.find((u) => u.id === r.reviewedById)?.name ?? null }));
});
