import { beforeEach, describe, expect, it } from "vitest";
import { createTransaction } from "@/server/services/transactions";
import { hormonalPharmacy } from "@/server/services/hormonal-pharmacy";
import { AppError } from "@/server/errors";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

describe("Hormonal Pharmacy accounts", () => {
  it("profit = net sales − purchases per month, profit % of net sales, and a running month-to-date by day", async () => {
    const sale = (date: string, gross: number, discount = 0) => createTransaction(f.admin, "pharmacy-sale", { date, invoiceNo: `S-${date}-${gross}`, grossAmount: gross, discount, paymentModeId: f.ids.CASH });
    await sale("2026-07-10", 50000);
    await createTransaction(f.admin, "pharmacy-purchase", { date: "2026-07-12", supplier: "Demo Dist", invoiceNo: "P-7", amount: 40000, paymentModeId: f.ids.BANK });
    await sale("2026-08-03", 30000, 1000);
    await sale("2026-08-20", 71000);
    await createTransaction(f.admin, "pharmacy-return", { date: "2026-08-21", invoiceNo: "S-R", amount: 1000, paymentModeId: f.ids.CASH });
    await createTransaction(f.admin, "pharmacy-purchase", { date: "2026-08-05", supplier: "Demo Dist", invoiceNo: "P-8", amount: 74000, paymentModeId: f.ids.BANK });

    const r = await hormonalPharmacy(f.admin, "2026-08");
    expect(r.partial).toBe(false);
    expect(r.current).toMatchObject({ key: "2026-08", netSales: 99000, purchases: 74000, profit: 25000 });
    expect(r.current.profitPct).toBeCloseTo(25.25, 2);
    expect(r.previous).toMatchObject({ key: "2026-07", netSales: 50000, purchases: 40000, profit: 10000, profitPct: 20 });
    expect(r.months).toHaveLength(12);
    expect(r.yearTotal).toMatchObject({ netSales: 149000, purchases: 114000, profit: 35000 });
    expect(r.days).toHaveLength(31);
    const d5 = r.days.find((d) => d.key === "2026-08-05")!;
    expect(d5).toMatchObject({ purchases: 74000, cumNetSales: 29000, cumProfit: -45000 });
    expect(r.days.at(-1)).toMatchObject({ cumNetSales: 99000, cumProfit: 25000 });
    expect(r.current.soldMargin).toBeNull();

    // Reception uploads pharmacy reports, so it may see the pharmacy; a role without pharmacy access may not.
    await expect(hormonalPharmacy(f.reception, "2026-08")).resolves.toBeTruthy();
    await expect(hormonalPharmacy({ ...f.reception, permissions: new Set(["dashboard.view", "opd.view"]) }, "2026-08")).rejects.toBeInstanceOf(AppError);
  });
});
