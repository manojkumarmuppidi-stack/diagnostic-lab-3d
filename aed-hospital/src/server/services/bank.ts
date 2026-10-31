/**
 * Bank statement check: the bank's lines are stored apart from the books and compared with the core
 * accounts — money in against the UPI / card collections recorded, money out against expenses and
 * pharmacy purchases (same amount, close dates). What does not match is listed for the Accounts team to
 * decide; nothing is booked from the bank.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createHash } from "node:crypto";
import { BANK_KIND_LABELS, parseSbiStatement, type BankKind } from "@/lib/import/bank";
import { addDays, fromDbDate, isISODate, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { round2, toNum } from "@/lib/money";
import { writePerm } from "@/lib/modules";
import { norm } from "@/lib/import/text";
import { requirePermission, type Actor } from "../authz";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest } from "../errors";
import { withBulkCache } from "../bulk-cache";
import { applyVoid, insertRecord } from "./transactions";
import { matchPatterns } from "./departments";
import { refreshClosedDays } from "./daily";

export async function importBankStatements(actor: Actor, files: { name: string; buf: Buffer }[]) {
  requirePermission(actor, "accounts.reconcile");
  if (!files.length) throw badRequest("Choose the statement files");
  const out: { file: string; account: string; from: string; to: string; lines: number; added: number }[] = [];
  const parsed = files.map((f) => {
    // An Excel workbook (zip) is not an SBI statement download — most likely the reviewed payments list.
    if (f.buf.subarray(0, 2).toString("latin1") === "PK")
      throw badRequest(
        `${f.name} is an Excel workbook, not an SBI statement. For the reviewed payments list use "Upload reviewed list"; here upload the statement files downloaded from SBI (.xls).`,
      );
    try {
      return { name: f.name, st: parseSbiStatement(f.buf.toString("latin1")) };
    } catch (e) {
      throw badRequest(`${f.name}: ${(e as Error).message}`);
    }
  });
  await prisma.$transaction(async (tx) => {
    for (const { name, st } of parsed) {
      const data = st.rows.map((r) => ({
        account: st.account,
        date: toDbDate(r.date as ISODate),
        description: r.description,
        reference: r.reference,
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
        kind: r.kind,
        party: r.party,
        // Account, date, amounts, running balance and narration: unique per line even when a failed payment
        // is reversed and retried (same amount and balance again), yet the same file uploaded twice is not.
        fingerprint: createHash("sha256").update(`${st.account}|${r.date}|${r.debit}|${r.credit}|${r.balance}|${r.description}`).digest("hex"),
        importedById: actor.id,
      }));
      const { count } = await tx.bankLine.createMany({ data, skipDuplicates: true });
      out.push({ file: name, account: `…${st.account}`, from: st.rows[0].date, to: st.rows[st.rows.length - 1].date, lines: data.length, added: count });
    }
    await audit(tx, actor, { action: "BANK_IMPORT", entityType: "BankLine", entityId: "bank", after: { files: out } });
  });
  return { files: out, lines: out.reduce((a, f) => a + f.lines, 0), added: out.reduce((a, f) => a + f.added, 0) };
}

type Money = Record<string, number>;
const add = (m: Money, k: string, v: number) => (m[k] = round2((m[k] ?? 0) + v));
const IN_COLLECTIONS: BankKind[] = ["SETTLEMENT", "UPI_IN"];
/** Payments that are not expenses to look for: moving AED's own money, or cash taken out to spend later. */
const NOT_MATCHED: BankKind[] = ["OWN_TRANSFER", "CASH"];

function period(q: { from?: string | null; to?: string | null }) {
  const today = todayISO();
  const from = (isISODate(q.from ?? "") ? q.from : `${today.slice(0, 4)}-01-01`) as ISODate;
  const to = (isISODate(q.to ?? "") ? q.to : today) as ISODate;
  if (to < from) throw badRequest("The end date is before the start date");
  return { from, to };
}

export async function bankReport(actor: Actor, q: { from?: string | null; to?: string | null }) {
  requirePermission(actor, "accounts.view");
  const { from, to } = period(q);
  const all = await prisma.bankLine.findMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) } }, orderBy: [{ date: "asc" }, { balance: "desc" }] });
  // A failed UPI payment comes back as "UPI/REV/<ref>": the pair cancels out and is left out of both sides.
  const cancelled = new Set<string>();
  for (const rev of all.filter((l) => l.kind === "REVERSAL")) {
    const ref = /UPI\/REV\/(\S+?)-/.exec(rev.description)?.[1];
    const paid = ref && all.find((l) => !cancelled.has(l.id) && toNum(l.debit) === toNum(rev.credit) && l.description.includes(`UPI/DR/${ref}/`) && l.date <= rev.date);
    if (paid) {
      cancelled.add(paid.id);
      cancelled.add(rev.id);
    }
  }
  const lines = all.filter((l) => !cancelled.has(l.id));
  const months = [...new Set(lines.map((l) => fromDbDate(l.date).slice(0, 7)))].sort();

  // Money in: what the app recorded as paid by UPI / card, by month — the hospital's and the pharmacy's.
  const coll = await prisma.$queryRaw<{ m: string; pharmacy: boolean; amount: Prisma.Decimal }[]>`
    SELECT to_char(v.date, 'YYYY-MM') AS m, (v.stream = 'PHARMACY') AS pharmacy, SUM(v.amount) AS amount
      FROM v_income_line v JOIN "PaymentMode" pm ON pm.id = v.payment_mode_id
     WHERE pm."reconGroup" IN ('UPI', 'CARD') AND v.date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
     GROUP BY 1, 2`;
  const aedColl: Money = {};
  const phColl: Money = {};
  for (const r of coll) add(r.pharmacy ? phColl : aedColl, r.m, toNum(r.amount));
  const bankIn: Money = {};
  const otherIn: Money = {};
  for (const l of lines.filter((x) => toNum(x.credit) > 0)) add(IN_COLLECTIONS.includes(l.kind as BankKind) ? bankIn : otherIn, fromDbDate(l.date).slice(0, 7), toNum(l.credit));

  // Money out: each payment is matched to one expense or pharmacy purchase of the same amount, dated up
  // to 45 days before it (a bill paid later) or 5 days after (entered late); the closest date wins.
  const lo = toDbDate(addDays(from, -45));
  const hi = toDbDate(addDays(to, 5));
  const [expenses, purchases] = await Promise.all([
    prisma.expense.findMany({
      where: { status: { in: ["ACTIVE", "PENDING"] }, date: { gte: lo, lte: hi } },
      select: { id: true, date: true, amount: true, description: true, vendor: true, category: { select: { name: true } } },
    }),
    prisma.pharmacyPurchase.findMany({ where: { status: "ACTIVE", date: { gte: lo, lte: hi } }, select: { id: true, date: true, amount: true, supplier: true } }),
  ]);
  const pool = new Map<string, { id: string; date: string; what: string; used: boolean }[]>();
  const key = (n: number) => Math.round(n * 100).toString();
  for (const e of expenses)
    pool.set(key(toNum(e.amount)), [
      ...(pool.get(key(toNum(e.amount))) ?? []),
      { id: e.id, date: fromDbDate(e.date), what: `Expense: ${e.category.name} — ${e.vendor || e.description}`, used: false },
    ]);
  for (const p of purchases)
    pool.set(key(toNum(p.amount)), [...(pool.get(key(toNum(p.amount))) ?? []), { id: p.id, date: fromDbDate(p.date), what: `Pharmacy purchase: ${p.supplier}`, used: false }]);
  const outBy = { total: {} as Money, matched: {} as Money, notExpense: {} as Money, unmatched: {} as Money };
  const unmatched: { id: string; date: string; kind: string; party: string | null; description: string; amount: number }[] = [];
  const matchedList: { date: string; party: string | null; amount: number; with: string; withDate: string }[] = [];
  for (const l of lines.filter((x) => toNum(x.debit) > 0)) {
    const d = fromDbDate(l.date);
    const m = d.slice(0, 7);
    const amt = toNum(l.debit);
    add(outBy.total, m, amt);
    if (NOT_MATCHED.includes(l.kind as BankKind)) {
      add(outBy.notExpense, m, amt);
      continue;
    }
    const cands = (pool.get(key(amt)) ?? []).filter((c) => !c.used && c.date >= addDays(d, -45) && c.date <= addDays(d, 5));
    cands.sort((a, b) => Math.abs(+new Date(a.date) - +new Date(d)) - Math.abs(+new Date(b.date) - +new Date(d)));
    if (cands[0]) {
      cands[0].used = true;
      add(outBy.matched, m, amt);
      matchedList.push({ date: d, party: l.party, amount: amt, with: cands[0].what, withDate: cands[0].date });
    } else {
      add(outBy.unmatched, m, amt);
      unmatched.push({ id: l.id, date: d, kind: l.kind, party: l.party, description: l.description, amount: amt });
    }
  }
  // Unmatched payments by payee: the likely gaps in the core accounts (or bills entered as one total).
  const byPayee = new Map<string, { party: string; kind: string; count: number; amount: number; months: Set<string> }>();
  for (const u of unmatched) {
    const k = `${u.kind}|${(u.party ?? "(no name)").toLowerCase()}`;
    const e = byPayee.get(k) ?? { party: u.party ?? "(no name)", kind: u.kind, count: 0, amount: 0, months: new Set<string>() };
    e.count++;
    e.amount = round2(e.amount + u.amount);
    e.months.add(u.date.slice(0, 7));
    byPayee.set(k, e);
  }
  const imported = await prisma.bankLine.aggregate({ _min: { date: true }, _max: { date: true }, _count: true });
  return {
    from,
    to,
    months,
    kinds: BANK_KIND_LABELS,
    imported: { lines: imported._count, from: imported._min.date ? fromDbDate(imported._min.date) : null, to: imported._max.date ? fromDbDate(imported._max.date) : null },
    moneyIn: months.map((m) => ({ month: m, bank: bankIn[m] ?? 0, aed: aedColl[m] ?? 0, pharmacy: phColl[m] ?? 0, otherIn: otherIn[m] ?? 0 })),
    moneyOut: months.map((m) => ({
      month: m,
      total: outBy.total[m] ?? 0,
      matched: outBy.matched[m] ?? 0,
      notExpense: outBy.notExpense[m] ?? 0,
      unmatched: outBy.unmatched[m] ?? 0,
    })),
    byKind: Object.entries(
      lines.reduce<Record<string, { count: number; amount: number }>>((a, l) => {
        const e = (a[l.kind] ??= { count: 0, amount: 0 });
        e.count++;
        e.amount = round2(e.amount + toNum(l.debit) + toNum(l.credit));
        return a;
      }, {}),
    ).map(([kind, v]) => ({ kind, label: BANK_KIND_LABELS[kind as BankKind] ?? kind, ...v })),
    unmatchedByPayee: [...byPayee.values()].map((e) => ({ ...e, months: [...e.months].sort() })).sort((a, b) => b.amount - a.amount),
    unmatched,
    matched: matchedList,
  };
}

/** The report as Excel: summary, unmatched payments by payee and line by line, and what matched. */
export async function bankReportWorkbook(actor: Actor, q: { from?: string | null; to?: string | null }) {
  const r = await bankReport(actor, q);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const money = "#,##,##0;[Red]-#,##,##0";
  const sheet = (name: string, headers: string[], rows: (string | number | null)[][], widths: number[], moneyCols: number[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers).font = { bold: true };
    for (const row of rows) ws.addRow(row);
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    for (const c of moneyCols) ws.getColumn(c).numFmt = money;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  sheet(
    "Money in",
    ["Month", "Bank: UPI/card settlements", "App: AED UPI/card", "App: Pharmacy UPI/card", "Difference (bank − app)", "Other money in"],
    r.moneyIn.map((x) => [x.month, x.bank, x.aed, x.pharmacy, round2(x.bank - x.aed - x.pharmacy), x.otherIn]),
    [10, 24, 20, 22, 22, 16],
    [2, 3, 4, 5, 6],
  );
  sheet(
    "Money out",
    ["Month", "Paid from bank", "Matched to core entries", "Own transfers & cash withdrawn", "Not found in core accounts"],
    r.moneyOut.map((x) => [x.month, x.total, x.matched, x.notExpense, x.unmatched]),
    [10, 16, 22, 26, 24],
    [2, 3, 4, 5],
  );
  sheet(
    "Not in core — by payee",
    ["Paid to", "How", "Payments", "Amount", "Months"],
    r.unmatchedByPayee.map((x) => [x.party, BANK_KIND_LABELS[x.kind as BankKind] ?? x.kind, x.count, x.amount, x.months.join(", ")]),
    [36, 24, 10, 14, 40],
    [4],
  );
  sheet(
    "Not in core — lines",
    ["Date", "Paid to", "How", "Amount", "Bank narration"],
    r.unmatched.map((x) => [x.date, x.party, BANK_KIND_LABELS[x.kind as BankKind] ?? x.kind, x.amount, x.description]),
    [12, 30, 22, 14, 80],
    [4],
  );
  sheet(
    "Matched",
    ["Bank date", "Paid to", "Amount", "Core entry", "Entry date"],
    r.matched.map((x) => [x.date, x.party, x.amount, x.with, x.withDate]),
    [12, 30, 14, 60, 12],
    [3],
  );
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `AED-bank-check-${r.from}-to-${r.to}.xlsx` };
}

const bookInput = z.object({
  lineIds: z.array(z.string().min(1)).min(1, "Choose the payments").max(500),
  categoryId: z.string().min(1, "Choose the expense head"),
  subcategoryId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
  intoClosedDays: z.boolean().optional(),
});

/**
 * Enters bank payments that have no entry in the core accounts as expenses — one expense per payment,
 * on the bank's date, paid by bank or UPI. Each payment is checked again first: one that now matches an
 * expense (entered meanwhile, or already booked from here) is skipped, so nothing is entered twice.
 */
export async function bookBankPayments(actor: Actor, raw: unknown) {
  requirePermission(actor, writePerm("expense"));
  const parsed = bookInput.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the details");
  const b = parsed.data;
  if (b.intoClosedDays) requirePermission(actor, "accounts.reopen");
  const chosen = await prisma.bankLine.findMany({ where: { id: { in: b.lineIds } } });
  if (chosen.length !== new Set(b.lineIds).size) throw badRequest("Some bank lines were not found — refresh and try again");
  const dates = chosen.map((l) => fromDbDate(l.date)).sort();
  const report = await bankReport(actor, { from: `${dates[0].slice(0, 4)}-01-01`, to: dates[dates.length - 1] });
  const stillMissing = new Set(report.unmatched.map((u) => u.id));
  const modes = await prisma.paymentMode.findMany({ where: { active: true, reconGroup: { in: ["BANK", "UPI"] } }, orderBy: { name: "asc" } });
  const modeFor = (kind: string) => modes.find((m) => m.reconGroup === (kind === "UPI_OUT" ? "UPI" : "BANK")) ?? modes[0];
  if (!modes.length) throw badRequest("Add a Bank or UPI payment mode in Master Data first");
  const how: Record<string, string> = { UPI_OUT: "UPI", CHEQUE: "cheque", TRANSFER_OUT: "bank transfer", CARD: "debit card", ACH: "auto-debit" };
  const touched = new Set<ISODate>();
  let booked = 0;
  let amount = 0;
  let skipped = 0;
  await prisma.$transaction(
    (tx) =>
      withBulkCache(
        async () => {
          for (const l of chosen) {
            if (!stillMissing.has(l.id)) {
              skipped++;
              continue;
            }
            const date = fromDbDate(l.date);
            await insertRecord(
              tx,
              actor,
              "expense",
              {
                date,
                categoryId: b.categoryId,
                subcategoryId: b.subcategoryId || null,
                departmentId: b.departmentId || null,
                description: `${b.description || l.party || "Bank payment"} — paid by ${how[l.kind] ?? "bank"}`.slice(0, 300),
                vendor: l.party?.slice(0, 120) ?? null,
                billNumber: `BANK-${date}-${l.id.slice(-6)}`,
                amount: toNum(l.debit),
                paymentModeId: modeFor(l.kind)!.id,
                remarks: `From the bank statement: ${l.description}`.slice(0, 500),
              },
              { allowDuplicate: true, quietAudit: true },
            );
            touched.add(date);
            booked++;
            amount = round2(amount + toNum(l.debit));
          }
          await audit(tx, actor, {
            action: "BANK_BOOK_EXPENSES",
            entityType: "BankLine",
            entityId: "bank",
            after: { lines: b.lineIds.length, booked, amount, categoryId: b.categoryId },
          });
        },
        { allowClosed: b.intoClosedDays },
      ),
    { timeout: 120_000, maxWait: 10_000 },
  );
  if (b.intoClosedDays && touched.size) await refreshClosedDays(actor, [...touched], "Expenses entered from the bank statement");
  return { booked, amount, skipped };
}

/**
 * The reviewed payments sheet (downloaded, checked, filled in): rows marked "Yes" with an expense head
 * are entered as expenses through bookBankPayments, so each is re-checked against the core accounts and
 * skipped if it is already there. Rows are found by date, amount and the bank's narration.
 */
export async function bookFromReviewedSheet(actor: Actor, fileName: string, buf: Buffer, opts: { intoClosedDays?: boolean } = {}) {
  requirePermission(actor, writePerm("expense"));
  const { readSpreadsheet } = await import("../spreadsheet");
  const sheets = await readSpreadsheet(fileName, buf);
  const n = (s: unknown) => norm(String(s ?? ""));
  const sh = sheets.find((s) => s.headers.some((h) => n(h).startsWith("enter as expense")));
  if (!sh) throw badRequest('Use the reviewed payments sheet: it needs the columns Date, Amount, Bank narration, "Enter as expense?" and "Expense head"');
  const col = (start: string) => sh.headers.find((h) => n(h).startsWith(start));
  const [cDate, cAmt, cNarr, cYes, cHead, cSub, cDept, cDesc] = [
    "date",
    "amount",
    "bank narration",
    "enter as expense",
    "expense head",
    "sub head",
    "department",
    "description",
  ].map(col);
  if (!cDate || !cAmt || !cNarr || !cHead) throw badRequest("The sheet is missing the Date, Amount, Bank narration or Expense head column");
  const [cats, depts] = await Promise.all([
    prisma.expenseCategory.findMany({ where: { active: true }, select: { id: true, name: true, parentId: true } }),
    prisma.department.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  const errors: string[] = [];
  const groups = new Map<string, { categoryId: string; subcategoryId: string | null; departmentId: string | null; description: string | null; lineIds: string[] }>();
  let notFound = 0;
  for (const r of sh.rows) {
    if (!/^y/i.test(String(r.values[cYes!] ?? "").trim())) continue;
    const at = `row ${r.rowNumber}`;
    // Dates come out of Excel as YYYY-MM-DD; a sheet re-saved with day-first text dates is read too.
    const raw = String(r.values[cDate] ?? "").trim();
    const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw);
    const date = dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : raw.slice(0, 10);
    const amount = Number(String(r.values[cAmt] ?? "").replace(/,/g, ""));
    if (!isISODate(date) || !(amount > 0)) {
      errors.push(`${at}: date or amount missing`);
      continue;
    }
    const cat = cats.find((c) => !c.parentId && n(c.name) === n(r.values[cHead]));
    if (!cat) {
      errors.push(`${at}: no expense head called "${r.values[cHead] ?? ""}"`);
      continue;
    }
    const subName = cSub ? n(r.values[cSub]) : "";
    const sub = subName ? cats.find((c) => c.parentId === cat.id && n(c.name) === subName) : null;
    if (subName && !sub) {
      errors.push(`${at}: "${r.values[cSub!]}" is not a sub-head of ${cat.name}`);
      continue;
    }
    const deptName = cDept ? n(r.values[cDept]) : "";
    const dept = deptName ? depts.find((d) => n(d.name) === deptName) : null;
    if (deptName && !dept) {
      errors.push(`${at}: no department called "${r.values[cDept!]}"`);
      continue;
    }
    const line = await prisma.bankLine.findFirst({ where: { date: toDbDate(date as ISODate), debit: amount, description: String(r.values[cNarr] ?? "").trim() } });
    if (!line) {
      notFound++;
      continue;
    }
    const description = cDesc ? String(r.values[cDesc] ?? "").trim() || null : null;
    const k = [cat.id, sub?.id, dept?.id, description].join("|");
    const g = groups.get(k) ?? { categoryId: cat.id, subcategoryId: sub?.id ?? null, departmentId: dept?.id ?? null, description, lineIds: [] };
    g.lineIds.push(line.id);
    groups.set(k, g);
  }
  if (errors.length) throw badRequest(`Nothing was entered. Fix these rows: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? ` (and ${errors.length - 8} more)` : ""}`);
  let booked = 0;
  let amount = 0;
  let skipped = 0;
  for (const g of groups.values()) {
    const r = await bookBankPayments(actor, { ...g, intoClosedDays: opts.intoClosedDays });
    booked += r.booked;
    amount = round2(amount + r.amount);
    skipped += r.skipped;
  }
  return { booked, amount, skipped, notFound };
}

const LAB_WORDS = /lab|reagent|diagnos|kit|scientific|pathlab|consumable|medical suppl|bio/i;

/** Smallest set (up to 6 bills) whose amounts add up to `target` (to the rupee); nearest dates are tried first. */
function subsetSum(bills: { id: string; amount: number }[], target: number): string[] | null {
  const cents = Math.round(target * 100);
  const list = bills.slice(0, 22).map((b) => ({ id: b.id, c: Math.round(b.amount * 100) }));
  for (let size = 1; size <= 6; size++) {
    const pick: number[] = [];
    const walk = (start: number, left: number): boolean => {
      if (pick.length === size) return Math.abs(left) <= 100;
      for (let i = start; i < list.length; i++) {
        if (list[i].c > left + 100) continue;
        pick.push(i);
        if (walk(i + 1, left - list[i].c)) return true;
        pick.pop();
      }
      return false;
    };
    if (walk(0, cents)) return pick.map((i) => list[i].id);
  }
  return null;
}

/**
 * Lab payments entered from the bank, checked against the lab bills that were already in the core
 * accounts: when bills dated from 60 days before to 31 days after a cheque add up exactly to it, the bank entry is a
 * duplicate (the bills were entered, the cheque paid them). With `apply`, duplicates are voided — and
 * "probable" ones too when asked: the supplier has bills around then, but no exact total.
 */
export async function labBankDuplicates(actor: Actor, opts: { apply?: boolean; includeProbable?: boolean; intoClosedDays?: boolean } = {}) {
  requirePermission(actor, writePerm("expense"));
  if (opts.apply && opts.intoClosedDays) requirePermission(actor, "accounts.reopen");
  const lab = await prisma.serviceDepartment.findFirst({ where: { name: "Laboratory" }, include: { costs: { where: { kind: "MATCH" } } } });
  const rules = (lab?.costs ?? []).map((c) => ({ label: c.label, patterns: matchPatterns(c.matchText ?? "").map((p) => p.slice(1, -1)) })).filter((r) => r.patterns.length);
  const compact = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const ruleOf = (text: string) => rules.find((r) => r.patterns.some((p) => compact(text).includes(p)))?.label ?? null;
  const all = await prisma.expense.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      date: true,
      amount: true,
      description: true,
      vendor: true,
      billNumber: true,
      remarks: true,
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });
  const fromBank = all.filter((e) => e.billNumber?.startsWith("BANK-"));
  const bills = all
    .filter((e) => !e.billNumber?.startsWith("BANK-"))
    .map((e) => {
      const text = `${e.vendor ?? ""} ${e.description} ${e.category.name} ${e.subcategory?.name ?? ""}`;
      return { id: e.id, date: fromDbDate(e.date), amount: toNum(e.amount), text, rule: ruleOf(text), labLike: LAB_WORDS.test(text), used: false };
    })
    .filter((b) => b.rule || b.labLike);
  const results: {
    id: string;
    date: string;
    supplier: string | null;
    amount: number;
    status: "duplicate" | "probable" | "keep";
    matchedBills: { date: string; amount: number; text: string }[];
  }[] = [];
  for (const e of fromBank) {
    const text = `${e.vendor ?? ""} ${e.description}`;
    const rule = ruleOf(text);
    if (!rule && !LAB_WORDS.test(`${text} ${e.category.name} ${e.subcategory?.name ?? ""}`)) continue; // only lab entries
    const d = fromDbDate(e.date);
    // Bills dated up to 60 days before the payment, or up to 31 days after (entered when the invoice arrived).
    const near = bills.filter((b) => !b.used && b.date >= addDays(d, -60) && b.date <= addDays(d, 31));
    const dist = (b: { date: string }) => Math.abs(+new Date(b.date) - +new Date(d));
    const same = near.filter((b) => rule && b.rule === rule).sort((a, b) => dist(a) - dist(b));
    const generic = near.filter((b) => !b.rule).sort((a, b) => dist(a) - dist(b));
    const amount = toNum(e.amount);
    const hit = subsetSum(same, amount) ?? subsetSum(generic, amount);
    const status = hit ? "duplicate" : same.length ? "probable" : "keep";
    const matched = hit ? bills.filter((b) => hit.includes(b.id)) : [];
    for (const b of matched) b.used = true;
    results.push({
      id: e.id,
      date: d,
      supplier: e.vendor,
      amount,
      status,
      matchedBills: (hit ? matched : same.slice(0, 5)).map((b) => ({ date: b.date, amount: b.amount, text: b.text.trim().slice(0, 120) })),
    });
  }
  const sumOf = (s: string) => round2(results.filter((r) => r.status === s).reduce((a, r) => a + r.amount, 0));
  const summary = {
    checked: results.length,
    duplicate: { count: results.filter((r) => r.status === "duplicate").length, amount: sumOf("duplicate") },
    probable: { count: results.filter((r) => r.status === "probable").length, amount: sumOf("probable") },
    keep: { count: results.filter((r) => r.status === "keep").length, amount: sumOf("keep") },
    removed: 0,
  };
  if (opts.apply) {
    const remove = results.filter((r) => r.status === "duplicate" || (opts.includeProbable && r.status === "probable"));
    const touched = new Set<ISODate>();
    await prisma.$transaction(
      (tx) =>
        withBulkCache(
          async () => {
            for (const r of remove) {
              await applyVoid(tx, actor, "expense", r.id, `Entered from the bank statement, but the lab bills it paid were already in the accounts (${r.status})`);
              touched.add(r.date as ISODate);
            }
          },
          { allowClosed: opts.intoClosedDays },
        ),
      { timeout: 120_000, maxWait: 10_000 },
    );
    if (opts.intoClosedDays && touched.size) await refreshClosedDays(actor, [...touched], "Duplicate lab entries from the bank removed");
    summary.removed = remove.length;
  }
  return { summary, results };
}
