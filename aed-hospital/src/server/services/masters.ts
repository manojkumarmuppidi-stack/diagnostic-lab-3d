/**
 * Master data: doctors, departments, specialties, consultation types, IPD admission
 * types & packages, lab investigations, diet services, expense categories, payment modes.
 * Masters are never deleted — they are deactivated — so historical rows keep their labels.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { toNum } from "@/lib/money";
import { audit } from "../audit";
import { requirePermission, type Actor } from "../authz";
import { prisma, type Tx } from "../db";
import { badRequest, conflict, notFound } from "../errors";

const name = z.string().trim().min(1, "Required").max(120);
const money = z.coerce.number().min(0).max(99_99_99_999);
const optId = z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional());
const active = z.boolean().optional();

export const MASTER_TYPES = {
  departments: {
    label: "Departments",
    model: (tx: Tx) => tx.department,
    schema: z.object({ name, code: z.string().trim().max(20).nullable().optional(), active }),
    orderBy: { name: "asc" },
  },
  specialties: {
    label: "Specialties",
    model: (tx: Tx) => tx.specialty,
    schema: z.object({ name, sortOrder: z.coerce.number().int().optional(), active }),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  },
  doctors: {
    label: "Doctors & Dieticians",
    model: (tx: Tx) => tx.doctor,
    schema: z.object({ name, kind: z.enum(["DOCTOR", "DIETICIAN", "OTHER"]).default("DOCTOR"), specialtyId: optId, departmentId: optId, active }),
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: { specialty: true, department: true },
  },
  consultationTypes: {
    label: "Consultation Types",
    model: (tx: Tx) => tx.consultationType,
    schema: z.object({ name, defaultRate: money, active }),
    orderBy: { name: "asc" },
  },
  admissionTypes: {
    label: "IPD Admission Types",
    model: (tx: Tx) => tx.admissionType,
    schema: z.object({ name, active }),
    orderBy: { name: "asc" },
  },
  ipdPackages: {
    label: "IPD Packages",
    model: (tx: Tx) => tx.ipdPackage,
    schema: z.object({ name, admissionTypeId: optId, rate: money, active }),
    orderBy: { name: "asc" },
    include: { admissionType: true },
  },
  investigations: {
    label: "Lab Investigations",
    model: (tx: Tx) => tx.labInvestigation,
    schema: z.object({ name, code: z.string().trim().max(20).nullable().optional(), category: z.string().trim().min(1).max(60), rate: money, departmentId: optId, active }),
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: { department: true },
  },
  dietServices: {
    label: "Diet Services",
    model: (tx: Tx) => tx.dietService,
    schema: z.object({ name, rate: money, active }),
    orderBy: { name: "asc" },
  },
  expenseCategories: {
    label: "Expense Categories",
    model: (tx: Tx) => tx.expenseCategory,
    schema: z.object({ name, group: z.enum(["HOSPITAL", "OTHER"]).default("HOSPITAL"), parentId: optId, active }),
    orderBy: [{ parentId: "asc" }, { name: "asc" }],
    include: { parent: true },
  },
  paymentModes: {
    label: "Payment Modes",
    model: (tx: Tx) => tx.paymentMode,
    schema: z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "2–20 letters/digits/underscore"),
      name,
      reconGroup: z.enum(["CASH", "CARD", "UPI", "BANK", "OTHER"]),
      sortOrder: z.coerce.number().int().optional(),
      active,
    }),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  },
} as const;

export type MasterType = keyof typeof MASTER_TYPES;
export const isMasterType = (s: string): s is MasterType => s in MASTER_TYPES;

function serialize(r: any) {
  const out: Record<string, unknown> = { ...r };
  for (const k of ["rate", "defaultRate"]) if (k in out) out[k] = toNum(out[k] as any);
  for (const k of ["specialty", "department", "admissionType", "parent"]) {
    if (k in out) out[`${k}Name`] = (out[k] as any)?.name ?? null;
    delete out[k];
  }
  return out;
}

/** Every master list in one call (entry forms and filters). */
export async function getAllMasters() {
  const entries = await Promise.all(
    (Object.keys(MASTER_TYPES) as MasterType[]).map(async (k) => {
      const def: any = MASTER_TYPES[k];
      const rows = await def.model(prisma).findMany({ orderBy: def.orderBy, include: def.include });
      return [k, rows.map(serialize)] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<MasterType, any[]>;
}

export async function listMaster(type: MasterType) {
  const def: any = MASTER_TYPES[type];
  const rows = await def.model(prisma).findMany({ orderBy: def.orderBy, include: def.include });
  return rows.map(serialize);
}

async function validateRefs(tx: Tx, type: MasterType, data: any, id?: string) {
  if (type === "expenseCategories" && data.parentId) {
    const parent = await tx.expenseCategory.findUnique({ where: { id: data.parentId } });
    if (!parent) throw badRequest("Parent category not found");
    if (parent.parentId) throw badRequest("Only two levels are allowed (category → subcategory)");
    if (id && data.parentId === id) throw badRequest("A category cannot be its own parent");
    data.group = parent.group; // subcategories inherit the accounting group
  }
  if (type === "expenseCategories") {
    // NULL parentId is not unique in PostgreSQL; enforce top-level uniqueness here.
    const clash = await tx.expenseCategory.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" }, parentId: data.parentId ?? null, ...(id ? { id: { not: id } } : {}) },
    });
    if (clash) throw conflict(`"${data.name}" already exists here`);
  }
}

export async function createMaster(actor: Actor, type: MasterType, raw: unknown) {
  requirePermission(actor, "masters.manage");
  const def: any = MASTER_TYPES[type];
  const data = def.schema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await validateRefs(tx, type, data);
    const created = await def.model(tx).create({ data });
    await audit(tx, actor, { action: "MASTER_CREATE", entityType: `Master:${type}`, entityId: created.id, after: created });
    return serialize(created);
  });
}

export async function updateMaster(actor: Actor, type: MasterType, id: string, raw: unknown) {
  requirePermission(actor, "masters.manage");
  const def: any = MASTER_TYPES[type];
  const data = def.schema.partial().parse(raw);
  return prisma.$transaction(async (tx) => {
    const before = await def.model(tx).findUnique({ where: { id } });
    if (!before) throw notFound();
    await validateRefs(tx, type, { ...before, ...data }, id);
    if (type === "expenseCategories" && data.group && !before.parentId) {
      // Changing a category's group re-classifies its history; cascade to subcategories.
      await tx.expenseCategory.updateMany({ where: { parentId: id }, data: { group: data.group } });
    }
    const updated = await def.model(tx).update({ where: { id }, data });
    await audit(tx, actor, { action: "MASTER_UPDATE", entityType: `Master:${type}`, entityId: id, before, after: updated });
    return serialize(updated);
  });
}
