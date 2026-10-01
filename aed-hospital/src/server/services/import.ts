/**
 * Excel Import Centre: upload → map → validate → review → commit → history → reverse.
 * See EXCEL_IMPORT_SPEC.md for the complete behaviour.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import type { ImportRowStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import ExcelJS from "exceljs";
import { fromDbDate, todayISO, toDbDate, type ISODate } from "@/lib/dates";
import { suggestMapping, missingRequired, type Mapping } from "@/lib/import/mapping";
import { normalizeRow, parsePlaceholder, NEW_PREFIX, type MasterCtx, type NewMasterType } from "@/lib/import/normalize";
import { norm } from "@/lib/import/text";
import { IMPORT_TYPES, MODULES, importFieldsFor, isImportType, type ImportType, type ModuleKey } from "@/lib/modules";
import { round2, toNum } from "@/lib/money";
import { MODULE_SCHEMAS, zodErrorMap } from "@/lib/schemas";
import { audit } from "../audit";
import { can, requirePermission, type Actor } from "../authz";
import { getDayStatuses, onDayMutated } from "../closing";
import { prisma, type Tx } from "../db";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { readSpreadsheet, type SheetData } from "../spreadsheet";
import { classifyLabItem } from "@/lib/import/lab-category";
import { canonicalItemName, itemFingerprint, itemForm, normalizeItemRow, type ItemLineInput } from "@/lib/import/items";
import { normalizePaymentRow, paymentFingerprint, type SupplierPaymentInput } from "@/lib/import/payments";
import { convertHmsSheet, HmsReportError, HMS_LABELS, type ConvertedSheet } from "@/lib/import/hms";
import { fingerprintFor } from "./modules";
import { bulkInsertPrepared, insertRecord, prepareRecord } from "./transactions";
import { withBulkCache } from "../bulk-cache";

const LONG_TX = { timeout: 600_000, maxWait: 20_000 };

/** Guess the import type from a sheet name (e.g. "OPD Sep", "Lab Register", "Expenses"). */
export function guessType(sheetName: string, fallback?: string): ImportType | null {
  const s = norm(sheetName);
  const rules: [RegExp, ImportType][] = [
    [/\bopd\b|consult/, "opd"],
    [/\bipd\b|admission|inpatient/, "ipd"],
    [/\blab|diagnos|investigation|radiology/, "lab"],
    [/pharm.*purchase|purchase/, "pharmacy-purchase"],
    [/pharm.*return|return/, "pharmacy-return"],
    [/pharm|medicine/, "pharmacy-sale"],
    [/diet|nutrition/, "diet"],
    [/expen|expenditure|payment voucher/, "expense"],
    [/income|collection|revenue/, "combined-income"],
  ];
  for (const [re, t] of rules) if (re.test(s)) return t;
  return fallback && isImportType(fallback) ? fallback : null;
}

// ─────────────────────────── upload ───────────────────────────

export async function uploadFile(actor: Actor, fileName: string, buf: Buffer, typeHint?: string) {
  requirePermission(actor, "import.run");
  const safeName = fileName.replace(/[^\w.\- ()]/g, "_").slice(0, 150);
  const sheets = expandHmsReports(await readSpreadsheet(safeName, buf));
  const fileHash = createHash("sha256").update(buf).digest("hex");
  const groupId = randomUUID();
  const previous = await prisma.importBatch.findMany({
    where: { fileHash, status: "IMPORTED" },
    select: { id: true, sheetName: true, committedAt: true, uploadedById: true },
  });

  const batches = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const sh of sheets) {
      const hms = "source" in sh ? (sh as ConvertedSheet) : null;
      const type = hms?.type ?? guessType(sh.name, sheets.length === 1 ? typeHint : undefined) ?? (typeHint && isImportType(typeHint) ? typeHint : "opd");
      const batch = await tx.importBatch.create({
        data: {
          groupId,
          fileName: safeName,
          fileHash,
          sheetName: sh.name,
          module: type,
          headers: sh.headers,
          recordsFound: sh.rows.length,
          uploadedById: actor.id,
          options: hms ? { source: hms.source, sourceLabel: HMS_LABELS[hms.source], note: hms.note } : undefined,
        },
      });
      for (let i = 0; i < sh.rows.length; i += 2000) {
        await tx.importRecord.createMany({
          data: sh.rows.slice(i, i + 2000).map((r) => ({ batchId: batch.id, rowNumber: r.rowNumber, raw: r.values as Prisma.InputJsonValue })),
        });
      }
      out.push({
        id: batch.id,
        sheetName: sh.name,
        headerRow: sh.headerRow,
        headers: sh.headers,
        rows: sh.rows.length,
        type,
        sample: sh.rows.slice(0, 5).map((r) => r.values),
        suggestion: suggestMapping(sh.headers, importFieldsFor(type)),
        previouslyImported: previous.filter((p) => p.sheetName === sh.name).map((p) => ({ batchId: p.id, at: p.committedAt })),
        note: hms?.note ?? null,
      });
    }
    await audit(tx, actor, { action: "IMPORT_UPLOAD", entityType: "ImportBatch", entityId: groupId, after: { fileName: safeName, fileHash, sheets: out.map((b) => ({ id: b.id, sheet: b.sheetName, rows: b.rows })) } });
    return out;
  }, LONG_TX);
  return { groupId, fileName: safeName, batches };
}

/** Replace recognised OneGlance report sheets with converted, month-split sheets. */
function expandHmsReports(sheets: SheetData[]): (SheetData | ConvertedSheet)[] {
  const out: (SheetData | ConvertedSheet)[] = [];
  for (const sh of sheets) {
    let converted: ConvertedSheet[] | null;
    try {
      converted = convertHmsSheet(sh);
    } catch (e) {
      if (e instanceof HmsReportError) throw badRequest(e.message);
      throw e;
    }
    if (converted === null) out.push(sh);
    else if (converted.length) out.push(...converted);
  }
  if (!out.length) throw badRequest("No importable rows found in this report");
  return out;
}

// ─────────────────────────── masters context ───────────────────────────

export async function loadMasterCtx(tx: Tx = prisma): Promise<MasterCtx> {
  const [specialties, doctors, consultationTypes, admissionTypes, ipdPackages, investigations, dietServices, departments, categories, paymentModes] = await Promise.all([
    tx.specialty.findMany(),
    tx.doctor.findMany(),
    tx.consultationType.findMany(),
    tx.admissionType.findMany(),
    tx.ipdPackage.findMany(),
    tx.labInvestigation.findMany(),
    tx.dietService.findMany(),
    tx.department.findMany(),
    tx.expenseCategory.findMany(),
    tx.paymentMode.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    specialties,
    doctors: doctors.filter((d) => d.kind !== "DIETICIAN"),
    dieticians: doctors.filter((d) => d.kind === "DIETICIAN"),
    consultationTypes,
    admissionTypes,
    ipdPackages: ipdPackages.map((p) => ({ ...p, rate: toNum(p.rate) })),
    investigations: investigations.map((i) => ({ ...i, rate: toNum(i.rate) })),
    dietServices,
    departments,
    categories: categories.filter((c) => !c.parentId),
    subcategories: categories.filter((c) => c.parentId).map((c) => ({ ...c, parentId: c.parentId! })),
    paymentModes: paymentModes.map((m) => ({ id: m.id, code: m.code, name: m.name, reconGroup: m.reconGroup })),
    today: todayISO(),
  };
}

// ─────────────────────────── validate ───────────────────────────

const validateInput = z.object({
  type: z.string().refine(isImportType, "Unknown import type"),
  mapping: z.record(z.string(), z.string().nullable()),
});

interface RowOutcome {
  status: ImportRowStatus;
  normalized: any;
  errors: string[];
  warnings: string[];
  fingerprint: string | null;
  duplicateOf: string | null;
}

/** Map a normalized module input to the zod-validated shape (placeholders pass as ids). */
function checkSchema(module: ModuleKey, input: Record<string, unknown>): string[] {
  const r = MODULE_SCHEMAS[module].safeParse(input);
  if (r.success) return [];
  return Object.entries(zodErrorMap(r.error)).map(([k, v]) => `${labelFor(module, k)}: ${v}`);
}

function labelFor(module: ModuleKey, key: string) {
  return MODULES[module].fields.find((f) => f.key === key)?.label ?? key;
}

export async function validateBatch(actor: Actor, batchId: string, raw: unknown) {
  requirePermission(actor, "import.run");
  const { type, mapping } = validateInput.parse(raw) as { type: ImportType; mapping: Mapping };
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound("Import batch not found");
  if (!["UPLOADED", "VALIDATED"].includes(batch.status)) throw badRequest(`Batch is already ${batch.status.toLowerCase()}`);
  const fields = importFieldsFor(type);
  const missing = missingRequired(mapping, fields);
  if (missing.length) throw badRequest(`Map these required columns (or set a fixed value): ${missing.join(", ")}`, { missing });
  const side = SIDE_SPECS[type];
  if (side) return validateSideBatch(side, batchId, mapping);

  const [records, ctx] = await Promise.all([
    prisma.importRecord.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } }),
    loadMasterCtx(),
  ]);

  // Pass 1: normalise every row.
  const results = records.map((rec) => {
    const n = normalizeRow(type, rec.raw as Record<string, unknown>, mapping, ctx);
    const errors = [...n.errors];
    if (n.module && n.input) errors.push(...checkSchema(n.module, n.input));
    for (const ex of n.extras) errors.push(...checkSchema(ex.module, ex.input));
    let fingerprint: string | null = null;
    if (!errors.length && n.module && n.input) fingerprint = fingerprintFor(n.module, n.input, n.amount);
    return { rec, n, errors, warnings: [...n.warnings], fingerprint };
  });

  // Pass 2: closed days, in-file duplicates and database duplicates.
  const dates = results.map((r) => (r.n.input?.date ?? r.n.input?.admissionDate) as ISODate | undefined).filter(Boolean) as ISODate[];
  const statuses = await getDayStatuses(prisma, dates);
  const fps = results.map((r) => r.fingerprint).filter(Boolean) as string[];
  const existing = await findExistingFingerprints(fps);
  const byBill = await findExistingOneGlanceBills(results.map((r) => r.n));
  const pharmacyClash = await findPharmacyDayClashes(results.map((r) => r.n));
  const seen = new Map<string, number>();
  const outcomes: RowOutcome[] = results.map((r) => {
    const date = (r.n.input?.date ?? r.n.input?.admissionDate) as ISODate | undefined;
    if (date && statuses.get(date) === "CLOSED") r.errors.push(`Day ${date} is closed — reopen it before importing into it`);
    let status: ImportRowStatus = r.errors.length ? "INVALID" : r.warnings.length ? "WARNING" : "VALID";
    let duplicateOf: string | null = null;
    if (status !== "INVALID" && r.fingerprint) {
      const inFile = seen.get(r.fingerprint);
      const inDb = existing.get(r.fingerprint);
      const bk = billKey(r.n);
      const sameBill = bk ? byBill.get(bk) : undefined;
      if (inDb) {
        status = "DUPLICATE";
        duplicateOf = `${inDb.module}:${inDb.id}`;
      } else if (sameBill) {
        status = "DUPLICATE";
        duplicateOf = `${sameBill.module}:${sameBill.id}`;
      } else if (pharmacyClash.has(pharmacyDayKey(r.n) ?? "")) {
        // The same day's pharmacy sales are already in the app in the other form (daily totals vs bills).
        status = "DUPLICATE";
        duplicateOf = `pharmacy-sale:${pharmacyClash.get(pharmacyDayKey(r.n)!)}`;
      } else if (inFile !== undefined) {
        status = "DUPLICATE";
        duplicateOf = `row:${inFile}`;
      }
      if (inFile === undefined) seen.set(r.fingerprint, r.rec.rowNumber);
    }
    return {
      status,
      normalized: r.n.module ? { module: r.n.module, input: r.n.input, extras: r.n.extras, amount: r.n.amount, flags: r.n.flags } : { flags: r.n.flags },
      errors: r.errors,
      warnings: r.warnings,
      fingerprint: r.fingerprint,
      duplicateOf,
    };
  });

  const summary = summarize(outcomes);
  await prisma.$transaction(async (tx) => {
    await tx.importRecord.deleteMany({ where: { batchId } });
    await tx.importRecord.createMany({
      data: records.map((rec, i) => ({
        batchId,
        rowNumber: rec.rowNumber,
        raw: rec.raw as Prisma.InputJsonValue,
        normalized: outcomes[i].normalized,
        status: outcomes[i].status,
        errors: outcomes[i].errors.length ? outcomes[i].errors : undefined,
        warnings: outcomes[i].warnings.length ? outcomes[i].warnings : undefined,
        fingerprint: outcomes[i].fingerprint,
        duplicateOf: outcomes[i].duplicateOf,
        forceImport: false,
      })),
    });
    await tx.importBatch.update({
      where: { id: batchId },
      data: {
        module: type,
        mapping,
        status: "VALIDATED",
        validatedAt: new Date(),
        validRows: summary.valid,
        warningRows: summary.warnings,
        invalidRows: summary.invalid,
        duplicateRows: summary.duplicates,
        totalAmount: summary.validAmount,
      },
    });
  }, LONG_TX);
  return { batchId, type, summary };
}

/**
 * OneGlance OPD/diet bills carry their bill number ("OP-166259"). Two OneGlance exports of the same
 * bill can differ in specialty or consultation name, so the fingerprint alone would miss the repeat;
 * the same bill number on the same date is the same bill.
 */
function billKey(n: { module?: string | null; input?: any }): string | null {
  if (!n.module || !n.input || (n.module !== "opd" && n.module !== "diet")) return null;
  const ref = String(n.input.reference ?? "");
  return /^OP-\d+$/.test(ref) && n.input.date ? `${n.module}|${ref}|${n.input.date}` : null;
}
async function findExistingOneGlanceBills(ns: { module?: string | null; input?: any }[]) {
  const out = new Map<string, { module: string; id: string }>();
  const refs = { opd: new Set<string>(), diet: new Set<string>() };
  for (const n of ns) if (billKey(n)) refs[n.module as "opd" | "diet"].add(String(n.input.reference));
  const look = async (module: "opd" | "diet", del: any) => {
    const list = [...refs[module]];
    for (let i = 0; i < list.length; i += 5000) {
      const rows = await del.findMany({ where: { reference: { in: list.slice(i, i + 5000) }, status: "ACTIVE" }, select: { id: true, reference: true, date: true } });
      for (const h of rows) out.set(`${module}|${h.reference}|${fromDbDate(h.date)}`, { module, id: h.id });
    }
  };
  await look("opd", prisma.consultation);
  await look("diet", prisma.dietTransaction);
  return out;
}

/**
 * Pharmacy sales arrive either as OneGlance daily totals ("PH-DAY-…") or as bills ("PHB-…"). A day
 * held in one form must not be imported again in the other, or its sales would count twice.
 * Returns, per "kind|date" of an incoming row, the id of a clashing sale already in the app.
 */
function pharmacyDayKey(n: { module?: string | null; input?: any }): string | null {
  if (n.module !== "pharmacy-sale" || !n.input?.date) return null;
  const inv = String(n.input.invoiceNo ?? "");
  if (inv.startsWith("PH-DAY-")) return `day|${n.input.date}`;
  if (inv.startsWith("PHB-")) return `bill|${n.input.date}`;
  return null;
}
async function findPharmacyDayClashes(ns: { module?: string | null; input?: any }[]) {
  const out = new Map<string, string>();
  const want = { day: new Set<string>(), bill: new Set<string>() };
  for (const n of ns) {
    const k = pharmacyDayKey(n);
    if (k) want[k.split("|")[0] as "day" | "bill"].add(k.split("|")[1]);
  }
  // Incoming daily totals clash with existing bills, and incoming bills with existing daily totals.
  for (const [kind, other] of [["day", "PHB-"], ["bill", "PH-DAY-"]] as const) {
    const dates = [...want[kind]];
    for (let i = 0; i < dates.length; i += 1000) {
      const rows = await prisma.pharmacySale.findMany({
        where: { status: "ACTIVE", invoiceNo: { startsWith: other }, date: { in: dates.slice(i, i + 1000).map((d) => toDbDate(d as ISODate)) } },
        select: { id: true, date: true },
      });
      for (const h of rows) out.set(`${kind}|${fromDbDate(h.date)}`, h.id);
    }
  }
  return out;
}

async function findExistingFingerprints(fps: string[]) {
  const out = new Map<string, { module: string; id: string }>();
  if (!fps.length) return out;
  const unique = [...new Set(fps)];
  const tables: [string, any][] = [
    ["opd", prisma.consultation],
    ["ipd", prisma.ipdAdmission],
    ["lab", prisma.labTransaction],
    ["pharmacy-sale", prisma.pharmacySale],
    ["pharmacy-return", prisma.pharmacyReturn],
    ["pharmacy-purchase", prisma.pharmacyPurchase],
    ["diet", prisma.dietTransaction],
    ["other-income", prisma.otherIncome],
    ["expense", prisma.expense],
  ];
  for (let i = 0; i < unique.length; i += 5000) {
    const chunk = unique.slice(i, i + 5000);
    for (const [module, del] of tables) {
      const hits = await del.findMany({ where: { fingerprint: { in: chunk }, status: "ACTIVE" }, select: { id: true, fingerprint: true } });
      for (const h of hits) out.set(h.fingerprint, { module, id: h.id });
    }
  }
  return out;
}

export function summarize(outcomes: { status: ImportRowStatus; errors: string[]; warnings: string[]; normalized: any }[]) {
  const s = {
    total: outcomes.length,
    valid: 0,
    warnings: 0,
    invalid: 0,
    duplicates: 0,
    missingDates: 0,
    missingAmounts: 0,
    unknownServices: 0,
    unknownCategories: 0,
    invalidPaymentModes: 0,
    totalsRows: 0,
    negativeAmounts: 0,
    validAmount: 0,
    byModule: {} as Record<string, number>,
  };
  for (const o of outcomes) {
    if (o.status === "VALID") s.valid++;
    else if (o.status === "WARNING") s.warnings++;
    else if (o.status === "INVALID") s.invalid++;
    else if (o.status === "DUPLICATE") s.duplicates++;
    const flags: string[] = o.normalized?.flags ?? [];
    if (flags.includes("missingDate")) s.missingDates++;
    if (flags.includes("missingAmount")) s.missingAmounts++;
    if (flags.includes("unknownService")) s.unknownServices++;
    if (flags.includes("unknownCategory")) s.unknownCategories++;
    if (flags.includes("invalidPaymentMode")) s.invalidPaymentModes++;
    if (flags.includes("totalsRow")) s.totalsRows++;
    if (flags.includes("negative")) s.negativeAmounts++;
    if (o.status === "VALID" || o.status === "WARNING") {
      s.validAmount = round2(s.validAmount + (o.normalized?.amount ?? 0));
      const m = o.normalized?.module;
      if (m) s.byModule[m] = (s.byModule[m] ?? 0) + 1;
    }
  }
  return s;
}

// ─────────────────────────── analytics-only imports ───────────────────────────
// Rows that explain the books without being income or expense (medicine lines, supplier
// payments). No closed-day checks and no day mutations; duplicates are still detected so a
// report can be re-uploaded safely, and batches reverse like any other.

interface SideSpec<I> {
  type: ImportType;
  normalize: (values: Record<string, unknown>, mapping: Mapping, today: string) => { input: I | null; errors: string[]; warnings: string[]; amount: number };
  fingerprint: (input: I) => string;
  findExisting: (fps: string[]) => Promise<{ id: string; fingerprint: string }[]>;
  /** Insert rows in one transaction; returns row ids (same order) and master rows created. */
  insert: (tx: Tx, actor: Actor, batchId: string, inputs: I[]) => Promise<{ ids: string[]; newMasters: number }>;
  amountOf: (input: I) => number;
}

const itemSpec: SideSpec<ItemLineInput> = {
  type: "pharmacy-items",
  normalize: normalizeItemRow,
  fingerprint: itemFingerprint,
  findExisting: (fps) => prisma.pharmacyItemLine.findMany({ where: { fingerprint: { in: fps }, status: "ACTIVE" }, select: { id: true, fingerprint: true } }),
  amountOf: (i) => i.amount,
  async insert(tx, actor, batchId, inputs) {
    // Medicine master: create missing names in one go, then map name → id.
    const names = [...new Set(inputs.map((i) => canonicalItemName(i.item)))];
    const before = await tx.pharmacyItem.count();
    for (let i = 0; i < names.length; i += 1000) {
      await tx.pharmacyItem.createMany({ data: names.slice(i, i + 1000).map((name) => ({ name, form: itemForm(name) })), skipDuplicates: true });
    }
    const newMasters = (await tx.pharmacyItem.count()) - before;
    const idByName = new Map<string, string>();
    for (let i = 0; i < names.length; i += 5000) {
      for (const it of await tx.pharmacyItem.findMany({ where: { name: { in: names.slice(i, i + 5000) } }, select: { id: true, name: true } })) idByName.set(it.name, it.id);
    }
    const ids = inputs.map(() => randomUUID());
    const rows = inputs.map((i, n) => ({
      id: ids[n],
      kind: i.kind,
      date: new Date(`${i.date}T00:00:00.000Z`),
      docNo: i.docNo ?? null,
      itemId: idByName.get(canonicalItemName(i.item))!,
      batchNo: i.batchNo ?? null,
      expiry: i.expiry ?? null,
      supplier: i.supplier ?? null,
      manufacturer: i.manufacturer ?? null,
      qty: i.qty,
      freeQty: i.freeQty,
      amount: i.amount,
      taxable: i.taxable ?? null,
      tax: i.tax ?? null,
      cost: i.cost ?? null,
      fingerprint: itemFingerprint(i),
      importBatchId: batchId,
      createdById: actor.id,
    }));
    for (let i = 0; i < rows.length; i += 2000) await tx.pharmacyItemLine.createMany({ data: rows.slice(i, i + 2000) });
    return { ids, newMasters };
  },
};

const paymentSpec: SideSpec<SupplierPaymentInput> = {
  type: "supplier-payments",
  normalize: normalizePaymentRow,
  fingerprint: paymentFingerprint,
  findExisting: (fps) => prisma.supplierPayment.findMany({ where: { fingerprint: { in: fps }, status: "ACTIVE" }, select: { id: true, fingerprint: true } }),
  amountOf: (i) => i.amount,
  async insert(tx, actor, batchId, inputs) {
    const ids = inputs.map(() => randomUUID());
    await tx.supplierPayment.createMany({
      data: inputs.map((i, n) => ({
        id: ids[n],
        date: new Date(`${i.date}T00:00:00.000Z`),
        supplier: i.supplier,
        reference: i.reference ?? null,
        invoiceRefs: i.invoiceRefs,
        details: i.details ?? null,
        amount: i.amount,
        fingerprint: paymentFingerprint(i),
        importBatchId: batchId,
        createdById: actor.id,
      })),
    });
    return { ids, newMasters: 0 };
  },
};

const SIDE_SPECS: Partial<Record<ImportType, SideSpec<any>>> = { "pharmacy-items": itemSpec, "supplier-payments": paymentSpec };

async function validateSideBatch<I>(spec: SideSpec<I>, batchId: string, mapping: Mapping) {
  const records = await prisma.importRecord.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } });
  const today = todayISO();
  const results = records.map((rec) => {
    const n = spec.normalize(rec.raw as Record<string, unknown>, mapping, today);
    return { rec, n, fingerprint: n.input ? spec.fingerprint(n.input) : null };
  });
  const fps = [...new Set(results.map((r) => r.fingerprint).filter(Boolean) as string[])];
  const existing = new Map<string, string>();
  for (let i = 0; i < fps.length; i += 5000) for (const h of await spec.findExisting(fps.slice(i, i + 5000))) existing.set(h.fingerprint, h.id);
  const seen = new Map<string, number>();
  const outcomes: RowOutcome[] = results.map(({ rec, n, fingerprint }) => {
    let status: ImportRowStatus = n.errors.length ? "INVALID" : n.warnings.length ? "WARNING" : "VALID";
    let duplicateOf: string | null = null;
    if (fingerprint && status !== "INVALID") {
      const inDb = existing.get(fingerprint);
      const inFile = seen.get(fingerprint);
      if (inDb) {
        status = "DUPLICATE";
        duplicateOf = `${spec.type}:${inDb}`;
      } else if (inFile !== undefined) {
        status = "DUPLICATE";
        duplicateOf = `row:${inFile}`;
      } else seen.set(fingerprint, rec.rowNumber);
    }
    return { status, normalized: n.input ? { module: spec.type, input: n.input, amount: n.amount, flags: [] } : { flags: [] }, errors: n.errors, warnings: n.warnings, fingerprint, duplicateOf };
  });
  const summary = summarize(outcomes);
  summary.byModule = {};
  await prisma.$transaction(async (tx) => {
    await tx.importRecord.deleteMany({ where: { batchId } });
    for (let i = 0; i < records.length; i += 2000) {
      await tx.importRecord.createMany({
        data: records.slice(i, i + 2000).map((rec, j) => {
          const o = outcomes[i + j];
          return {
            batchId,
            rowNumber: rec.rowNumber,
            raw: rec.raw as Prisma.InputJsonValue,
            normalized: o.normalized,
            status: o.status,
            errors: o.errors.length ? o.errors : undefined,
            warnings: o.warnings.length ? o.warnings : undefined,
            fingerprint: o.fingerprint,
            duplicateOf: o.duplicateOf,
            forceImport: false,
          };
        }),
      });
    }
    await tx.importBatch.update({
      where: { id: batchId },
      data: { module: spec.type, mapping, status: "VALIDATED", validatedAt: new Date(), validRows: summary.valid, warningRows: summary.warnings, invalidRows: summary.invalid, duplicateRows: summary.duplicates, totalAmount: summary.validAmount },
    });
  }, LONG_TX);
  return { batchId, type: spec.type, summary };
}

async function commitSideBatch<I>(spec: SideSpec<I>, actor: Actor, batch: { id: string; fileName: string; sheetName: string | null; options: Prisma.JsonValue }, opts: z.infer<typeof commitInput>) {
  const records = await prisma.importRecord.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: "asc" } });
  if ((opts.duplicatePolicy === "import" || records.some((r) => r.status === "DUPLICATE" && r.forceImport)) && !can(actor, "import.override_duplicates")) {
    throw new AppError(403, "Only an Admin can import duplicate rows", "FORBIDDEN");
  }
  const toImport = records.filter(
    (r) => r.status === "VALID" || (r.status === "WARNING" && opts.approveWarnings) || (r.status === "DUPLICATE" && (r.forceImport || opts.duplicatePolicy === "import")),
  );
  if (!toImport.length) throw badRequest("Nothing to import. Approve warnings or fix errors and re-upload.");
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.importBatch.updateMany({ where: { id: batch.id, status: "VALIDATED" }, data: { status: "IMPORTED", committedAt: new Date() } });
    if (!claimed.count) throw conflict("This batch is already being imported");
    const inputs = toImport.map((r) => (r.normalized as any).input as I);
    const { ids, newMasters } = await spec.insert(tx, actor, batch.id, inputs);
    const imported = ids.length;
    const amount = round2(inputs.reduce((a, i) => a + spec.amountOf(i), 0));
    const idByRecord = new Map(toImport.map((r, n) => [r.id, ids[n]]));
    await tx.importRecord.deleteMany({ where: { batchId: batch.id } });
    for (let i = 0; i < records.length; i += 2000) {
      await tx.importRecord.createMany({
        data: records.slice(i, i + 2000).map((r) => ({
          id: r.id,
          batchId: batch.id,
          rowNumber: r.rowNumber,
          raw: r.raw as Prisma.InputJsonValue,
          normalized: (r.normalized ?? undefined) as Prisma.InputJsonValue | undefined,
          status: idByRecord.has(r.id) ? ("IMPORTED" as ImportRowStatus) : r.status === "INVALID" ? r.status : ("SKIPPED" as ImportRowStatus),
          errors: (r.errors ?? undefined) as Prisma.InputJsonValue | undefined,
          warnings: (r.warnings ?? undefined) as Prisma.InputJsonValue | undefined,
          fingerprint: r.fingerprint,
          duplicateOf: r.duplicateOf,
          forceImport: r.forceImport,
          entityIds: idByRecord.has(r.id) ? [idByRecord.get(r.id)!] : undefined,
        })),
      });
    }
    const updated = await tx.importBatch.update({
      where: { id: batch.id },
      data: { imported, rejected: records.length - imported, totalAmount: amount, options: { ...((batch.options as Record<string, unknown> | null) ?? {}), ...opts } },
    });
    await audit(tx, actor, { action: "IMPORT_COMMIT", entityType: "ImportBatch", entityId: batch.id, after: { fileName: batch.fileName, sheet: batch.sheetName, type: spec.type, found: records.length, imported, amount, newMasters } });
    return { batch: { ...updated, totalAmount: toNum(updated.totalAmount) }, imported, rejected: records.length - imported, amount, newMasters };
  }, LONG_TX);
}

// ─────────────────────────── review ───────────────────────────

export async function getBatch(actor: Actor, batchId: string) {
  requirePermission(actor, "import.run");
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound();
  const outcomes = await prisma.importRecord.findMany({ where: { batchId }, select: { status: true, errors: true, warnings: true, normalized: true } });
  const summary = summarize(outcomes.map((o) => ({ status: o.status, errors: (o.errors as string[]) ?? [], warnings: (o.warnings as string[]) ?? [], normalized: o.normalized })));
  const uploader = await prisma.user.findUnique({ where: { id: batch.uploadedById }, select: { name: true } });
  const fields = importFieldsFor(batch.module as ImportType);
  return {
    batch: { ...batch, totalAmount: toNum(batch.totalAmount), uploadedBy: uploader?.name ?? null },
    summary,
    fields,
    suggestion: batch.mapping ? null : suggestMapping(batch.headers as string[], fields),
  };
}

export async function listRows(actor: Actor, batchId: string, q: { status?: string; page?: string; pageSize?: string }) {
  requirePermission(actor, "import.run");
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Number(q.pageSize) || 50);
  const statuses = q.status ? (q.status.split(",") as ImportRowStatus[]) : undefined;
  const where = { batchId, ...(statuses ? { status: { in: statuses } } : {}) };
  const [rows, total] = await Promise.all([
    prisma.importRecord.findMany({ where, orderBy: { rowNumber: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.importRecord.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

/** Admin decision on duplicate rows: import anyway (true) or skip (false). */
export async function setDuplicateDecision(actor: Actor, batchId: string, raw: unknown) {
  requirePermission(actor, "import.override_duplicates");
  const { rowIds, forceImport } = z.object({ rowIds: z.array(z.string()).min(1).max(5000), forceImport: z.boolean() }).parse(raw);
  const r = await prisma.importRecord.updateMany({ where: { batchId, id: { in: rowIds }, status: "DUPLICATE" }, data: { forceImport } });
  return { updated: r.count };
}

// ─────────────────────────── commit ───────────────────────────

const commitInput = z.object({
  approveWarnings: z.boolean().default(false),
  duplicatePolicy: z.enum(["skip", "import"]).default("skip"),
});

/** Create any master rows referenced by placeholders; returns placeholder → real id. */
async function createNewMasters(tx: Tx, actor: Actor, placeholders: Set<string>) {
  const map = new Map<string, string>();
  let createdCount = 0;
  const ordered = [...placeholders].sort((a, b) => (a.includes("expenseSubcategories") ? 1 : 0) - (b.includes("expenseSubcategories") ? 1 : 0));
  for (const ph of ordered) {
    const p = parsePlaceholder(ph)!;
    const name = p.name;
    let created: { id: string };
    let isNew = false;
    const make = <T,>(p: Promise<T>) => {
      isNew = true;
      return p;
    };
    const find = async (model: any, extra: object = {}) => model.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...extra } });
    switch (p.type as NewMasterType) {
      case "specialties":
        created = (await find(tx.specialty)) ?? (await make(tx.specialty.create({ data: { name } })));
        break;
      case "doctors":
        created = (await find(tx.doctor, { kind: "DOCTOR" })) ?? (await make(tx.doctor.create({ data: { name, kind: "DOCTOR" } })));
        break;
      case "dieticians":
        created = (await find(tx.doctor, { kind: "DIETICIAN" })) ?? (await make(tx.doctor.create({ data: { name, kind: "DIETICIAN" } })));
        break;
      case "consultationTypes":
        created = (await find(tx.consultationType)) ?? (await make(tx.consultationType.create({ data: { name } })));
        break;
      case "admissionTypes":
        created = (await find(tx.admissionType)) ?? (await make(tx.admissionType.create({ data: { name } })));
        break;
      case "ipdPackages":
        created = (await find(tx.ipdPackage)) ?? (await make(tx.ipdPackage.create({ data: { name } })));
        break;
      case "investigations":
        // Rate 0: imported rows carry their own rate; Admin should set the master rate afterwards.
        created = (await find(tx.labInvestigation)) ?? (await make(tx.labInvestigation.create({ data: { name, category: classifyLabItem(name).category } })));
        break;
      case "dietServices":
        created = (await find(tx.dietService)) ?? (await make(tx.dietService.create({ data: { name } })));
        break;
      case "departments":
        created = (await find(tx.department)) ?? (await make(tx.department.create({ data: { name } })));
        break;
      case "expenseCategories":
        created =
          (await find(tx.expenseCategory, { parentId: null })) ??
          (await make(tx.expenseCategory.create({ data: { name, group: /^other/i.test(name) ? "OTHER" : "HOSPITAL" } })));
        break;
      case "expenseSubcategories": {
        const parentId = p.parent?.startsWith(NEW_PREFIX) ? map.get(p.parent) : p.parent;
        if (!parentId) throw badRequest(`Cannot resolve parent category for "${name}"`);
        const parent = await tx.expenseCategory.findUniqueOrThrow({ where: { id: parentId } });
        created = (await find(tx.expenseCategory, { parentId })) ?? (await make(tx.expenseCategory.create({ data: { name, parentId, group: parent.group } })));
        break;
      }
    }
    map.set(ph, created.id);
    if (!isNew) continue;
    createdCount++;
    await audit(tx, actor, { action: "MASTER_CREATE_BY_IMPORT", entityType: `Master:${p.type}`, entityId: created.id, after: { name } });
  }
  return { map, createdCount };
}

function collectPlaceholders(v: unknown, out: Set<string>) {
  if (typeof v === "string" && v.startsWith(NEW_PREFIX)) {
    out.add(v);
    const p = parsePlaceholder(v);
    if (p?.parent?.startsWith(NEW_PREFIX)) out.add(p.parent);
  } else if (v && typeof v === "object") for (const x of Object.values(v)) collectPlaceholders(x, out);
}

function replacePlaceholders<T>(v: T, map: Map<string, string>): T {
  if (typeof v === "string" && v.startsWith(NEW_PREFIX)) return (map.get(v) ?? v) as T;
  if (Array.isArray(v)) return v.map((x) => replacePlaceholders(x, map)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replacePlaceholders(x, map)])) as T;
  return v;
}

export async function commitBatch(actor: Actor, batchId: string, raw: unknown) {
  requirePermission(actor, "import.run");
  const opts = commitInput.parse(raw);
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound();
  if (batch.status !== "VALIDATED") throw badRequest(batch.status === "UPLOADED" ? "Validate the batch first" : `Batch is already ${batch.status.toLowerCase()}`);
  const side = SIDE_SPECS[batch.module as ImportType];
  if (side) return commitSideBatch(side, actor, batch, opts);
  const records = await prisma.importRecord.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } });
  const anyForced = records.some((r) => r.status === "DUPLICATE" && r.forceImport);
  if ((opts.duplicatePolicy === "import" || anyForced) && !can(actor, "import.override_duplicates")) {
    throw new AppError(403, "Only an Admin can import duplicate rows", "FORBIDDEN");
  }
  const importable = (r: (typeof records)[number]) =>
    r.status === "VALID" ||
    (r.status === "WARNING" && opts.approveWarnings) ||
    (r.status === "DUPLICATE" && (r.forceImport || opts.duplicatePolicy === "import") && (!(r.warnings as string[] | null)?.length || opts.approveWarnings));
  const toImport = records.filter(importable);
  if (!toImport.length) throw badRequest("Nothing to import. Approve warnings or fix errors and re-upload.");

  return prisma.$transaction(async (tx) => {
    // Claim the batch (guards against a double click / concurrent commit).
    const claimed = await tx.importBatch.updateMany({ where: { id: batchId, status: "VALIDATED" }, data: { status: "IMPORTED", committedAt: new Date() } });
    if (!claimed.count) throw conflict("This batch is already being imported");

    const placeholders = new Set<string>();
    for (const r of toImport) collectPlaceholders(r.normalized, placeholders);
    const { map: masterMap, createdCount } = await createNewMasters(tx, actor, placeholders);

    const outcome = new Map<string, { status: ImportRowStatus; entityIds?: string[]; errors?: string[] }>();
    const touchedDates = new Set<ISODate>();
    let imported = 0;
    let amount = 0;
    // One bulk query replaces a duplicate lookup per row; rows that became duplicates since validation are skipped.
    const existing = await findExistingFingerprints(toImport.filter((r) => r.status !== "DUPLICATE" && r.fingerprint).map((r) => r.fingerprint!));
    await withBulkCache(async () => {
      const bulk: { module: ModuleKey; data: Record<string, unknown> }[] = [];
      for (const r of toImport) {
        const norm = replacePlaceholders(r.normalized as any, masterMap);
        if (r.status !== "DUPLICATE" && r.fingerprint && existing.has(r.fingerprint)) {
          outcome.set(r.id, { status: "SKIPPED", errors: [...((r.errors as string[]) ?? []), "Possible duplicate: a matching record was added after validation"] });
          continue;
        }
        try {
          const main = await prepareRecord(tx, actor, norm.module, norm.input, batchId);
          const extras = await Promise.all((norm.extras ?? []).map((ex: { module: ModuleKey; input: unknown }) => prepareRecord(tx, actor, ex.module, ex.input, batchId)));
          let mainId = main.id;
          if (main.needsSingleInsert) {
            // e.g. IPD admission + initial payment: needs the created row, so insert it individually.
            mainId = (await insertRecord(tx, actor, norm.module, norm.input, { importBatchId: batchId, allowDuplicate: true, quietAudit: true })).id;
          } else bulk.push({ module: main.module, data: main.data });
          for (const e of extras) bulk.push({ module: e.module, data: e.data });
          touchedDates.add(main.date);
          imported++;
          amount = round2(amount + main.amount);
          outcome.set(r.id, { status: "IMPORTED", entityIds: [mainId, ...extras.map((e) => e.id)] });
        } catch (err) {
          // Application-level rejections (e.g. day closed) skip the row; any database error aborts the
          // whole import so nothing is half-imported.
          if (err instanceof AppError) outcome.set(r.id, { status: "SKIPPED", errors: [...((r.errors as string[]) ?? []), err.message] });
          else throw err;
        }
      }
      await bulkInsertPrepared(tx, bulk);
    });
    // Rewrite the staging rows in bulk (one delete + chunked inserts instead of one UPDATE per row).
    await tx.importRecord.deleteMany({ where: { batchId } });
    const rewritten = records.map((r) => {
      const o = outcome.get(r.id);
      return {
        id: r.id,
        batchId,
        rowNumber: r.rowNumber,
        raw: r.raw as Prisma.InputJsonValue,
        normalized: (r.normalized ?? undefined) as Prisma.InputJsonValue | undefined,
        status: o ? o.status : r.status === "INVALID" ? r.status : ("SKIPPED" as ImportRowStatus),
        errors: ((o?.errors ?? r.errors) ?? undefined) as Prisma.InputJsonValue | undefined,
        warnings: (r.warnings ?? undefined) as Prisma.InputJsonValue | undefined,
        fingerprint: r.fingerprint,
        duplicateOf: r.duplicateOf,
        forceImport: r.forceImport,
        entityIds: (o?.entityIds ?? undefined) as Prisma.InputJsonValue | undefined,
      };
    });
    for (let i = 0; i < rewritten.length; i += 1000) await tx.importRecord.createMany({ data: rewritten.slice(i, i + 1000) });
    const rejected = records.length - imported;
    const updated = await tx.importBatch.update({
      where: { id: batchId },
      data: { imported, rejected, totalAmount: amount, options: { ...((batch.options as Record<string, unknown> | null) ?? {}), ...opts } },
    });
    for (const d of touchedDates) await onDayMutated(tx, actor, d, `Import ${batch.fileName}`);
    await audit(tx, actor, {
      action: "IMPORT_COMMIT",
      entityType: "ImportBatch",
      entityId: batchId,
      after: { fileName: batch.fileName, sheet: batch.sheetName, type: batch.module, found: records.length, imported, rejected, amount, options: opts, newMasters: [...masterMap.keys()].map((k) => parsePlaceholder(k)) },
    });
    return { batch: { ...updated, totalAmount: toNum(updated.totalAmount) }, imported, rejected, amount, newMasters: createdCount };
  }, LONG_TX);
}

export async function cancelBatch(actor: Actor, batchId: string) {
  requirePermission(actor, "import.run");
  const b = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!b) throw notFound();
  if (!["UPLOADED", "VALIDATED"].includes(b.status)) throw badRequest("Only un-imported batches can be cancelled");
  await prisma.$transaction(async (tx) => {
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "CANCELLED" } });
    await tx.importRecord.deleteMany({ where: { batchId } }); // staging rows only; nothing was imported
    await audit(tx, actor, { action: "IMPORT_CANCEL", entityType: "ImportBatch", entityId: batchId });
  });
  return { ok: true };
}

// ─────────────────────────── reverse ───────────────────────────

const IMPORT_TABLES = ["consultation", "ipdTransaction", "ipdAdmission", "labTransaction", "pharmacySale", "pharmacyReturn", "pharmacyPurchase", "dietTransaction", "otherIncome", "expense", "pharmacyItemLine", "supplierPayment"] as const;

export async function reverseBatch(actor: Actor, batchId: string, raw: unknown) {
  requirePermission(actor, "import.reverse");
  const { reason } = z.object({ reason: z.string().trim().min(5, "Give a reason (min 5 characters)").max(500) }).parse(raw);
  return prisma.$transaction(async (tx) => {
    const b = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!b) throw notFound();
    if (b.status !== "IMPORTED") throw badRequest("Only imported batches can be reversed");
    // Dates touched by the batch must not be closed.
    const dateRows = await tx.$queryRaw<{ date: Date }[]>`
      SELECT DISTINCT date FROM (
        SELECT date FROM "Consultation" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT "admissionDate" FROM "IpdAdmission" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT date FROM "IpdTransaction" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT date FROM "LabTransaction" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT date FROM "PharmacySale" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT date FROM "PharmacyReturn" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT date FROM "PharmacyPurchase" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT date FROM "DietTransaction" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT date FROM "OtherIncome" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
        UNION SELECT date FROM "Expense" WHERE "importBatchId" = ${batchId} AND status = 'ACTIVE'
      ) d`;
    const dates = dateRows.map((d) => fromDbDate(d.date));
    const statuses = await getDayStatuses(tx, dates);
    const closed = dates.filter((d) => statuses.get(d) === "CLOSED");
    if (closed.length) throw badRequest(`Reopen these closed days first: ${closed.slice(0, 10).join(", ")}${closed.length > 10 ? "…" : ""}`);
    // Admission payments recorded later (not part of this batch) would be orphaned.
    const foreignPayments = await tx.ipdTransaction.count({ where: { status: "ACTIVE", importBatchId: { not: batchId }, admission: { importBatchId: batchId } } });
    if (foreignPayments) throw badRequest(`${foreignPayments} payment(s) were recorded later against admissions from this batch. Void them first.`);
    const counts: Record<string, number> = {};
    for (const t of IMPORT_TABLES) {
      const r = await (tx as any)[t].updateMany({ where: { importBatchId: batchId, status: "ACTIVE" }, data: { status: "REVERSED" } });
      counts[t] = r.count;
    }
    // Rows that were corrected after import live on as their (non-batch) corrected versions.
    let corrected = 0;
    for (const t of IMPORT_TABLES) corrected += await (tx as any)[t].count({ where: { importBatchId: batchId, status: "SUPERSEDED" } });
    await tx.importRecord.updateMany({ where: { batchId, status: "IMPORTED" }, data: { status: "REVERSED" } });
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: actor.id, reverseReason: reason } });
    for (const d of dates) await onDayMutated(tx, actor, d, `Import batch ${b.fileName} reversed`);
    await audit(tx, actor, { action: "IMPORT_REVERSE", entityType: "ImportBatch", entityId: batchId, before: { status: "IMPORTED" }, after: { status: "REVERSED", counts }, reason });
    return { reversed: Object.values(counts).reduce((a, b) => a + b, 0), counts, correctedRowsNotReversed: corrected };
  }, LONG_TX);
}

// ─────────────────────────── history & error file ───────────────────────────

export async function importHistory(actor: Actor, q: { page?: string }) {
  requirePermission(actor, "import.run");
  const page = Math.max(1, Number(q.page) || 1);
  const [rows, total] = await Promise.all([
    prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.importBatch.count(),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.uploadedById, r.reversedById].filter(Boolean) as string[]))] } }, select: { id: true, name: true } });
  return {
    total,
    page,
    rows: rows.map((r) => ({
      ...r,
      headers: undefined,
      mapping: undefined,
      totalAmount: toNum(r.totalAmount),
      typeLabel: IMPORT_TYPES.find((t) => t.key === r.module)?.label ?? r.module,
      uploadedBy: users.find((u) => u.id === r.uploadedById)?.name ?? "—",
      reversedBy: users.find((u) => u.id === r.reversedById)?.name ?? null,
    })),
  };
}

export async function errorWorkbook(actor: Actor, batchId: string): Promise<Buffer> {
  requirePermission(actor, "import.run");
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound();
  const rows = await prisma.importRecord.findMany({
    where: { batchId, status: { in: ["INVALID", "DUPLICATE", "WARNING", "SKIPPED"] } },
    orderBy: { rowNumber: "asc" },
  });
  const headers = batch.headers as string[];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rows to fix");
  ws.addRow(["Excel Row", "Status", "Errors", "Warnings", "Duplicate Of", ...headers]);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const raw = r.raw as Record<string, unknown>;
    ws.addRow([
      r.rowNumber,
      r.status,
      ((r.errors as string[]) ?? []).join("; "),
      ((r.warnings as string[]) ?? []).join("; "),
      r.duplicateOf ?? "",
      ...headers.map((h) => (raw[h] as string | number | null) ?? ""),
    ]);
  }
  ws.columns.forEach((c, i) => (c.width = i < 5 ? [10, 12, 50, 40, 22][i] : 16));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
