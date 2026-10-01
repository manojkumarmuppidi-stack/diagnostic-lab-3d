/**
 * Links expenses that arrived without a routine head (imports, older entries) to the head they
 * belong to, so the monthly checklist, "last month" and month-wise-by-head see them.
 * Only unlinked expenses are touched; a head chosen by a person is never changed.
 */
import type { PrismaClient } from "@prisma/client";
import { matchHead } from "@/lib/expenses";

export async function linkExpensesToHeads(db: PrismaClient, where: { importBatchId?: string } = {}): Promise<number> {
  const heads = await db.expenseHead.findMany({ where: { active: true } });
  if (!heads.length) return 0;
  const rows = await db.expense.findMany({
    where: { headId: null, status: { in: ["ACTIVE", "PENDING"] }, ...where },
    select: { id: true, description: true, vendor: true, categoryId: true, subcategoryId: true, departmentId: true },
  });
  const byHead = new Map<string, string[]>();
  for (const r of rows) {
    const h = matchHead(heads, r);
    if (h) byHead.set(h.id, [...(byHead.get(h.id) ?? []), r.id]);
  }
  let n = 0;
  for (const [headId, ids] of byHead) n += (await db.expense.updateMany({ where: { id: { in: ids } }, data: { headId } })).count;
  return n;
}
