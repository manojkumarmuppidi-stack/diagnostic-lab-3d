import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createTransaction } from "@/server/services/transactions";
import { changeDayStatus, getDailyStatement, saveReconciliation } from "@/server/services/daily";
import { expenseByKind } from "@/server/services/analytics";
import { createMaster } from "@/server/services/masters";
import { decideExpense, expensePivot, listPendingExpenses, monthlyChecklist, pendingExpenseCount } from "@/server/services/expenses";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

const D = "2026-09-10";
const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.status : -1;
  }
  return 200;
};
const veg = (amount: number, date = D) => ({ date, categoryId: f.ids.groceries, subcategoryId: f.ids.veg, description: "Vegetables", amount, paymentModeId: f.ids.CASH });

describe("expense approval", () => {
  it("staff entries wait for approval and count only once approved", async () => {
    const staff = await createTransaction(f.accounts, "expense", veg(1200));
    expect(staff.pending).toBe(true);
    const own = await createTransaction(f.admin, "expense", veg(300));
    expect(own.pending).toBe(false);
    expect((await expenseByKind({ from: D, to: D })).HOSPITAL).toBe(300);

    // Staff see their own waiting entries; only approvers can decide.
    expect((await listPendingExpenses(f.accounts)).rows).toHaveLength(1);
    expect(await pendingExpenseCount(f.admin)).toBe(1);
    expect(await status(decideExpense(f.accounts, staff.id, { decision: "APPROVE" }))).toBe(403);

    await decideExpense(f.admin, staff.id, { decision: "APPROVE" });
    expect((await expenseByKind({ from: D, to: D })).HOSPITAL).toBe(1500);
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: staff.id } });
    expect(row.status).toBe("ACTIVE");
    expect(row.approvedById).toBe(f.admin.id);
    expect(await prisma.auditLog.count({ where: { action: "EXPENSE_APPROVE", entityId: staff.id } })).toBe(1);
    // A decided entry cannot be decided again.
    expect(await status(decideExpense(f.admin, staff.id, { decision: "REJECT", reason: "changed mind" }))).toBe(400);
  });

  it("rejecting needs a reason and keeps the row as voided", async () => {
    const r = await createTransaction(f.accounts, "expense", veg(999));
    expect(await status(decideExpense(f.admin, r.id, { decision: "REJECT" }))).toBe(400);
    await decideExpense(f.admin, r.id, { decision: "REJECT", reason: "Duplicate bill" });
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe("VOIDED");
    expect(row.voidReason).toBe("Rejected: Duplicate bill");
    expect((await expenseByKind({ from: D, to: D })).HOSPITAL).toBe(0);
  });

  it("the database only lets a pending expense become active or voided", async () => {
    const r = await createTransaction(f.accounts, "expense", veg(500));
    await expect(prisma.expense.update({ where: { id: r.id }, data: { amount: 1 } })).rejects.toThrow(/immutable/);
    await decideExpense(f.admin, r.id, { decision: "APPROVE" });
    await expect(prisma.expense.update({ where: { id: r.id }, data: { status: "PENDING" } })).rejects.toThrow();
  });

  it("a day with waiting expenses cannot be closed", async () => {
    const r = await createTransaction(f.accounts, "expense", veg(700));
    await changeDayStatus(f.accounts, D, { action: "review" });
    const st = await getDailyStatement(f.accounts, D);
    await saveReconciliation(f.accounts, D, { lines: st.reconciliation.map((l) => ({ group: l.group, actual: l.expected })) });
    expect(await status(changeDayStatus(f.accounts, D, { action: "close" }))).toBe(400);
    await decideExpense(f.admin, r.id, { decision: "APPROVE" });
    // Approval changed the day's figures: it goes back to review and must be reconciled again.
    await changeDayStatus(f.accounts, D, { action: "review" }).catch(() => undefined);
    const st2 = await getDailyStatement(f.accounts, D);
    await saveReconciliation(f.accounts, D, { lines: st2.reconciliation.map((l) => ({ group: l.group, actual: l.expected })) });
    await changeDayStatus(f.accounts, D, { action: "close" });
    expect((await prisma.dailyAccount.findFirstOrThrow({})).status).toBe("CLOSED");
  });
});

describe("monthly heads", () => {
  it("checklist shows entered, waiting and missing heads; month-wise pivot counts approved only", async () => {
    const milk = await createMaster(f.admin, "expenseHeads", { name: "Milk", keywords: "milk,curd", categoryId: f.ids.groceries, subcategoryId: f.ids.veg, defaultMode: "cash", monthly: true });
    const rent = await createMaster(f.admin, "expenseHeads", { name: "Rent", keywords: "rent", categoryId: f.ids.otherExp, monthly: true });
    await createMaster(f.admin, "expenseHeads", { name: "Audit", categoryId: f.ids.otherExp, monthly: false });
    expect(await status(createMaster(f.admin, "expenseHeads", { name: "Bad", categoryId: f.ids.veg }))).toBe(400); // subcategory as category

    await createTransaction(f.admin, "expense", { ...veg(2000, "2026-08-05"), headId: milk.id });
    await createTransaction(f.admin, "expense", { ...veg(2100), headId: milk.id });
    await createTransaction(f.accounts, "expense", { date: D, categoryId: f.ids.otherExp, description: "Rent Sep", amount: 150000, paymentModeId: f.ids.BANK, headId: rent.id });

    const c = await monthlyChecklist(f.accounts, "2026-09");
    const by = Object.fromEntries(c.rows.map((r) => [r.name, r]));
    expect(by.Milk).toMatchObject({ state: "done", approved: 2100, lastMonth: 2000 });
    expect(by.Rent).toMatchObject({ state: "pending", approved: 0, pending: 150000 });
    expect(by.Audit.state).toBe("optional");
    expect(c.summary).toMatchObject({ heads: 2, done: 1, pending: 1, missing: 0 });
    expect((await monthlyChecklist(f.accounts, "2026-10")).summary).toMatchObject({ missing: 2, expectedMissing: 2100 });

    const p = await expensePivot(f.accounts, { from: "2026-08-01", to: "2026-09-30", by: "head" });
    expect(p.months).toEqual(["2026-08", "2026-09"]);
    expect(p.lines.find((l) => l.label === "Milk")!.byMonth).toEqual({ "2026-08": 2000, "2026-09": 2100 });
    expect(p.lines.some((l) => l.label === "Rent")).toBe(false); // still waiting approval
    expect(p.grandTotal).toBe(4100);
  });
});
