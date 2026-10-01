import { beforeEach, describe, expect, it } from "vitest";
import { createTransaction } from "@/server/services/transactions";
import { getDailyStatement } from "@/server/services/daily";
import { dayLines } from "@/server/services/day-lines";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

describe("entries behind a Daily Accounts figure", () => {
  it("lists the bills and expenses that make up each figure, spread shares included", async () => {
    const D = "2026-09-28";
    await createTransaction(f.admin, "lab", { date: D, patientCode: "P1", patientName: "DEMO A", investigationId: f.ids.ecg, quantity: 2, paymentModeId: f.ids.UPI });
    await createTransaction(f.admin, "expense", { date: "2026-09-30", categoryId: f.ids.otherExp, description: "Rent – Sep", amount: 30000, paymentModeId: f.ids.BANK, spreadMonth: "Yes" });
    await createTransaction(f.admin, "expense", { date: D, categoryId: f.ids.otherExp, description: "Accounts fee", amount: 100000, paymentModeId: f.ids.BANK });

    const st = await getDailyStatement(f.admin, D);
    const lab = await dayLines(f.admin, D, "LAB");
    expect(lab.total).toBe(st.income.LAB);
    expect(lab.lines[0]).toMatchObject({ module: "lab", title: "ECG × 2", detail: "DEMO A", mode: "UPI" });

    const exp = await dayLines(f.admin, D, "EXP_OTHER");
    expect(exp.total).toBe(st.expense.OTHER);
    expect(exp.lines.map((l) => [l.title, l.amount, l.spread ?? false])).toEqual([
      ["Accounts fee", 100000, false],
      ["Rent – Sep", 1000, true],
    ]);
    expect(exp.lines[1].monthTotal).toBe(30000);
    // Each entry carries its module so Daily Accounts can open it for correction.
    expect(exp.lines.every((l) => l.module === "expense")).toBe(true);
    await expect(dayLines(f.admin, D, "NOPE")).rejects.toThrow();
  });
});
