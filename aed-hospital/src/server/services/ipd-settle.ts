/**
 * IPD admissions with money still due, and marking several of them fully paid in one go: each gets a
 * FINAL_SETTLEMENT for exactly its balance, recorded the normal way (closed days refused, audited), so
 * IPD income — and every report built on it — counts the money in the month it was received.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { fromDbDate, isISODate, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { viewPerm, writePerm } from "@/lib/modules";
import { round2, toNum } from "@/lib/money";
import { requirePermission, type Actor } from "../authz";
import { prisma } from "../db";
import { badRequest } from "../errors";
import { insertRecord } from "./transactions";

export async function ipdBalances(actor: Actor, q: { from?: string | null; to?: string | null }) {
  requirePermission(actor, viewPerm("ipd"));
  const from = isISODate(q.from ?? "") ? (q.from as ISODate) : null;
  const to = isISODate(q.to ?? "") ? (q.to as ISODate) : todayISO();
  const rows = await prisma.$queryRaw<
    { id: string; patient_name: string | null; admission_date: Date; discharge_date: Date | null; type: string; billed: Prisma.Decimal; collected: Prisma.Decimal }[]
  >`
    SELECT a.id, a."patientName" AS patient_name, a."admissionDate" AS admission_date, a."dischargeDate" AS discharge_date, at.name AS type,
           a."netAmount" AS billed,
           COALESCE(SUM(CASE WHEN t.type = 'REFUND' THEN -t.amount ELSE t.amount END) FILTER (WHERE t.status = 'ACTIVE'), 0) AS collected
      FROM "IpdAdmission" a
      JOIN "AdmissionType" at ON at.id = a."admissionTypeId"
      LEFT JOIN "IpdTransaction" t ON t."admissionId" = a.id
     WHERE a.status = 'ACTIVE' AND a."admissionDate" <= ${toDbDate(to)} ${from ? Prisma.sql`AND a."admissionDate" >= ${toDbDate(from)}` : Prisma.empty}
     GROUP BY a.id, at.name
    HAVING a."netAmount" - COALESCE(SUM(CASE WHEN t.type = 'REFUND' THEN -t.amount ELSE t.amount END) FILTER (WHERE t.status = 'ACTIVE'), 0) > 0
     ORDER BY a."admissionDate", a."patientName"`;
  const list = rows.map((r) => ({
    id: r.id,
    patientName: r.patient_name,
    admissionDate: fromDbDate(r.admission_date),
    dischargeDate: r.discharge_date ? fromDbDate(r.discharge_date) : null,
    admissionType: r.type,
    billed: toNum(r.billed),
    collected: toNum(r.collected),
    balance: round2(toNum(r.billed) - toNum(r.collected)),
  }));
  return { list, total: round2(list.reduce((a, x) => a + x.balance, 0)) };
}

const settleInput = z.object({
  admissionIds: z.array(z.string().min(1)).min(1, "Tick at least one admission").max(500),
  paymentModeId: z.string().min(1, "Choose how it was paid"),
  /** "fixed": every payment on `date`; "discharge": on each patient's discharge date (admission date if not discharged). */
  dateMode: z.enum(["fixed", "discharge"]),
  date: z.string().nullable().optional(),
  reference: z.string().trim().max(80).nullable().optional(),
});

export async function settleAdmissions(actor: Actor, raw: unknown) {
  requirePermission(actor, writePerm("ipd-payment"));
  const parsed = settleInput.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the details");
  const s = parsed.data;
  if (s.dateMode === "fixed" && !isISODate(s.date ?? "")) throw badRequest("Choose the date the money was received");
  const ids = [...new Set(s.admissionIds)];
  return prisma.$transaction(
    async (tx) => {
      const adms = await tx.ipdAdmission.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, include: { transactions: { where: { status: "ACTIVE" } } } });
      if (adms.length !== ids.length) throw badRequest("Some admissions were changed or removed meanwhile — refresh and try again");
      let count = 0;
      let amount = 0;
      for (const a of adms) {
        const collected = a.transactions.reduce((t, x) => t + (x.type === "REFUND" ? -toNum(x.amount) : toNum(x.amount)), 0);
        const balance = round2(toNum(a.netAmount) - collected);
        if (balance <= 0) continue;
        const date = s.dateMode === "fixed" ? (s.date as ISODate) : fromDbDate(a.dischargeDate ?? a.admissionDate);
        if (date < fromDbDate(a.admissionDate))
          throw badRequest(`${a.patientName ?? "An admission"}: the payment date is before the admission date (${fromDbDate(a.admissionDate)})`);
        if (date > todayISO()) throw badRequest(`${a.patientName ?? "An admission"}: the payment date is in the future`);
        await insertRecord(
          tx,
          actor,
          "ipd-payment",
          {
            admissionId: a.id,
            date,
            type: "FINAL_SETTLEMENT",
            amount: balance,
            paymentModeId: s.paymentModeId,
            reference: s.reference || null,
            remarks: "Marked fully paid (balance settled from the Outstanding list)",
          },
          { allowDuplicate: true },
        );
        count++;
        amount = round2(amount + balance);
      }
      return { settled: count, amount };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
