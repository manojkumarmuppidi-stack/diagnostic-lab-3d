import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz";
import { createTransaction, listTransactions } from "@/server/services/transactions";
import { decideExpense, expensePivot, monthlyChecklist } from "@/server/services/expenses";
import { notificationsFor } from "@/server/services/notifications";
import { linkExpensesToHeads } from "@/server/expense-heads";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
async function actor(username: string, roleCode: string): Promise<Actor> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode }, include: { permissions: { include: { permission: true } } } });
  const u = await prisma.user.create({ data: { username, name: username, passwordHash: bcrypt.hashSync("x", 4), roleId: role.id } });
  return { id: u.id, username, name: username, roleCode, roleName: role.name, permissions: new Set(role.permissions.map((p) => p.permission.code)), mustChangePassword: false };
}
beforeEach(async () => {
  f = await seedFixture();
});

describe("team roles: reception books expenses, the accounts head approves", () => {
  it("reception sees only their own expenses; the accounts head sees all and gets notified", async () => {
    const rec = await actor("t_rec_exp", "RECEPTION_EXPENSES");
    const head = await actor("t_acc_head", "ACCOUNTS_HEAD");
    const D = "2026-09-10";
    await createTransaction(f.admin, "expense", { date: D, categoryId: f.ids.otherExp, description: "Staff salaries – Sep", amount: 500000, paymentModeId: f.ids.BANK });
    const mine = await createTransaction(rec, "expense", { date: D, categoryId: f.ids.groceries, subcategoryId: f.ids.veg, description: "Vegetables", amount: 400, paymentModeId: f.ids.CASH });

    const list = await listTransactions(rec, "expense", { from: "2026-09-01", to: "2026-09-30", status: "ALL" });
    expect(list.rows.map((r: { description: string }) => r.description)).toEqual(["Vegetables"]);
    await expect(expensePivot(rec, {})).rejects.toThrow();
    await expect(monthlyChecklist(rec)).rejects.toThrow();
    expect((await listTransactions(head, "expense", { from: "2026-09-01", to: "2026-09-30", status: "ALL" })).total).toBe(2);

    const n = await notificationsFor(head);
    expect(n.items.find((i) => i.id.startsWith("approvals:"))?.title).toBe("1 expense waiting for your approval");

    await decideExpense(head, (mine as { id: string }).id, { decision: "REJECT", reason: "No bill attached" });
    const r = await notificationsFor(rec);
    expect(r.items[0]).toMatchObject({ tone: "bad", detail: "No bill attached" });
    expect(rec.permissions.has("users.manage")).toBe(false);
    expect(f.admin.permissions.has("users.manage")).toBe(true);
  });

  it("imported expenses are linked to their routine head", async () => {
    const h = await prisma.expenseHead.create({ data: { name: "Vegetables", keywords: "vegetables,veg", categoryId: f.ids.groceries, subcategoryId: f.ids.veg, monthly: false } });
    await createTransaction(f.admin, "expense", { date: "2026-09-02", categoryId: f.ids.groceries, subcategoryId: f.ids.veg, description: "Veg market", amount: 300, paymentModeId: f.ids.CASH });
    expect(await linkExpensesToHeads(prisma)).toBe(1);
    expect((await prisma.expense.findFirstOrThrow({ where: { description: "Veg market" } })).headId).toBe(h.id);
    expect(await linkExpensesToHeads(prisma)).toBe(0);
  });
});
