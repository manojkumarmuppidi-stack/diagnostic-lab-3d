/**
 * The entries behind one figure on the Daily Accounts statement: every bill, payment or expense
 * that makes up "IPD", "Hospital expenses" etc. on that day. Amounts come from the same accounting
 * views the statement totals, so the lines always add up to the figure that was clicked.
 */
import { Prisma } from "@prisma/client";
import { isISODate, toDbDate, type ISODate } from "@/lib/dates";
import { round2, toNum } from "@/lib/money";
import { requirePermission, type Actor } from "../authz";
import { prisma } from "../db";
import { badRequest } from "../errors";

export const DAY_LINE_KEYS = ["OPD", "IPD", "LAB", "DIET", "OTHER", "PHARMACY", "EXP_HOSPITAL", "EXP_OTHER", "EXP_PHARMACY"] as const;
export type DayLineKey = (typeof DAY_LINE_KEYS)[number];

export interface DayLine {
  id: string;
  title: string;
  detail: string | null;
  mode: string | null;
  reference: string | null;
  amount: number;
  /** Monthly expense spread over the month: amount is this day's share of monthTotal. */
  spread?: boolean;
  monthTotal?: number;
}

const EXPENSE_KIND: Record<string, string> = { EXP_HOSPITAL: "HOSPITAL", EXP_OTHER: "OTHER", EXP_PHARMACY: "PHARMACY_PURCHASE" };
const IPD_TYPE: Record<string, string> = { ADVANCE: "Advance", PAYMENT: "Payment", FINAL_SETTLEMENT: "Final settlement", REFUND: "Refund" };
const name = (x: { name: string } | null | undefined) => x?.name ?? null;
const join = (...p: (string | null | undefined)[]) => p.filter(Boolean).join(" · ") || null;

export async function dayLines(actor: Actor, date: string, key: string): Promise<{ date: string; key: DayLineKey; lines: DayLine[]; total: number }> {
  requirePermission(actor, "accounts.view");
  if (!isISODate(date)) throw badRequest("Invalid date");
  if (!DAY_LINE_KEYS.includes(key as DayLineKey)) throw badRequest("Unknown figure");
  const d = toDbDate(date as ISODate);
  const k = key as DayLineKey;

  let lines: DayLine[];
  if (k in EXPENSE_KIND) {
    const rows = await prisma.$queryRaw<{ source_table: string; source_id: string; amount: Prisma.Decimal; spread: boolean }[]>`
      SELECT source_table, source_id, amount, spread FROM v_expense_line WHERE kind = ${EXPENSE_KIND[k]} AND date = ${d}`;
    const amt = new Map(rows.map((r) => [r.source_id, { amount: toNum(r.amount), spread: r.spread }]));
    const ids = (t: string) => rows.filter((r) => r.source_table === t).map((r) => r.source_id);
    const [exp, pur] = await Promise.all([
      prisma.expense.findMany({ where: { id: { in: ids("Expense") } }, include: { category: true, subcategory: true, department: true, paymentMode: true } }),
      prisma.pharmacyPurchase.findMany({ where: { id: { in: ids("PharmacyPurchase") } }, include: { paymentMode: true } }),
    ]);
    lines = [
      ...exp.map((e) => ({
        id: e.id,
        title: e.description,
        detail: join(e.category.name, name(e.subcategory), name(e.department), e.vendor),
        mode: name(e.paymentMode),
        reference: e.billNumber,
        amount: amt.get(e.id)!.amount,
        ...(amt.get(e.id)!.spread ? { spread: true, monthTotal: toNum(e.amount) } : {}),
      })),
      ...pur.map((p) => ({ id: p.id, title: p.supplier, detail: "Stock purchase", mode: name(p.paymentMode), reference: p.invoiceNo, amount: amt.get(p.id)!.amount })),
    ];
  } else {
    const rows = await prisma.$queryRaw<{ source_table: string; source_id: string; amount: Prisma.Decimal }[]>`
      SELECT source_table, source_id, amount FROM v_income_line WHERE stream = ${k} AND date = ${d}`;
    const amt = new Map(rows.map((r) => [r.source_id, toNum(r.amount)]));
    const ids = (t: string) => rows.filter((r) => r.source_table === t).map((r) => r.source_id);
    const pm = { paymentMode: true } as const;
    const [opd, ipd, lab, diet, other, sale, ret] = await Promise.all([
      prisma.consultation.findMany({ where: { id: { in: ids("Consultation") } }, include: { ...pm, doctor: true, consultationType: true } }),
      prisma.ipdTransaction.findMany({ where: { id: { in: ids("IpdTransaction") } }, include: { ...pm, admission: { include: { doctor: true, admissionType: true } } } }),
      prisma.labTransaction.findMany({ where: { id: { in: ids("LabTransaction") } }, include: { ...pm, investigation: true } }),
      prisma.dietTransaction.findMany({ where: { id: { in: ids("DietTransaction") } }, include: { ...pm, service: true, dietician: true } }),
      prisma.otherIncome.findMany({ where: { id: { in: ids("OtherIncome") } }, include: pm }),
      prisma.pharmacySale.findMany({ where: { id: { in: ids("PharmacySale") } }, include: pm }),
      prisma.pharmacyReturn.findMany({ where: { id: { in: ids("PharmacyReturn") } }, include: pm }),
    ]);
    const base = (x: { id: string; reference?: string | null; paymentMode: { name: string } | null }) => ({ id: x.id, mode: name(x.paymentMode), reference: x.reference ?? null, amount: amt.get(x.id)! });
    lines = [
      ...opd.map((c) => ({ ...base(c), title: c.patientName || "Patient", detail: join(name(c.doctor), name(c.consultationType), c.visitType === "NEW" ? "New visit" : "Follow-up") })),
      ...ipd.map((t) => ({ ...base(t), title: t.admission.patientName || "Patient", detail: join(IPD_TYPE[t.type], name(t.admission.admissionType), name(t.admission.doctor), t.remarks) })),
      ...lab.map((l) => ({ ...base(l), title: l.investigation.name + (l.quantity > 1 ? ` × ${l.quantity}` : ""), detail: l.patientName })),
      ...diet.map((x) => ({ ...base(x), title: x.patientName || "Patient", detail: join(name(x.service), name(x.dietician)) })),
      ...other.map((o) => ({ ...base(o), title: o.source, detail: o.description })),
      ...sale.map((s) => ({ ...base({ ...s, reference: s.invoiceNo }), title: s.patientName || "Sale", detail: s.remarks })),
      ...ret.map((r) => ({ ...base({ ...r, reference: r.invoiceNo }), title: "Return", detail: r.reason })),
    ];
  }
  lines.sort((a, b) => b.amount - a.amount);
  return { date, key: k, lines, total: round2(lines.reduce((a, l) => a + l.amount, 0)) };
}
