import { beforeEach, describe, expect, it } from "vitest";
import { createTransaction } from "@/server/services/transactions";
import { dataFreshness } from "@/server/services/freshness";
import { addDays, todayISO } from "@/lib/dates";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

describe("are the accounts up to date?", () => {
  it("flags streams whose last entry is too old, and core streams never entered", async () => {
    const today = todayISO();
    await createTransaction(f.admin, "opd", { date: addDays(today, -1), patientCode: "P1", patientName: "DEMO A", specialtyId: f.ids.diabetes, visitType: "NEW", grossAmount: 600, discount: 0, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "expense", { date: addDays(today, -10), categoryId: f.ids.otherExp, description: "Misc", amount: 100, paymentModeId: f.ids.CASH });
    const r = await dataFreshness();
    const by = Object.fromEntries(r.streams.map((s) => [s.key, s]));
    expect(by.opd).toMatchObject({ lastDate: addDays(today, -1), daysBehind: 1, behind: false });
    expect(by.expense).toMatchObject({ lastDate: addDays(today, -10), daysBehind: 10, behind: true });
    expect(by.lab).toMatchObject({ lastDate: null, behind: true }); // core stream with nothing entered
    expect(by.diet).toMatchObject({ lastDate: null, behind: false }); // optional stream, never used
    // Looking at a past period that ends before the gap: expenses are fine for that period.
    const past = await dataFreshness(addDays(today, -10));
    expect(past.streams.find((s) => s.key === "expense")).toMatchObject({ daysBehind: 0, behind: false });
    expect(past.refIsToday).toBe(false);
  });
});
