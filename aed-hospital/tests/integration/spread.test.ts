import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import { expenseByKind, expenseByReconGroup } from "@/server/services/analytics";
import { expensePivot } from "@/server/services/expenses";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

describe("monthly expenses spread over the month", () => {
  it("each day carries its share; month total and cash paid stay right", async () => {
    await createTransaction(f.admin, "expense", { date: "2026-09-30", categoryId: f.ids.otherExp, description: "Rent – Sep", amount: 30001, paymentModeId: f.ids.CASH, spreadMonth: "Yes" });
    await createTransaction(f.admin, "expense", { date: "2026-09-30", categoryId: f.ids.otherExp, description: "Tea", amount: 50, paymentModeId: f.ids.CASH });
    expect((await expenseByKind({ from: "2026-09-01", to: "2026-09-01" })).OTHER).toBe(1000.03);
    expect((await expenseByKind({ from: "2026-09-30", to: "2026-09-30" })).OTHER).toBe(round(30001 - 1000.03 * 29 + 50));
    expect((await expenseByKind({ from: "2026-09-01", to: "2026-09-30" })).OTHER).toBe(30051);
    // Cash actually paid on the 30th is only the tea: the rent's payment day is unknown.
    expect((await expenseByReconGroup({ from: "2026-09-30", to: "2026-09-30" })).CASH).toBe(50);
    // Month-wise view and the expense list keep one row on its date.
    expect((await expensePivot(f.admin, { from: "2026-09-01", to: "2026-09-30" })).grandTotal).toBe(30051);
    expect(await prisma.expense.count({ where: { spreadMonth: true } })).toBe(1);
  });
});
const round = (n: number) => Math.round(n * 100) / 100;

describe("dashboard explains spread expenses", () => {
  it("reports what was entered on the day next to the spread total", async () => {
    const { getDashboard } = await import("@/server/services/dashboard");
    await createTransaction(f.admin, "expense", { date: "2026-09-01", categoryId: f.ids.otherExp, description: "Staff salaries – Sep", amount: 30000, paymentModeId: f.ids.CASH, spreadMonth: "Yes" });
    await createTransaction(f.admin, "expense", { date: "2026-09-01", categoryId: f.ids.otherExp, description: "Tea", amount: 150, paymentModeId: f.ids.CASH });
    const d = await getDashboard(f.admin, { preset: "custom", from: "2026-09-01", to: "2026-09-01" });
    expect(d.current.kpis.totalExpenses).toBe(1150);
    expect(d.expenseBasis).toEqual({ entered: 30150, enteredCount: 2, spreadShare: 1000 });
  });
});
