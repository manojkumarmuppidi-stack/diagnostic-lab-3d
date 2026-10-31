/**
 * Fixed assets (vehicles, equipment): recorded once at cost — never as an expense — and depreciated
 * per financial year (April–March). SLM spreads cost less the residual value evenly over the useful
 * life (Companies Act: motor cars 8 years, 5% residual); WDV takes a fixed % of the remaining book value
 * each year (Income Tax: motor cars 15%). The year of purchase counts from the purchase date. When a year
 * has ended, its depreciation is posted as an expense (head "Depreciation", dated 31 March) — once.
 */
import { z } from "zod";
import { fromDbDate, isISODate, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { round2, toNum } from "@/lib/money";
import { can, requirePermission, type Actor } from "../authz";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, forbidden, notFound } from "../errors";
import { withBulkCache } from "../bulk-cache";
import { applyVoid, insertRecord } from "./transactions";
import { refreshClosedDays } from "./daily";

/** Financial year starting in April of `y`: "2026-27". */
export const fyLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
const fyStartYear = (d: string) => (+d.slice(5, 7) >= 4 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const days = (a: string, b: string) => Math.round((+new Date(b) - +new Date(a)) / 86400000) + 1;

export interface AssetLike {
  purchaseDate: string;
  cost: number;
  method: string;
  usefulLifeYears: number;
  residualPct: number;
  ratePct: number;
}

/** Depreciation per financial year from the year of purchase up to the year containing `upto`. */
export function depreciationSchedule(a: AssetLike, upto: string) {
  const rows: { fy: string; from: string; to: string; opening: number; depreciation: number; closing: number }[] = [];
  const residual = round2((a.cost * a.residualPct) / 100);
  const annualSlm = a.usefulLifeYears > 0 ? (a.cost - residual) / a.usefulLifeYears : 0;
  let book = a.cost;
  for (let y = fyStartYear(a.purchaseDate); y <= fyStartYear(upto); y++) {
    const start = `${y}-04-01`;
    const end = `${y + 1}-03-31`;
    const from = a.purchaseDate > start ? a.purchaseDate : start;
    const share = days(from, end) / days(start, end);
    let dep = a.method === "WDV" ? book * (a.ratePct / 100) * share : annualSlm * share;
    if (a.method !== "WDV") dep = Math.min(dep, Math.max(0, book - residual));
    dep = round2(dep);
    rows.push({ fy: fyLabel(y), from, to: end, opening: round2(book), depreciation: dep, closing: round2(book - dep) });
    book = round2(book - dep);
  }
  return rows;
}

const toLike = (r: { purchaseDate: Date; cost: unknown; method: string; usefulLifeYears: number; residualPct: unknown; ratePct: unknown }): AssetLike => ({
  purchaseDate: fromDbDate(r.purchaseDate),
  cost: toNum(r.cost as never),
  method: r.method,
  usefulLifeYears: r.usefulLifeYears,
  residualPct: toNum(r.residualPct as never),
  ratePct: toNum(r.ratePct as never),
});

const depBill = (id: string, fy: string) => `DEP-${id.slice(-10)}-${fy}`;

export async function listAssets(actor: Actor) {
  requirePermission(actor, "accounts.view");
  const today = todayISO();
  const assets = await prisma.fixedAsset.findMany({ where: { active: true }, orderBy: { purchaseDate: "asc" } });
  const posted = new Set(
    (await prisma.expense.findMany({ where: { billNumber: { startsWith: "DEP-" }, status: { in: ["ACTIVE", "PENDING"] } }, select: { billNumber: true } })).map(
      (e) => e.billNumber,
    ),
  );
  const currentFy = fyLabel(fyStartYear(today));
  const list = assets.map((a) => {
    const sched = depreciationSchedule(toLike(a), today).map((r) => ({ ...r, ended: r.to < today, posted: posted.has(depBill(a.id, r.fy)) }));
    // Up to today: completed years in full, the current year in proportion to the days gone.
    const cur = sched.find((r) => r.fy === currentFy);
    const curToDate = cur ? round2((cur.depreciation * days(cur.from, today)) / days(cur.from, cur.to)) : 0;
    const toDate = round2(sched.filter((r) => r.fy !== currentFy).reduce((s, r) => s + r.depreciation, 0) + curToDate);
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      purchaseDate: fromDbDate(a.purchaseDate),
      cost: toNum(a.cost),
      method: a.method,
      usefulLifeYears: a.usefulLifeYears,
      residualPct: toNum(a.residualPct),
      ratePct: toNum(a.ratePct),
      bankLines: a.bankLineIds.length,
      notes: a.notes,
      schedule: sched,
      depreciationToDate: toDate,
      bookValueToday: round2(toNum(a.cost) - toDate),
    };
  });
  const years = [...new Set(list.flatMap((a) => a.schedule.map((s) => s.fy)))].sort();
  return {
    today,
    currentFy,
    assets: list,
    years: years.map((fy) => {
      const rows = list.flatMap((a) => a.schedule.filter((s) => s.fy === fy));
      return { fy, depreciation: round2(rows.reduce((s, r) => s + r.depreciation, 0)), ended: rows.every((r) => r.ended), posted: rows.every((r) => r.posted || !r.depreciation) };
    }),
  };
}

const assetInput = z.object({
  name: z.string().trim().min(1, "Name the asset").max(120),
  category: z.string().trim().min(1).max(60).default("Vehicles"),
  purchaseDate: z.string().optional().nullable(),
  cost: z.coerce.number().min(0).max(99_99_99_999).optional().nullable(),
  method: z.enum(["SLM", "WDV"]).default("SLM"),
  usefulLifeYears: z.coerce.number().int().min(1).max(60).default(8),
  residualPct: z.coerce.number().min(0).max(100).default(5),
  ratePct: z.coerce.number().min(0).max(100).default(15),
  bankLineIds: z.array(z.string()).max(50).default([]),
  notes: z.string().trim().max(300).optional().nullable(),
});

const canEdit = (actor: Actor) => {
  if (!can(actor, "masters.manage") && !can(actor, "accounts.reconcile")) throw forbidden("Only the Admin or Accounts can change fixed assets");
};

/** Add or change an asset. From bank payments: cost = their total and purchase date = the first one, unless given. */
export async function saveAsset(actor: Actor, id: string | null, raw: unknown) {
  canEdit(actor);
  const p = assetInput.safeParse(raw);
  if (!p.success) throw badRequest(p.error.issues[0]?.message ?? "Check the asset");
  const a = p.data;
  const lines = a.bankLineIds.length ? await prisma.bankLine.findMany({ where: { id: { in: a.bankLineIds } } }) : [];
  if (lines.length !== a.bankLineIds.length) throw badRequest("Some bank payments were not found — refresh and try again");
  const cost = a.cost ?? round2(lines.reduce((s, l) => s + toNum(l.debit), 0));
  const purchaseDate = a.purchaseDate || (lines.length ? lines.map((l) => fromDbDate(l.date)).sort()[0] : null);
  if (!(cost > 0)) throw badRequest("Enter the cost");
  if (!purchaseDate || !isISODate(purchaseDate)) throw badRequest("Enter the purchase date");
  const data = { ...a, cost, purchaseDate: toDbDate(purchaseDate as ISODate), notes: a.notes || null };
  return prisma.$transaction(async (tx) => {
    const before = id ? await tx.fixedAsset.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound("Asset not found");
    const saved = id ? await tx.fixedAsset.update({ where: { id }, data }) : await tx.fixedAsset.create({ data: { ...data, createdById: actor.id } });
    await audit(tx, actor, { action: id ? "ASSET_UPDATE" : "ASSET_CREATE", entityType: "FixedAsset", entityId: saved.id, before: before ?? undefined, after: saved });
    return { id: saved.id };
  });
}

export async function removeAsset(actor: Actor, id: string) {
  canEdit(actor);
  return prisma.$transaction(async (tx) => {
    const before = await tx.fixedAsset.findUnique({ where: { id } });
    if (!before) throw notFound("Asset not found");
    await tx.fixedAsset.update({ where: { id }, data: { active: false } });
    await audit(tx, actor, { action: "ASSET_REMOVE", entityType: "FixedAsset", entityId: id, before });
    return { ok: true };
  });
}

/** Posts a finished financial year's depreciation as expenses (one per asset, 31 March), skipping any already posted. */
export async function postDepreciation(actor: Actor, raw: { fy?: string; intoClosedDays?: boolean }) {
  requirePermission(actor, "expense.write");
  if (raw.intoClosedDays) requirePermission(actor, "accounts.reopen");
  const m = /^(\d{4})-\d{2}$/.exec(raw.fy ?? "");
  if (!m) throw badRequest("Choose the financial year");
  const y = +m[1];
  const end = `${y + 1}-03-31` as ISODate;
  if (end >= todayISO()) throw badRequest(`The year ${raw.fy} has not ended yet — its depreciation is posted after 31 March ${y + 1}`);
  const [cat, mode] = await Promise.all([
    prisma.expenseCategory.findFirst({ where: { name: { equals: "Depreciation", mode: "insensitive" }, parentId: null } }),
    prisma.paymentMode.findFirst({ where: { code: "BOOK" } }),
  ]);
  if (!cat || !mode) throw badRequest("The Depreciation head or the book-entry payment mode is missing");
  const assets = await prisma.fixedAsset.findMany({ where: { active: true } });
  let posted = 0;
  let amount = 0;
  await prisma.$transaction(
    (tx) =>
      withBulkCache(
        async () => {
          for (const a of assets) {
            const row = depreciationSchedule(toLike(a), end).find((r) => r.fy === raw.fy);
            if (!row?.depreciation) continue;
            const bill = depBill(a.id, raw.fy!);
            if (await tx.expense.findFirst({ where: { billNumber: bill, status: { in: ["ACTIVE", "PENDING"] } } })) continue;
            await insertRecord(
              tx,
              actor,
              "expense",
              {
                date: end,
                categoryId: cat.id,
                description: `Depreciation ${raw.fy} — ${a.name}`.slice(0, 300),
                billNumber: bill,
                amount: row.depreciation,
                paymentModeId: mode.id,
                remarks: `${a.method === "WDV" ? `${toNum(a.ratePct)}% WDV` : `Straight line, ${a.usefulLifeYears} years, ${toNum(a.residualPct)}% residual`}; book value ${row.opening} → ${row.closing}`,
              },
              { allowDuplicate: true },
            );
            posted++;
            amount = round2(amount + row.depreciation);
          }
        },
        { allowClosed: raw.intoClosedDays },
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );
  if (raw.intoClosedDays && posted) await refreshClosedDays(actor, [end], `Depreciation ${raw.fy} posted`);
  return { posted, amount };
}

/** Bank lines that paid for an asset: the bank check counts them as accounted for. */
export async function assetBankLineIds() {
  return new Set((await prisma.fixedAsset.findMany({ where: { active: true }, select: { bankLineIds: true } })).flatMap((a) => a.bankLineIds));
}

/** Capital purchases entered as expenses (head "Equipment (capital)"), which belong in the asset register. */
export async function capitalExpenses(actor: Actor) {
  requirePermission(actor, "accounts.view");
  const rows = await prisma.expense.findMany({
    where: { status: "ACTIVE", category: { name: { equals: "Equipment (capital)", mode: "insensitive" } } },
    select: { id: true, date: true, amount: true, description: true, vendor: true, billNumber: true, subcategory: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  return rows.map((e) => ({ id: e.id, date: fromDbDate(e.date), amount: toNum(e.amount), description: e.description, vendor: e.vendor, sub: e.subcategory?.name ?? null }));
}

/**
 * Turns capital purchases entered as expenses into one fixed asset: the asset is recorded at their total
 * (bought on the first date), linked to the bank payments they came from, and the expenses are voided —
 * buying an asset is not an expense; its yearly depreciation is.
 */
export async function assetFromExpenses(actor: Actor, raw: unknown) {
  canEdit(actor);
  const p = assetInput.extend({ expenseIds: z.array(z.string()).min(1, "Tick the expenses").max(50), intoClosedDays: z.boolean().optional() }).safeParse(raw);
  if (!p.success) throw badRequest(p.error.issues[0]?.message ?? "Check the asset");
  const { expenseIds, intoClosedDays, ...a } = p.data;
  if (intoClosedDays) requirePermission(actor, "accounts.reopen");
  const exps = await prisma.expense.findMany({ where: { id: { in: expenseIds }, status: "ACTIVE" } });
  if (exps.length !== new Set(expenseIds).size) throw badRequest("Some expenses were changed meanwhile — refresh and try again");
  // Bank lines the expenses were entered from (bill number BANK-<date>-<line id end>).
  const lineIds: string[] = [];
  for (const e of exps) {
    const m = /^BANK-(\d{4}-\d{2}-\d{2})-(\w+)$/.exec(e.billNumber ?? "");
    if (!m) continue;
    const l = await prisma.bankLine.findFirst({ where: { date: toDbDate(m[1] as ISODate), id: { endsWith: m[2] } } });
    if (l) lineIds.push(l.id);
  }
  const cost = round2(exps.reduce((s, e) => s + toNum(e.amount), 0));
  const purchaseDate = exps.map((e) => fromDbDate(e.date)).sort()[0] as ISODate;
  const touched = new Set<ISODate>();
  const id = await prisma.$transaction(
    (tx) =>
      withBulkCache(
        async () => {
          const saved = await tx.fixedAsset.create({
            data: { ...a, notes: a.notes || null, cost, purchaseDate: toDbDate(purchaseDate), bankLineIds: lineIds, createdById: actor.id },
          });
          for (const e of exps) {
            await applyVoid(tx, actor, "expense", e.id, `Recorded as the fixed asset "${a.name}" instead (an asset is depreciated yearly, not expensed)`);
            touched.add(fromDbDate(e.date));
          }
          await audit(tx, actor, { action: "ASSET_FROM_EXPENSES", entityType: "FixedAsset", entityId: saved.id, after: { ...saved, expenseIds } });
          return saved.id;
        },
        { allowClosed: intoClosedDays },
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );
  if (intoClosedDays && touched.size) await refreshClosedDays(actor, [...touched], `Capital purchase moved to fixed assets`);
  return { id, cost, voided: exps.length };
}
