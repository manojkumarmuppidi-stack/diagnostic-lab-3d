/** Search, attachments, users & roles, audit log. */
import { formatNumber } from "@/lib/money";
import { z } from "zod";
import { can, requirePermission, requireAnyPermission, type Actor } from "../authz";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { hashPasswordSync } from "../password";
import { getFile, putFile } from "../storage";
import { fromDbDate } from "@/lib/dates";
import { maskName, ALL_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";
import { toNum } from "@/lib/money";
import { assertDayWritable } from "../closing";

// ─────────────────────────── search ───────────────────────────

export async function globalSearch(actor: Actor, qRaw: string) {
  requirePermission(actor, "search.use");
  const q = qRaw.trim();
  if (q.length < 2) return { results: [] };
  const ci = { contains: q, mode: "insensitive" as const };
  const mask = !can(actor, "patients.view_identity");
  const nm = (n: string | null) => (mask ? maskName(n) : n);
  const results: { type: string; title: string; subtitle: string; href: string; amount?: number; date?: string }[] = [];
  const take = 8;

  const jobs: Promise<void>[] = [];
  if (actor.permissions.size) {
    jobs.push(
      prisma.patient.findMany({ where: { OR: [{ patientCode: ci }, { name: ci }] }, take }).then((ps) => {
        for (const p of ps) results.push({ type: "Patient", title: `${nm(p.name)} (${p.patientCode})`, subtitle: "Patient", href: `/search?patient=${encodeURIComponent(p.patientCode)}&q=${encodeURIComponent(p.patientCode)}` });
      }),
    );
  }
  if (can(actor, "opd.view"))
    jobs.push(
      prisma.consultation.findMany({ where: { status: "ACTIVE", OR: [{ patientName: ci }, { reference: ci }, { patient: { patientCode: ci } }] }, include: { specialty: true }, take, orderBy: { date: "desc" } }).then((xs) => {
        for (const x of xs) results.push({ type: "OPD", title: `${nm(x.patientName) ?? "—"} · ${x.specialty?.name ?? ""}`, subtitle: x.reference ?? x.visitType, href: `/opd?q=${encodeURIComponent(q)}`, amount: toNum(x.netAmount), date: fromDbDate(x.date) });
      }),
    );
  if (can(actor, "ipd.view"))
    jobs.push(
      prisma.ipdAdmission.findMany({ where: { status: "ACTIVE", OR: [{ patientName: ci }, { reference: ci }, { patient: { patientCode: ci } }] }, include: { admissionType: true }, take, orderBy: { admissionDate: "desc" } }).then((xs) => {
        for (const x of xs) results.push({ type: "Admission", title: `${nm(x.patientName) ?? "—"} · ${x.admissionType.name}`, subtitle: x.reference ?? "IPD admission", href: `/ipd?q=${encodeURIComponent(q)}`, amount: toNum(x.netAmount), date: fromDbDate(x.admissionDate) });
      }),
    );
  if (can(actor, "lab.view")) {
    jobs.push(
      prisma.labTransaction.findMany({ where: { status: "ACTIVE", OR: [{ patientName: ci }, { reference: ci }, { patient: { patientCode: ci } }, { investigation: { name: ci } }] }, include: { investigation: true }, take, orderBy: { date: "desc" } }).then((xs) => {
        for (const x of xs) results.push({ type: "Lab", title: `${x.investigation.name} · ${nm(x.patientName) ?? "—"}`, subtitle: x.reference ?? `Qty ${x.quantity}`, href: `/lab?q=${encodeURIComponent(q)}`, amount: toNum(x.netAmount), date: fromDbDate(x.date) });
      }),
      prisma.labInvestigation.findMany({ where: { OR: [{ name: ci }, { code: ci }] }, take }).then((xs) => {
        for (const x of xs) results.push({ type: "Investigation", title: x.name, subtitle: `${x.category} · rate ${toNum(x.rate)}`, href: `/lab?investigationId=${x.id}` });
      }),
    );
  }
  // Products and tests → their counts in Analytics ("how many Fiasp / ECG …").
  if (can(actor, "analytics.view")) {
    jobs.push(
      prisma.$queryRaw<{ name: string; units: bigint | null; variants: bigint }[]>`
        SELECT MIN(i.name) AS name, SUM(l.qty) FILTER (WHERE l.date >= CURRENT_DATE - 30) AS units, COUNT(DISTINCT i.id) AS variants
          FROM "PharmacyItem" i LEFT JOIN "PharmacyItemLine" l ON l."itemId" = i.id AND l.kind = 'SALE' AND l.status = 'ACTIVE'
         WHERE i.name ILIKE ${`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}
         GROUP BY i.id ORDER BY 2 DESC NULLS LAST LIMIT ${take}`.then((xs) => {
        for (const x of xs)
          results.push({ type: "Medicine", title: x.name, subtitle: `${formatNumber(Number(x.units ?? 0))} units sold in the last 30 days · see units per week/month`, href: `/analytics?tab=pharmacy&medicine=${encodeURIComponent(x.name)}` });
      }),
      prisma.labInvestigation.findMany({ where: { OR: [{ name: ci }, { code: ci }] }, take: 5 }).then((xs) => {
        for (const x of xs) results.push({ type: "Test counts", title: x.name, subtitle: `${x.category} · how many were done per week/month`, href: `/analytics?tab=lab&investigationId=${x.id}` });
      }),
    );
  }
  if (can(actor, "pharmacy.view"))
    jobs.push(
      prisma.pharmacySale.findMany({ where: { status: "ACTIVE", OR: [{ invoiceNo: ci }, { patientName: ci }] }, take, orderBy: { date: "desc" } }).then((xs) => {
        for (const x of xs) results.push({ type: "Pharmacy Invoice", title: x.invoiceNo ?? "(no invoice)", subtitle: nm(x.patientName) ?? "", href: `/pharmacy?q=${encodeURIComponent(q)}`, amount: toNum(x.netAmount), date: fromDbDate(x.date) });
      }),
      prisma.pharmacyPurchase.findMany({ where: { status: "ACTIVE", OR: [{ invoiceNo: ci }, { supplier: ci }] }, take, orderBy: { date: "desc" } }).then((xs) => {
        for (const x of xs) results.push({ type: "Purchase", title: `${x.supplier} ${x.invoiceNo ?? ""}`, subtitle: "Pharmacy purchase", href: `/pharmacy?tab=purchases&q=${encodeURIComponent(q)}`, amount: toNum(x.amount), date: fromDbDate(x.date) });
      }),
    );
  if (can(actor, "expense.view"))
    jobs.push(
      prisma.expense.findMany({ where: { status: "ACTIVE", ...(can(actor, "expense.view_all") ? {} : { createdById: actor.id }), OR: [{ description: ci }, { vendor: ci }, { billNumber: ci }] }, include: { category: true }, take, orderBy: { date: "desc" } }).then((xs) => {
        for (const x of xs) results.push({ type: "Expense", title: x.description, subtitle: `${x.category.name}${x.vendor ? ` · ${x.vendor}` : ""}${x.billNumber ? ` · ${x.billNumber}` : ""}`, href: `/expenses?q=${encodeURIComponent(q)}`, amount: toNum(x.amount), date: fromDbDate(x.date) });
      }),
    );
  if (can(actor, "diet.view"))
    jobs.push(
      prisma.dietTransaction.findMany({ where: { status: "ACTIVE", OR: [{ patientName: ci }, { reference: ci }, { patient: { patientCode: ci } }] }, include: { service: true }, take, orderBy: { date: "desc" } }).then((xs) => {
        for (const x of xs) results.push({ type: "Diet", title: `${nm(x.patientName) ?? "—"} · ${x.service?.name ?? ""}`, subtitle: x.reference ?? "", href: `/diet?q=${encodeURIComponent(q)}`, amount: toNum(x.netAmount), date: fromDbDate(x.date) });
      }),
    );
  await Promise.all(jobs);
  return { results };
}

// ─────────────────────────── attachments ───────────────────────────

export async function addAttachment(actor: Actor, expenseId: string, fileName: string, buf: Buffer) {
  requirePermission(actor, "expense.write");
  const exp = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!exp || (exp.status !== "ACTIVE" && exp.status !== "PENDING")) throw notFound("Expense not found");
  await assertDayWritable(prisma, fromDbDate(exp.date));
  const count = await prisma.attachment.count({ where: { expenseId } });
  if (count >= 10) throw badRequest("Maximum 10 attachments per expense");
  const stored = await putFile(buf);
  return prisma.$transaction(async (tx) => {
    const a = await tx.attachment.create({
      data: { expenseId, fileName: fileName.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || "bill", ...stored, uploadedById: actor.id },
    });
    await audit(tx, actor, { action: "ATTACHMENT_ADD", entityType: "Expense", entityId: expenseId, after: { attachmentId: a.id, fileName: a.fileName, sha256: a.sha256 } });
    return a;
  });
}

/** Staff without expense.view_all may only open bills of expenses they entered. */
async function assertCanSeeExpense(actor: Actor, expenseId: string) {
  requirePermission(actor, "expense.view");
  if (can(actor, "expense.view_all")) return;
  const e = await prisma.expense.findUnique({ where: { id: expenseId }, select: { createdById: true } });
  if (!e || e.createdById !== actor.id) throw notFound();
}

export async function listAttachments(actor: Actor, expenseId: string) {
  await assertCanSeeExpense(actor, expenseId);
  return prisma.attachment.findMany({ where: { expenseId }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true } });
}

export async function readAttachment(actor: Actor, id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a?.expenseId) throw notFound();
  await assertCanSeeExpense(actor, a.expenseId);
  return { meta: a, data: await getFile(a.storageKey) };
}

// ─────────────────────────── users & roles ───────────────────────────

const userCreate = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "3–40 characters: letters, digits, . _ -"),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || null),
  roleId: z.string().min(1),
  password: z.string().min(8, "At least 8 characters").regex(/[A-Za-z]/, "Must contain a letter").regex(/\d/, "Must contain a digit"),
});
const userUpdate = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || null),
  roleId: z.string().min(1).optional(),
  active: z.boolean().optional(),
  resetPassword: z.string().min(8).regex(/[A-Za-z]/).regex(/\d/).optional(),
});

const userSelect = { id: true, username: true, name: true, email: true, active: true, mustChangePassword: true, lastLoginAt: true, createdAt: true, role: { select: { id: true, code: true, name: true } } };

export async function listUsers(actor: Actor) {
  requirePermission(actor, "users.manage");
  return prisma.user.findMany({ select: userSelect, orderBy: { name: "asc" } });
}

export async function createUser(actor: Actor, raw: unknown) {
  requirePermission(actor, "users.manage");
  const d = userCreate.parse(raw);
  if (await prisma.user.findUnique({ where: { username: d.username } })) throw conflict("Username already taken");
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { username: d.username, name: d.name, email: d.email, roleId: d.roleId, passwordHash: hashPasswordSync(d.password), mustChangePassword: true },
      select: userSelect,
    });
    await audit(tx, actor, { action: "USER_CREATE", entityType: "User", entityId: u.id, after: u });
    return u;
  });
}

export async function updateUser(actor: Actor, id: string, raw: unknown) {
  requirePermission(actor, "users.manage");
  const d = userUpdate.parse(raw);
  if (id === actor.id && (d.active === false || d.roleId)) throw forbidden("You cannot deactivate yourself or change your own role");
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: userSelect });
    if (!before) throw notFound();
    if (before.role.code === "ADMIN" && (d.active === false || (d.roleId && d.roleId !== before.role.id))) {
      const admins = await tx.user.count({ where: { active: true, role: { code: "ADMIN" } } });
      if (admins <= 1) throw badRequest("At least one active Admin is required");
    }
    const u = await tx.user.update({
      where: { id },
      data: {
        name: d.name,
        email: d.email,
        roleId: d.roleId,
        active: d.active,
        ...(d.resetPassword ? { passwordHash: hashPasswordSync(d.resetPassword), mustChangePassword: true } : {}),
      },
      select: userSelect,
    });
    if (d.active === false || d.resetPassword || d.roleId) await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, actor, { action: d.resetPassword ? "USER_PASSWORD_RESET" : "USER_UPDATE", entityType: "User", entityId: id, before, after: u });
    return u;
  });
}

export async function listRoles(actor: Actor) {
  requireAnyPermission(actor, "users.manage");
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { name: "asc" } });
  return {
    catalogue: ALL_PERMISSIONS.map((c) => ({ code: c, ...PERMISSIONS[c] })),
    roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem, users: r._count.users, permissions: r.permissions.map((p) => p.permission.code) })),
  };
}

export async function setRolePermissions(actor: Actor, roleId: string, raw: unknown) {
  requirePermission(actor, "users.manage");
  const { permissions } = z.object({ permissions: z.array(z.string()) }).parse(raw);
  const invalid = permissions.filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
  if (invalid.length) throw badRequest(`Unknown permissions: ${invalid.join(", ")}`);
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw notFound();
    if (role.code === "ADMIN" && !permissions.includes("users.manage")) throw badRequest("The Admin role must keep users.manage");
    const perms = await tx.permission.findMany({ where: { code: { in: permissions } } });
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
    await audit(tx, actor, { action: "ROLE_PERMISSIONS", entityType: "Role", entityId: roleId, before: role.permissions.map((p) => p.permission.code), after: permissions });
    return { ok: true };
  });
}

// ─────────────────────────── audit log ───────────────────────────

export async function queryAudit(actor: Actor, q: Record<string, string | undefined>) {
  requirePermission(actor, "audit.view");
  const page = Math.max(1, Number(q.page) || 1);
  const where = {
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.action ? { action: { contains: q.action, mode: "insensitive" as const } } : {}),
    ...(q.user ? { userName: { contains: q.user, mode: "insensitive" as const } } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999+05:30`) } : {}) } } : {}),
  };
  const [rows, total, types] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } }),
  ]);
  return { rows, total, page, pageSize: 50, entityTypes: types.map((t) => t.entityType).sort() };
}
