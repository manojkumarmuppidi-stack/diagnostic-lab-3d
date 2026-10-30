import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createTransaction, dischargeAdmission } from "@/server/services/transactions";
import { incomeByStream } from "@/server/services/analytics";
import { changeDayStatus } from "@/server/services/daily";
import { ipdBalances, settleAdmissions } from "@/server/services/ipd-settle";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

const admit = (date: string, name: string, net: number, paid = 0) =>
  createTransaction(f.accounts, "ipd", {
    admissionDate: date,
    patientCode: name,
    patientName: name,
    admissionTypeId: f.ids.otherAdm,
    grossAmount: net,
    discount: 0,
    ...(paid ? { initialPaymentType: "ADVANCE", initialPaymentAmount: paid, paymentModeId: f.ids.CASH } : {}),
  });

describe("IPD: mark admissions fully paid", () => {
  it("lists balances by admission date and settles the ticked ones in one go, as IPD income", async () => {
    const a = await admit("2026-10-03", "PATIENT A", 40000, 10000);
    const b = await admit("2026-10-10", "PATIENT B", 25000);
    const c = await admit("2026-09-20", "PATIENT C", 5000);
    await dischargeAdmission(f.accounts, b.id, "2026-10-14");

    const oct = await ipdBalances(f.accounts, { from: "2026-10-01", to: "2026-10-31" });
    expect(oct.list.map((x) => [x.patientName, x.balance, x.dischargeDate])).toEqual([
      ["PATIENT A", 30000, null],
      ["PATIENT B", 25000, "2026-10-14"],
    ]);
    expect(oct.total).toBe(55000);

    await expect(settleAdmissions(f.management, { admissionIds: [a.id], paymentModeId: f.ids.UPI, dateMode: "fixed", date: "2026-10-20" })).rejects.toThrow();
    await expect(settleAdmissions(f.accounts, { admissionIds: [a.id], paymentModeId: f.ids.UPI, dateMode: "fixed", date: "2026-10-01" })).rejects.toThrow(
      /before the admission date/,
    );

    // B on its discharge date; A (not discharged) on its admission date.
    const r = await settleAdmissions(f.accounts, { admissionIds: [a.id, b.id], paymentModeId: f.ids.UPI, dateMode: "discharge" });
    expect(r).toEqual({ settled: 2, amount: 55000 });
    const pays = await prisma.ipdTransaction.findMany({ where: { type: "FINAL_SETTLEMENT" }, orderBy: { date: "asc" } });
    expect(pays.map((p) => [p.admissionId, p.date.toISOString().slice(0, 10), Number(p.amount)])).toEqual([
      [a.id, "2026-10-03", 30000],
      [b.id, "2026-10-14", 25000],
    ]);
    expect((await incomeByStream({ from: "2026-10-01", to: "2026-10-31" })).IPD).toBe(65000);
    expect((await ipdBalances(f.accounts, { from: "2026-10-01", to: "2026-10-31" })).list).toEqual([]);
    // Already settled: nothing more is recorded.
    expect(await settleAdmissions(f.accounts, { admissionIds: [a.id], paymentModeId: f.ids.UPI, dateMode: "fixed", date: "2026-10-20" })).toEqual({ settled: 0, amount: 0 });
    expect(await prisma.auditLog.count({ where: { entityType: "IpdTransaction", action: "CREATE" } })).toBeGreaterThanOrEqual(2);

    // A closed day refuses the whole batch.
    await changeDayStatus(f.admin, "2026-09-25", { action: "review" });
    await prisma.dailyAccount.update({ where: { date: new Date("2026-09-25T00:00:00Z") }, data: { status: "CLOSED" } });
    await expect(settleAdmissions(f.accounts, { admissionIds: [c.id], paymentModeId: f.ids.CASH, dateMode: "fixed", date: "2026-09-25" })).rejects.toThrow();
    expect(await prisma.ipdTransaction.count({ where: { admissionId: c.id } })).toBe(0);
  });
});
