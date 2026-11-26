import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { audit } from "../audit";
import { hashPasswordSync } from "../password";
import { requirePermission, type Actor } from "../authz";
import { notFound } from "../errors";

/**
 * Read-only access key: lets a tool (e.g. Claude helping with the accounts) read the app over the API
 * without anyone's password. It belongs to a separate login with the "Read-only reviewer" role, works
 * only as "Authorization: Bearer <key>", only for GET requests, and expires on its own. Creating a new
 * key or revoking cancels the old one. Patient names stay hidden (the role has no identity permission).
 */
export const KEY_USER = "readonly-key";
// Same hashing as sign-in sessions (auth.ts), kept here so this service has no Next.js imports.
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const DAYS = 30;

export async function accessKeyStatus(actor: Actor) {
  requirePermission(actor, "users.manage");
  const key = await prisma.session.findFirst({ where: { kind: "KEY", user: { username: KEY_USER }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  return key ? { active: true, createdAt: key.createdAt, expiresAt: key.expiresAt, lastUsedAt: key.lastSeenAt } : { active: false };
}

export async function createAccessKey(actor: Actor) {
  requirePermission(actor, "users.manage");
  const role = await prisma.role.findUnique({ where: { code: "READONLY" } });
  if (!role) throw notFound("The Read-only reviewer role is missing — redeploy so the base setup adds it");
  const token = `aedro_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + DAYS * 86_400_000);
  // Nobody signs in with this login: its password is random and never shown.
  const unusable = hashPasswordSync(randomBytes(32).toString("base64url"));
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { username: KEY_USER },
      create: { username: KEY_USER, name: "Read-only access key", roleId: role.id, passwordHash: unusable, mustChangePassword: false, active: true },
      update: { roleId: role.id, active: true, mustChangePassword: false, headOfDepartmentId: null },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.session.create({ data: { id: hashToken(token), userId: user.id, expiresAt, kind: "KEY", ip: actor.ip ?? null, userAgent: "Read-only access key" } });
    await audit(tx, actor, { action: "ACCESS_KEY_CREATE", entityType: "User", entityId: user.id, after: { expiresAt } });
  });
  return { key: token, expiresAt };
}

export async function revokeAccessKey(actor: Actor) {
  requirePermission(actor, "users.manage");
  const user = await prisma.user.findUnique({ where: { username: KEY_USER } });
  if (!user) return { revoked: 0 };
  return prisma.$transaction(async (tx) => {
    const r = await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { active: false } });
    await audit(tx, actor, { action: "ACCESS_KEY_REVOKE", entityType: "User", entityId: user.id });
    return { revoked: r.count };
  });
}
