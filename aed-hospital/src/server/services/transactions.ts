/**
 * Transaction service: create / correct / void / list for every module.
 * Invariants (see ACCOUNTING_RULES.md §7):
 *  - rows are never updated in place: a correction supersedes the original;
 *  - a CLOSED day rejects all changes (corrections become approval requests);
 *  - every change is audited in the same DB transaction.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { fromDbDate, type ISODate } from "@/lib/dates";
import { MODULES, viewPerm, writePerm, type ModuleKey } from "@/lib/modules";
import { reasonSchema } from "@/lib/schemas";
import { round2, toNum } from "@/lib/money";
import { audit } from "../audit";
import { can, requirePermission, type Actor } from "../authz";
import { assertDayWritable, getDayStatuses, onDayMutated } from "../closing";
import { prisma, type Tx } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { ADAPTERS, parseInput, type ListFilters } from "./modules";

const TX_OPTS = { timeout: 30_000, maxWait: 10_000 };

export interface CreateOptions {
  tx?: Tx;
  importBatchId?: string | null;
  /** Skip the "possible duplicate" check (user confirmed, or import already decided). */
  allowDuplicate?: boolean;
  /** Skip auditing each row (imports audit the batch instead). */
  quietAudit?: boolean;
  correctionOfId?: string;
}

async function findDuplicate(tx: Tx, module: ModuleKey, fingerprint: string, excludeId?: string) {
  const a = ADAPTERS[module];
  return a.delegate(tx).findFirst({
    where: { fingerprint, status: "ACTIVE", ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  }) as Promise<{ id: string } | null>;
}

/**
 * Validate and build a row for bulk insertion (import commit) without writing it.
 * Rows that need follow-up writes (IPD admissions with an initial payment) return `after`
 * and must go through insertRecord instead.
 */
export async function prepareRecord(tx: Tx, actor: Actor, module: ModuleKey, raw: unknown, importBatchId: string) {
  const a = ADAPTERS[module];
  const input = parseInput(module, raw);
  const built = await a.build(tx, input);
  await assertDayWritable(tx, built.date);
  const id = `imp_${randomUUID().replace(/-/g, "")}`;
  return {
    id,
    module,
    date: built.date,
    amount: built.amount,
    needsSingleInsert: !!built.after,
    data: { ...built.data, id, fingerprint: built.fingerprint, createdById: actor.id, importBatchId, correctionOfId: null },
  };
}

/** Insert prepared rows with one INSERT per module per 500 rows. */
export async function bulkInsertPrepared(tx: Tx, rows: { module: ModuleKey; data: Record<string, unknown> }[]) {
  const byModule = new Map<ModuleKey, Record<string, unknown>[]>();
  for (const r of rows) byModule.set(r.module, [...(byModule.get(r.module) ?? []), r.data]);
  for (const [module, data] of byModule) {
    const del = ADAPTERS[module].delegate(tx);
    for (let i = 0; i < data.length; i += 500) await del.createMany({ data: data.slice(i, i + 500) });
  }
}

/** Core insert — assumes permission already checked. Returns the created row id. */
export async function insertRecord(tx: Tx, actor: Actor, module: ModuleKey, raw: unknown, opts: CreateOptions = {}) {
  const a = ADAPTERS[module];
  const input = parseInput(module, raw);
  const built = await a.build(tx, input);
  await assertDayWritable(tx, built.date);
  if (!opts.allowDuplicate) {
    const dup = await findDuplicate(tx, module, built.fingerprint);
    if (dup) {
      throw conflict("Possible duplicate: a record with the same date, patient, reference, service and amount already exists.", {
        code: "POSSIBLE_DUPLICATE",
        duplicateOf: dup.id,
      });
    }
  }
  // Expenses entered by staff wait for an approver; they count nowhere until approved.
  const pending = module === "expense" && !opts.importBatchId && !can(actor, "expense.approve");
  const created = await a.delegate(tx).create({
    data: {
      ...built.data,
      ...(pending ? { status: "PENDING" } : {}),
      fingerprint: built.fingerprint,
      createdById: actor.id,
      importBatchId: opts.importBatchId ?? null,
      correctionOfId: opts.correctionOfId ?? null,
    },
  });
  if (built.after) await built.after(tx, created, { createdById: actor.id, importBatchId: opts.importBatchId });
  if (!opts.quietAudit) {
    await audit(tx, actor, { action: opts.correctionOfId ? "CORRECTION_CREATE" : "CREATE", entityType: a.entityType, entityId: created.id, after: created });
  }
  if (!opts.importBatchId && !pending) await onDayMutated(tx, actor, built.date, `${MODULES[module].singular} added`);
  return { id: created.id as string, date: built.date, amount: built.amount, fingerprint: built.fingerprint, pending };
}

export async function createTransaction(actor: Actor, module: ModuleKey, raw: Record<string, unknown>) {
  requirePermission(actor, writePerm(module));
  const allowDuplicate = raw.confirmDuplicate === true;
  return prisma.$transaction((tx) => insertRecord(tx, actor, module, raw, { allowDuplicate }), TX_OPTS);
}

async function loadActive(tx: Tx, module: ModuleKey, id: string) {
  const a = ADAPTERS[module];
  const row = await a.delegate(tx).findUnique({ where: { id } });
  if (!row) throw notFound(`${MODULES[module].singular} not found`);
  if (row.status !== "ACTIVE") throw badRequest(`This record is ${row.status.toLowerCase()} and can no longer be changed`);
  return row;
}

const rowDate = (module: ModuleKey, row: any): ISODate => fromDbDate(row[ADAPTERS[module].dateField]);

/** Apply a correction (supersede + recreate). Bypasses the closed-day lock only when `approvedBy` is set. */
export async function applyCorrection(tx: Tx, actor: Actor, module: ModuleKey, id: string, raw: unknown, reason: string, approval?: { requestId: string; approver: Actor }) {
  const a = ADAPTERS[module];
  const original = await loadActive(tx, module, id);
  const input = parseInput(module, raw);
  const built = await a.build(tx, input);
  const dates = [rowDate(module, original), built.date];
  if (!approval) for (const d of dates) await assertDayWritable(tx, d);

  await a.delegate(tx).update({ where: { id }, data: { status: "SUPERSEDED" } });
  const created = await a.delegate(tx).create({
    data: { ...built.data, fingerprint: built.fingerprint, createdById: actor.id, importBatchId: null, correctionOfId: id },
  });
  if (module === "ipd") {
    // Payments follow the corrected admission (admissionId is the only mutable column on IpdTransaction).
    await tx.ipdTransaction.updateMany({ where: { admissionId: id }, data: { admissionId: created.id } });
  }
  if (built.after) await built.after(tx, created, { createdById: actor.id });
  await audit(tx, approval?.approver ?? actor, {
    action: approval ? "CORRECTION_APPROVED" : "CORRECT",
    entityType: a.entityType,
    entityId: created.id,
    before: original,
    after: created,
    reason: approval ? `${reason} (request ${approval.requestId}, requested by ${actor.username})` : reason,
  });
  for (const d of new Set(dates)) await onDayMutated(tx, approval?.approver ?? actor, d, `${MODULES[module].singular} corrected`);
  return { id: created.id as string, supersededId: id };
}

export async function applyVoid(tx: Tx, actor: Actor, module: ModuleKey, id: string, reason: string, approval?: { requestId: string; approver: Actor }) {
  const a = ADAPTERS[module];
  const original = await loadActive(tx, module, id);
  const date = rowDate(module, original);
  if (!approval) await assertDayWritable(tx, date);
  if (module === "ipd") {
    const active = await tx.ipdTransaction.count({ where: { admissionId: id, status: "ACTIVE" } });
    if (active) throw badRequest("Void or refund the admission's payments first");
  }
  const updated = await a.delegate(tx).update({ where: { id }, data: { status: "VOIDED", voidReason: reason } });
  await audit(tx, approval?.approver ?? actor, {
    action: approval ? "VOID_APPROVED" : "VOID",
    entityType: a.entityType,
    entityId: id,
    before: original,
    after: updated,
    reason,
  });
  await onDayMutated(tx, approval?.approver ?? actor, date, `${MODULES[module].singular} voided`);
  return { id };
}

/**
 * Correct a record. On an open day the correction is applied immediately; if the
 * record's day (or the new date) is CLOSED, a correction request is raised instead.
 */
export async function correctTransaction(actor: Actor, module: ModuleKey, id: string, raw: Record<string, unknown>) {
  requirePermission(actor, writePerm(module));
  const { reason } = reasonSchema.parse(raw);
  const payload = { ...raw };
  delete payload.reason;
  return prisma.$transaction(async (tx) => {
    const original = await loadActive(tx, module, id);
    const input = parseInput(module, payload); // validate before deciding
    const newDate = (input as any).date ?? (input as any).admissionDate;
    const statuses = await getDayStatuses(tx, [rowDate(module, original), newDate]);
    if ([...statuses.values()].includes("CLOSED")) {
      const req = await raiseRequest(tx, actor, module, id, { action: "CORRECT", data: payload }, reason);
      return { status: "PENDING_APPROVAL" as const, requestId: req.id };
    }
    const r = await applyCorrection(tx, actor, module, id, payload, reason);
    return { status: "APPLIED" as const, ...r };
  }, TX_OPTS);
}

export async function voidTransaction(actor: Actor, module: ModuleKey, id: string, raw: Record<string, unknown>) {
  requirePermission(actor, writePerm(module));
  const { reason } = reasonSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const original = await loadActive(tx, module, id);
    const statuses = await getDayStatuses(tx, [rowDate(module, original)]);
    if ([...statuses.values()].includes("CLOSED")) {
      const req = await raiseRequest(tx, actor, module, id, { action: "VOID" }, reason);
      return { status: "PENDING_APPROVAL" as const, requestId: req.id };
    }
    const r = await applyVoid(tx, actor, module, id, reason);
    return { status: "APPLIED" as const, ...r };
  }, TX_OPTS);
}

async function raiseRequest(tx: Tx, actor: Actor, module: ModuleKey, entityId: string, proposed: object, reason: string) {
  const pending = await tx.correctionRequest.findFirst({ where: { module, entityId, status: "PENDING" } });
  if (pending) throw conflict("A correction request for this record is already pending approval");
  const req = await tx.correctionRequest.create({ data: { module, entityId, proposed, reason, requestedById: actor.id } });
  await audit(tx, actor, { action: "CORRECTION_REQUESTED", entityType: ADAPTERS[module].entityType, entityId, after: proposed, reason });
  return req;
}

/** Approve or reject a pending correction request. Approvers cannot approve their own request unless Admin. */
export async function reviewCorrection(approver: Actor, requestId: string, decision: "APPROVE" | "REJECT", note?: string) {
  requirePermission(approver, "corrections.approve");
  return prisma.$transaction(async (tx) => {
    const req = await tx.correctionRequest.findUnique({ where: { id: requestId } });
    if (!req) throw notFound("Correction request not found");
    if (req.status !== "PENDING") throw badRequest(`Request already ${req.status.toLowerCase()}`);
    if (req.requestedById === approver.id && approver.roleCode !== "ADMIN") throw forbidden("You cannot approve your own correction request");
    const mod = req.module as ModuleKey;
    let resultEntityId: string | null = null;
    if (decision === "APPROVE") {
      const requester = await tx.user.findUniqueOrThrow({ where: { id: req.requestedById } });
      const requesterActor: Actor = { id: requester.id, username: requester.username, name: requester.name, roleCode: "", roleName: "", permissions: new Set(), mustChangePassword: false };
      const proposed = req.proposed as { action: "CORRECT" | "VOID"; data?: Record<string, unknown> };
      if (proposed.action === "VOID") {
        await applyVoid(tx, requesterActor, mod, req.entityId, req.reason, { requestId: req.id, approver });
      } else {
        const r = await applyCorrection(tx, requesterActor, mod, req.entityId, proposed.data, req.reason, { requestId: req.id, approver });
        resultEntityId = r.id;
      }
    } else {
      await audit(tx, approver, { action: "CORRECTION_REJECTED", entityType: ADAPTERS[mod].entityType, entityId: req.entityId, reason: note ?? null });
    }
    return tx.correctionRequest.update({
      where: { id: req.id },
      data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: approver.id, reviewedAt: new Date(), reviewNote: note ?? null, resultEntityId },
    });
  }, TX_OPTS);
}

export interface ListResult {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totals: Record<string, number>;
}

export async function listTransactions(actor: Actor, module: ModuleKey, f: ListFilters & { page?: string; pageSize?: string; sort?: string }): Promise<ListResult> {
  requirePermission(actor, viewPerm(module));
  const a = ADAPTERS[module];
  const page = Math.max(1, Number(f.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(f.pageSize) || 50));
  const where: Record<string, unknown> = { ...a.filterWhere(f) };
  if (f.status !== "ALL") where.status = f.status && f.status !== "ACTIVE" ? f.status : "ACTIVE";
  if (f.q?.trim()) where.OR = a.searchWhere(f.q.trim());
  const del = a.delegate(prisma);
  const orderBy = [{ [a.dateField]: f.sort === "asc" ? "asc" : "desc" }, { createdAt: "desc" }];
  const [records, total, agg] = await Promise.all([
    del.findMany({ where, include: a.include, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    del.count({ where }),
    del.aggregate({ where, _sum: Object.fromEntries(a.sumFields.filter((s) => !["collected", "balance", "signedAmount"].includes(s)).map((s) => [s, true])) }),
  ]);
  const mask = !can(actor, "patients.view_identity");
  const rows = records.map((r: any) => a.toRow(r, { mask }));
  const totals: Record<string, number> = { count: total };
  for (const [k, v] of Object.entries(agg._sum ?? {})) totals[k] = toNum(v as any);
  if (module === "ipd") {
    // Collected/balance across the whole filtered set (not just this page).
    const txs = await prisma.ipdTransaction.findMany({ where: { status: "ACTIVE", admission: where }, select: { type: true, amount: true } });
    const collected = txs.reduce((s, t) => s + (t.type === "REFUND" ? -toNum(t.amount) : toNum(t.amount)), 0);
    totals.collected = round2(collected);
    totals.balance = round2((totals.netAmount ?? 0) - collected);
  }
  if (module === "ipd-payment") {
    const refunds = await prisma.ipdTransaction.aggregate({ where: { ...where, type: "REFUND" }, _sum: { amount: true } });
    totals.signedAmount = round2((totals.amount ?? 0) - 2 * toNum(refunds._sum.amount));
  }
  return { rows, total, page, pageSize, totals };
}

export async function getTransaction(actor: Actor, module: ModuleKey, id: string) {
  requirePermission(actor, viewPerm(module));
  const a = ADAPTERS[module];
  const r = await a.delegate(prisma).findUnique({ where: { id }, include: a.include });
  if (!r) throw notFound();
  const mask = !can(actor, "patients.view_identity");
  // Walk the correction chain in both directions.
  const chain: { id: string; status: string; createdAt: Date }[] = [];
  let cursor: any = r;
  while (cursor?.correctionOfId) {
    cursor = await a.delegate(prisma).findUnique({ where: { id: cursor.correctionOfId }, select: { id: true, status: true, createdAt: true, correctionOfId: true } });
    if (cursor) chain.unshift(cursor);
  }
  const successor = await a.delegate(prisma).findFirst({ where: { correctionOfId: id }, select: { id: true, status: true, createdAt: true } });
  const ids = [...chain.map((c) => c.id), id, ...(successor ? [successor.id] : [])];
  const history = await prisma.auditLog.findMany({ where: { entityType: a.entityType, entityId: { in: ids } }, orderBy: { createdAt: "asc" } });
  const requests = await prisma.correctionRequest.findMany({ where: { module, entityId: id }, orderBy: { requestedAt: "desc" } });
  const unmasked = a.toRow(r, { mask: false });
  return { row: a.toRow(r, { mask }), input: can(actor, writePerm(module)) ? unmasked : null, chain, successor, history, requests };
}

/** Record (or change) an IPD discharge date. dischargeDate is an operational field, audited but not financial. */
export async function dischargeAdmission(actor: Actor, id: string, dischargeDate: string) {
  requirePermission(actor, "ipd.write");
  const { isISODate } = await import("@/lib/dates");
  if (!isISODate(dischargeDate)) throw badRequest("Invalid discharge date");
  return prisma.$transaction(async (tx) => {
    const adm = await loadActive(tx, "ipd", id);
    if (dischargeDate < fromDbDate(adm.admissionDate)) throw badRequest("Discharge date cannot be before the admission date");
    const { toDbDate } = await import("@/lib/dates");
    const updated = await tx.ipdAdmission.update({ where: { id }, data: { dischargeDate: toDbDate(dischargeDate) } });
    await audit(tx, actor, { action: "DISCHARGE", entityType: "IpdAdmission", entityId: id, before: { dischargeDate: adm.dischargeDate }, after: { dischargeDate } });
    return { id: updated.id };
  });
}
