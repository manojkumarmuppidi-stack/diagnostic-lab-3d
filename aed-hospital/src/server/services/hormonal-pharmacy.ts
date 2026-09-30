/**
 * Hormonal Pharmacy as its own segment: its accounts are read apart from the hospital's.
 *
 * AED measures the pharmacy month by month as Sale − Purchase:
 *   Net sales  = sales after discount − returns (pharmacy income)
 *   Purchases  = supplier invoices dated in the period (pharmacy stock expense)
 *   Profit     = Net sales − Purchases;  Profit % = Profit ÷ Net sales
 * Where medicine lines are imported, the margin on the medicines actually sold (taxable value −
 * cost, ex-GST) is shown beside it: it is not distorted by months when stock is built up or run down.
 */
import { Prisma } from "@prisma/client";
import { pctOf, pharmacyMetrics } from "@/lib/accounting";
import { addMonths, eachDay, endOfMonth, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { round2, toNum } from "@/lib/money";
import { requirePermission, type Actor } from "../authz";
import { prisma } from "../db";

const D = toDbDate;

interface Raw {
  k: string;
  gross: Prisma.Decimal;
  discount: Prisma.Decimal;
  returns: Prisma.Decimal;
  purchases: Prisma.Decimal;
  bills: bigint;
}

/** Sales, returns and purchases grouped by month ('YYYY-MM') or by day ('YYYY-MM-DD'). */
async function figures(from: ISODate, to: ISODate, by: "month" | "day") {
  const key = by === "month" ? Prisma.sql`to_char(date, 'YYYY-MM')` : Prisma.sql`to_char(date, 'YYYY-MM-DD')`;
  return prisma.$queryRaw<Raw[]>`
    SELECT k, SUM(gross) AS gross, SUM(discount) AS discount, SUM(returns) AS returns, SUM(purchases) AS purchases, SUM(bills) AS bills FROM (
      SELECT ${key} AS k, "grossAmount" AS gross, discount, 0 AS returns, 0 AS purchases, 1 AS bills FROM "PharmacySale" WHERE status = 'ACTIVE' AND date BETWEEN ${D(from)} AND ${D(to)}
      UNION ALL SELECT ${key}, 0, 0, amount, 0, 0 FROM "PharmacyReturn" WHERE status = 'ACTIVE' AND date BETWEEN ${D(from)} AND ${D(to)}
      UNION ALL SELECT ${key}, 0, 0, 0, amount, 0 FROM "PharmacyPurchase" WHERE status = 'ACTIVE' AND date BETWEEN ${D(from)} AND ${D(to)}
    ) x GROUP BY k`;
}

/** Margin on medicines sold (from imported medicine lines), by month or day. */
async function soldMargin(from: ISODate, to: ISODate, by: "month" | "day") {
  const key = by === "month" ? Prisma.sql`to_char(date, 'YYYY-MM')` : Prisma.sql`to_char(date, 'YYYY-MM-DD')`;
  const rows = await prisma.$queryRaw<{ k: string; taxable: Prisma.Decimal; cost: Prisma.Decimal; bills: bigint }[]>`
    SELECT ${key} AS k, COALESCE(SUM(taxable), 0) AS taxable, COALESCE(SUM(cost), 0) AS cost, COUNT(DISTINCT split_part("docNo", '/', 1)) AS bills
      FROM "PharmacyItemLine" WHERE kind = 'SALE' AND status = 'ACTIVE' AND date BETWEEN ${D(from)} AND ${D(to)} GROUP BY 1`;
  return new Map(rows.map((r) => [r.k, { taxable: toNum(r.taxable), cost: toNum(r.cost), bills: Number(r.bills) }]));
}

function line(k: string, raw: Raw | undefined, sold: { taxable: number; cost: number; bills: number } | undefined) {
  const m = pharmacyMetrics({ grossSales: toNum(raw?.gross), discount: toNum(raw?.discount), returns: toNum(raw?.returns), purchases: toNum(raw?.purchases) });
  const margin = sold && sold.taxable > 0 ? round2(sold.taxable - sold.cost) : null;
  return {
    key: k,
    sales: m.totalSales,
    returns: m.returns,
    netSales: m.netSales,
    purchases: m.purchases,
    profit: m.grossMargin,
    profitPct: m.grossMarginPct,
    soldMargin: margin,
    soldMarginPct: margin === null ? null : pctOf(margin, sold!.taxable),
    /** Taxable (ex-GST) value of the medicines sold: the base of the margin %. */
    soldValue: margin === null ? null : sold!.taxable,
    bills: sold?.bills ?? null,
  };
}
export type PharmacyLine = ReturnType<typeof line>;

function total(k: string, rows: PharmacyLine[]): PharmacyLine {
  const s = (f: keyof PharmacyLine) => round2(rows.reduce((a, r) => a + (Number(r[f]) || 0), 0));
  const netSales = s("netSales");
  const profit = s("profit");
  const withMargin = rows.filter((r) => r.soldMargin !== null);
  const margin = withMargin.length ? round2(withMargin.reduce((a, r) => a + r.soldMargin!, 0)) : null;
  const soldValue = withMargin.length ? round2(withMargin.reduce((a, r) => a + r.soldValue!, 0)) : null;
  return {
    key: k,
    sales: s("sales"),
    returns: s("returns"),
    netSales,
    purchases: s("purchases"),
    profit,
    profitPct: pctOf(profit, netSales),
    soldMargin: margin,
    soldMarginPct: margin === null || soldValue === null ? null : pctOf(margin, soldValue),
    soldValue,
    bills: rows.some((r) => r.bills !== null) ? rows.reduce((a, r) => a + (r.bills ?? 0), 0) : null,
  };
}

export async function hormonalPharmacy(actor: Actor, monthRaw?: string) {
  requirePermission(actor, "pharmacy.view");
  const today = todayISO();
  const month = monthRaw && /^\d{4}-\d{2}$/.test(monthRaw) && monthRaw <= today.slice(0, 7) ? monthRaw : today.slice(0, 7);
  const mFrom = `${month}-01` as ISODate;
  const mEnd = endOfMonth(mFrom);
  const mTo = mEnd < today ? mEnd : today;
  const yFrom = addMonths(mFrom, -11);

  const [byMonth, soldByMonth, byDay, soldByDay] = await Promise.all([figures(yFrom, mEnd, "month"), soldMargin(yFrom, mEnd, "month"), figures(mFrom, mTo, "day"), soldMargin(mFrom, mTo, "day")]);

  const monthRows: PharmacyLine[] = [];
  const mMap = new Map(byMonth.map((r) => [r.k, r]));
  for (let m = yFrom; m <= mFrom; m = addMonths(m, 1)) monthRows.push(line(m.slice(0, 7), mMap.get(m.slice(0, 7)), soldByMonth.get(m.slice(0, 7))));

  const dMap = new Map(byDay.map((r) => [r.k, r]));
  let cumSales = 0;
  let cumPurchases = 0;
  const days = eachDay(mFrom, mTo).map((d) => {
    const l = line(d, dMap.get(d), soldByDay.get(d));
    cumSales = round2(cumSales + l.netSales);
    cumPurchases = round2(cumPurchases + l.purchases);
    return { ...l, cumNetSales: cumSales, cumPurchases, cumProfit: round2(cumSales - cumPurchases), cumProfitPct: pctOf(round2(cumSales - cumPurchases), cumSales) };
  });

  const current = monthRows[monthRows.length - 1];
  const previous = monthRows[monthRows.length - 2];
  // Same days of the previous month, for a fair month-to-date comparison.
  const partial = mTo < mEnd;
  let previousSameDays: PharmacyLine | null = null;
  if (partial) {
    const pFrom = addMonths(mFrom, -1);
    const dayN = Number(mTo.slice(8));
    const pEnd = endOfMonth(pFrom);
    const pTo = (`${pFrom.slice(0, 8)}${String(Math.min(dayN, Number(pEnd.slice(8)))).padStart(2, "0")}`) as ISODate;
    const [f, s] = await Promise.all([figures(pFrom, pTo, "month"), soldMargin(pFrom, pTo, "month")]);
    previousSameDays = line(pFrom.slice(0, 7), f[0], s.get(pFrom.slice(0, 7)));
  }

  const notes: string[] = [];
  const stockSwing = current.netSales > 0 && Math.abs(current.purchases - current.netSales) / current.netSales > 0.25;
  if (stockSwing)
    notes.push(
      current.purchases > current.netSales
        ? "Purchases this month are well above sales — stock is being built up, so Sale − Purchase understates this month's profit."
        : "Purchases this month are well below sales — existing stock is being sold down, so Sale − Purchase overstates this month's profit.",
    );
  if (current.soldMargin === null && current.netSales > 0) notes.push("Upload the OneGlance Purchase/Sales Report (sales view) to see the margin on medicines actually sold.");

  return {
    month,
    range: { from: mFrom, to: mTo },
    partial,
    current,
    previous,
    previousSameDays,
    months: monthRows,
    yearTotal: total("12 months", monthRows),
    days,
    notes,
    generatedAt: new Date().toISOString(),
    lastDataDate: byDay.length ? byDay.map((r) => r.k).sort().at(-1)! : null,
  };
}
