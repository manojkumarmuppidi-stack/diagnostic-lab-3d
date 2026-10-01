import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createTransaction, correctTransaction, listTransactions, reviewCorrection, voidTransaction } from "@/server/services/transactions";
import { changeDayStatus, getDailyStatement, saveReconciliation } from "@/server/services/daily";
import { expenseByKind, incomeByReconGroup, incomeByStream, operationalCounts, outstandingIpd, periodSummary, pharmacyAnalytics } from "@/server/services/analytics";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
const D = "2026-09-10";
const opd = (over: Record<string, unknown> = {}) => ({ date: D, patientCode: "P-1", patientName: "Test One", specialtyId: f.ids.diabetes, visitType: "NEW", grossAmount: 800, discount: 100, paymentModeId: f.ids.CASH, ...over });
const expectCode = async (p: Promise<unknown>, status: number, code?: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).status).toBe(status);
  if (code) expect((e as AppError).code).toBe(code);
  return e as AppError;
};

beforeEach(async () => {
  f = await seedFixture();
});

describe("income entry", () => {
  it("creates OPD with net = amount − discount and audits it", async () => {
    const r = await createTransaction(f.reception, "opd", opd());
    expect(r.amount).toBe(700);
    const row = await prisma.consultation.findUniqueOrThrow({ where: { id: r.id } });
    expect(Number(row.netAmount)).toBe(700);
    expect(await prisma.auditLog.count({ where: { entityId: r.id, action: "CREATE" } })).toBe(1);
    expect((await incomeByStream({ from: D, to: D })).OPD).toBe(700);
  });

  it("detects possible duplicates, and allows them when confirmed", async () => {
    await createTransaction(f.reception, "opd", opd());
    const e = await expectCode(createTransaction(f.reception, "opd", opd()), 409);
    expect((e.details as { code: string }).code).toBe("POSSIBLE_DUPLICATE");
    await createTransaction(f.reception, "opd", { ...opd(), confirmDuplicate: true });
    expect(await prisma.consultation.count()).toBe(2);
  });

  it("rejects discount greater than amount and negative amounts", async () => {
    await expect(createTransaction(f.reception, "opd", opd({ discount: 900 }))).rejects.toThrow();
    await expect(createTransaction(f.reception, "opd", opd({ grossAmount: -5 }))).rejects.toThrow();
  });

  it("lab uses the master rate × quantity when no rate is given", async () => {
    const r = await createTransaction(f.accounts, "lab", { date: D, investigationId: f.ids.ecg, quantity: 2, discount: 50, paymentModeId: f.ids.UPI });
    expect(r.amount).toBe(550);
    const c = await operationalCounts({ from: D, to: D });
    expect(c.labTests).toBe(2);
  });

  it("enforces permissions server-side", async () => {
    await expectCode(createTransaction(f.reception, "expense", { date: D, categoryId: f.ids.groceries, description: "x", amount: 10, paymentModeId: f.ids.CASH }), 403);
    await expectCode(createTransaction(f.management, "opd", opd()), 403);
    await expectCode(listTransactions(f.reception, "expense", {}), 403);
  });

  it("masks patient names for roles without identity permission", async () => {
    await createTransaction(f.reception, "opd", opd({ patientName: "Ramesh Kumar" }));
    const m = await listTransactions(f.management, "opd", {});
    expect(m.rows[0].patientName).toBe("R***h K***r");
    const a = await listTransactions(f.accounts, "opd", {});
    expect(a.rows[0].patientName).toBe("Ramesh Kumar");
  });
});

describe("corrections and voids", () => {
  it("correction supersedes the original (kept) and totals count only the new row", async () => {
    const r = await createTransaction(f.reception, "opd", opd());
    const c = await correctTransaction(f.reception, "opd", r.id, { ...opd({ discount: 0 }), reason: "Discount not applicable" });
    expect(c.status).toBe("APPLIED");
    const orig = await prisma.consultation.findUniqueOrThrow({ where: { id: r.id } });
    expect(orig.status).toBe("SUPERSEDED");
    expect(Number(orig.netAmount)).toBe(700); // original value untouched
    expect((await incomeByStream({ from: D, to: D })).OPD).toBe(800);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "CORRECT" } });
    expect(log.reason).toBe("Discount not applicable");
    expect((log.before as { netAmount: string }).netAmount).toBe("700");
    expect((log.after as { netAmount: string }).netAmount).toBe("800");
  });

  it("requires a reason", async () => {
    const r = await createTransaction(f.reception, "opd", opd());
    await expect(correctTransaction(f.reception, "opd", r.id, { ...opd(), reason: "" })).rejects.toThrow();
    await expect(voidTransaction(f.reception, "opd", r.id, { reason: "x" })).rejects.toThrow();
  });

  it("void removes the row from totals but keeps it", async () => {
    const r = await createTransaction(f.reception, "opd", opd());
    await voidTransaction(f.reception, "opd", r.id, { reason: "Entered twice" });
    expect((await incomeByStream({ from: D, to: D })).OPD).toBe(0);
    expect(await prisma.consultation.count()).toBe(1);
    await expectCode(voidTransaction(f.reception, "opd", r.id, { reason: "again please" }), 400);
  });

  it("the database refuses deletes and in-place amount edits", async () => {
    const r = await createTransaction(f.reception, "opd", opd());
    await expect(prisma.consultation.delete({ where: { id: r.id } })).rejects.toThrow(/not permitted/);
    await expect(prisma.consultation.update({ where: { id: r.id }, data: { netAmount: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/not permitted/);
  });
});

describe("daily closing", () => {
  async function closeDay(date: string) {
    await changeDayStatus(f.accounts, date, { action: "review" });
    const st = await getDailyStatement(f.accounts, date);
    await saveReconciliation(f.accounts, date, { lines: st.reconciliation.map((l) => ({ group: l.group, actual: l.expected })) });
    await changeDayStatus(f.accounts, date, { action: "close" });
  }

  it("OPEN → REVIEW → RECONCILED → CLOSED, and a closed day rejects new entries", async () => {
    await createTransaction(f.reception, "opd", opd());
    await expectCode(changeDayStatus(f.accounts, D, { action: "close" }), 400);
    await closeDay(D);
    await expectCode(createTransaction(f.reception, "opd", opd({ patientCode: "P-2" })), 423, "DAY_CLOSED");
    await expectCode(createTransaction(f.admin, "opd", opd({ patientCode: "P-2" })), 423, "DAY_CLOSED");
  });

  it("variance needs an explanation", async () => {
    await createTransaction(f.reception, "opd", opd());
    await changeDayStatus(f.accounts, D, { action: "review" });
    const lines = ["CASH", "CARD", "UPI", "BANK", "OTHER"].map((g) => ({ group: g, actual: g === "CASH" ? 650 : 0 }));
    await expectCode(saveReconciliation(f.accounts, D, { lines }), 400);
    const ok = await saveReconciliation(f.accounts, D, { lines: lines.map((l) => (l.group === "CASH" ? { ...l, explanation: "₹50 short, change given" } : l)) });
    expect(ok.status).toBe("RECONCILED");
    const rec = await prisma.reconciliation.findFirstOrThrow({ where: { reconGroup: "CASH" } });
    expect(Number(rec.variance)).toBe(-50);
  });

  it("a change after reconciliation sends the day back to REVIEW", async () => {
    await createTransaction(f.reception, "opd", opd());
    await changeDayStatus(f.accounts, D, { action: "review" });
    const st = await getDailyStatement(f.accounts, D);
    await saveReconciliation(f.accounts, D, { lines: st.reconciliation.map((l) => ({ group: l.group, actual: l.expected })) });
    await createTransaction(f.reception, "opd", opd({ patientCode: "P-9" }));
    expect((await getDailyStatement(f.accounts, D)).status).toBe("REVIEW");
  });

  it("corrections on closed days need approval; requester cannot self-approve; reopen needs a reason and is logged", async () => {
    const r = await createTransaction(f.reception, "opd", opd());
    await closeDay(D);
    const req = await correctTransaction(f.reception, "opd", r.id, { ...opd({ visitType: "OLD" }), reason: "Was a follow-up visit" });
    expect(req.status).toBe("PENDING_APPROVAL");
    const pending = await prisma.correctionRequest.findFirstOrThrow();
    // Accounts cannot approve a request they raised themselves.
    const own = await correctTransaction(f.accounts, "opd", r.id, { ...opd(), reason: "duplicate request" }).catch((e) => e);
    expect(own).toBeInstanceOf(AppError);
    await expectCode(reviewCorrection(f.reception, pending.id, "APPROVE"), 403);
    await reviewCorrection(f.accounts, pending.id, "APPROVE", "checked");
    const counts = await operationalCounts({ from: D, to: D });
    expect(counts.oldConsultations).toBe(1);
    expect(counts.newConsultations).toBe(0);
    await expectCode(changeDayStatus(f.accounts, D, { action: "reopen", reason: "fix" }), 403);
    await expectCode(changeDayStatus(f.admin, D, { action: "reopen" }), 400);
    await changeDayStatus(f.admin, D, { action: "reopen", reason: "Late bill found" });
    const day = await prisma.dailyAccount.findFirstOrThrow({ include: { events: true } });
    expect(day.status).toBe("OPEN");
    expect(day.reopenCount).toBe(1);
    expect(day.events.some((e) => e.action === "REOPEN" && e.reason === "Late bill found")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "DAY_REOPEN" } })).toBe(1);
  });
});

describe("IPD", () => {
  it("income = collections (advance + settlement − refund); outstanding = billed − collected", async () => {
    const adm = await createTransaction(f.accounts, "ipd", { admissionDate: D, patientCode: "IP-1", patientName: "In Patient", admissionTypeId: f.ids.scp, grossAmount: 45000, discount: 5000, initialPaymentType: "ADVANCE", initialPaymentAmount: 10000, paymentModeId: f.ids.CASH });
    expect((await incomeByStream({ from: D, to: D })).IPD).toBe(10000);
    expect((await outstandingIpd(D)).total).toBe(30000);
    await createTransaction(f.accounts, "ipd-payment", { admissionId: adm.id, date: "2026-09-15", type: "FINAL_SETTLEMENT", amount: 32000, paymentModeId: f.ids.CARD });
    await expectCode(createTransaction(f.accounts, "ipd-payment", { admissionId: adm.id, date: "2026-09-16", type: "REFUND", amount: 50000, paymentModeId: f.ids.CASH }), 400);
    await createTransaction(f.accounts, "ipd-payment", { admissionId: adm.id, date: "2026-09-16", type: "REFUND", amount: 2000, paymentModeId: f.ids.CASH });
    const inc = await incomeByStream({ from: "2026-09-01", to: "2026-09-30" });
    expect(inc.IPD).toBe(40000);
    expect((await outstandingIpd("2026-09-30")).total).toBe(0);
    const s = await periodSummary({ from: "2026-09-01", to: "2026-09-30" });
    expect(s.counts.admissions).toBe(1);
    expect(s.kpis.revenuePerAdmission).toBe(40000);
  });
});

describe("pharmacy & expenses", () => {
  it("keeps pharmacy sales, returns and purchases separate — no double counting", async () => {
    await createTransaction(f.accounts, "pharmacy-sale", { date: D, invoiceNo: "PH1", grossAmount: 10000, discount: 500, paymentModeId: f.ids.CASH });
    await createTransaction(f.accounts, "pharmacy-return", { date: D, invoiceNo: "PH1", amount: 300, paymentModeId: f.ids.CASH });
    await createTransaction(f.accounts, "pharmacy-purchase", { date: D, supplier: "Dist", invoiceNo: "S1", amount: 7000, paymentModeId: f.ids.BANK });
    await createTransaction(f.admin, "expense", { date: D, categoryId: f.ids.groceries, subcategoryId: f.ids.veg, description: "Veg", amount: 1200, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "expense", { date: D, categoryId: f.ids.otherExp, description: "Misc", amount: 100, paymentModeId: f.ids.CASH });
    const r = { from: D, to: D };
    expect((await incomeByStream(r)).PHARMACY).toBe(9200);
    expect(await expenseByKind(r)).toEqual({ HOSPITAL: 1200, PHARMACY_PURCHASE: 7000, OTHER: 100 });
    // AED Hospital totals leave the Hormonal Pharmacy out entirely (separate entity).
    const s = await periodSummary(r);
    expect(s.kpis.totalIncome).toBe(0);
    expect(s.kpis.totalExpenses).toBe(1300);
    expect(s.kpis.netOperatingResult).toBe(-1300);
    expect(await incomeByReconGroup(r)).toMatchObject({ CASH: 0 });
    // Expenses booked to department "Pharmacy" are pharmacy costs, not AED expenses.
    const dept = await prisma.department.create({ data: { name: "Pharmacy" } });
    await createTransaction(f.admin, "expense", { date: D, categoryId: f.ids.otherExp, departmentId: dept.id, description: "Pharmacist salary", amount: 500, paymentModeId: f.ids.CASH });
    expect(await expenseByKind(r)).toEqual({ HOSPITAL: 1200, PHARMACY_PURCHASE: 7500, OTHER: 100 });
    expect((await periodSummary(r)).kpis.totalExpenses).toBe(1300);
    const ph = await pharmacyAnalytics(r, "day");
    expect(ph.totals.netSales).toBe(9200);
    expect(ph.totals.grossMargin).toBe(2200);
  });

  it("rejects a subcategory from another category", async () => {
    await expect(createTransaction(f.accounts, "expense", { date: D, categoryId: f.ids.otherExp, subcategoryId: f.ids.veg, description: "x", amount: 1, paymentModeId: f.ids.CASH })).rejects.toThrow(/does not belong/);
  });
});

describe("insights & board pack", () => {
  it("compares sections period-on-period and respects permissions", async () => {
    const { getSectionInsights, getBoardPack } = await import("@/server/services/insights");
    await createTransaction(f.reception, "opd", opd({ date: "2026-08-05", grossAmount: 500, discount: 0 }));
    await createTransaction(f.reception, "opd", opd({ date: "2026-09-05", patientCode: "P-2", grossAmount: 1000, discount: 0 }));
    const r = await getSectionInsights(f.admin, "opd", { from: "2026-09-01", to: "2026-09-30" });
    expect(r.period.previous).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    const rev = r.section.kpis.find((k) => k.key === "revenue")!;
    expect([rev.current, rev.previous]).toEqual([1000, 500]);
    expect(r.section.insights.some((i) => /OPD revenue up 100\.0%/.test(i.headline))).toBe(true);
    await expect(getSectionInsights(f.reception, "expense", {})).rejects.toThrow(/permission/);
    const pack = await getBoardPack(f.management, { from: "2026-09-01", to: "2026-09-30" });
    expect(pack.sections.map((s) => s.key)).toContain("overview");
    expect(pack.trend).toHaveLength(6);
    await expect(getBoardPack(f.reception, {})).rejects.toThrow();
  });
});
