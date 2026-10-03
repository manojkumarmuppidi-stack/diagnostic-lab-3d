import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import { createMaster } from "@/server/services/masters";
import { incomeByStream, operationalCounts, opdAnalytics, scpByBilledName } from "@/server/services/analytics";
import { totalIncome } from "@/lib/accounting";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

describe("SCP — Sugar Control Plans and short admissions", () => {
  it("is AED income of its own, under its billed name, and not a consultation", async () => {
    const scp = (await createMaster(f.admin, "consultationTypes", { name: "Sugar Control Plan", defaultRate: 0 })) as { id: string; scp: boolean };
    const fu = (await createMaster(f.admin, "consultationTypes", { name: "F/u by bhagya", defaultRate: 0 })) as { id: string; scp: boolean };
    expect([scp.scp, fu.scp]).toEqual([true, true]);
    const opd = { date: "2026-09-10", specialtyId: f.ids.diabetes, visitType: "OLD", discount: 0, paymentModeId: f.ids.CASH };
    await createTransaction(f.admin, "opd", { ...opd, patientCode: "P1", patientName: "DEMO A", consultationTypeId: f.ids.consult, grossAmount: 600 });
    await createTransaction(f.admin, "opd", { ...opd, patientCode: "P2", patientName: "DEMO B", consultationTypeId: scp.id, grossAmount: 3000 });
    await createTransaction(f.admin, "opd", { ...opd, date: "2026-10-02", patientCode: "P3", patientName: "DEMO C", consultationTypeId: fu.id, grossAmount: 1000 });

    const sep = await incomeByStream({ from: "2026-09-01", to: "2026-09-30" });
    expect([sep.OPD, sep.SCP, totalIncome(sep)]).toEqual([600, 3000, 3600]);
    const c = await operationalCounts({ from: "2026-09-01", to: "2026-09-30" });
    expect([c.consultations, c.patients]).toEqual([1, 2]);
    expect((await opdAnalytics({ from: "2026-09-01", to: "2026-09-30" }, "month")).totals).toMatchObject({ total: 1, revenue: 600 });

    const s = await scpByBilledName({ from: "2026-09-01", to: "2026-10-31" });
    expect(s).toMatchObject({ months: ["2026-09", "2026-10"], total: 4000, count: 2, totals: { "2026-09": 3000, "2026-10": 1000 } });
    expect(s.lines.map((l) => l.name)).toEqual(["Sugar Control Plan", "F/u by bhagya"]);

    // An ordinary consultation name is not SCP; the Admin can still flag one by hand.
    const other = (await createMaster(f.admin, "consultationTypes", { name: "Growth (short) Disorder", defaultRate: 0 })) as { scp: boolean };
    expect(other.scp).toBe(false);
    expect((await prisma.consultationType.findUniqueOrThrow({ where: { name: "Consultation" } })).scp).toBe(false);
  });
});
