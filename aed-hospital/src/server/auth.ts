import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import { forbidden, tooMany, unauthorized } from "./errors";
import type { Actor } from "./authz";
export { can, requirePermission, requireAnyPermission, type Actor } from "./authz";

export const SESSION_COOKIE = "aed_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
const MAX_FAILED_PER_USER = 5;
const MAX_FAILED_PER_IP = 20;
const LOCK_WINDOW_MIN = 15;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain letters and numbers";
  return null;
}

export async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** Throttle brute-force attempts per username and per IP (DB-backed so it works across instances). */
async function assertNotThrottled(username: string, ip: string | null) {
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60_000);
  const [byUser, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { username, success: false, createdAt: { gte: since } } }),
    ip ? prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }) : 0,
  ]);
  if (byUser >= MAX_FAILED_PER_USER || byIp >= MAX_FAILED_PER_IP) {
    throw tooMany(`Too many failed sign-in attempts. Try again in ${LOCK_WINDOW_MIN} minutes.`);
  }
}

export async function login(usernameRaw: string, password: string) {
  const username = usernameRaw.trim().toLowerCase();
  const { ip, userAgent } = await requestMeta();
  await assertNotThrottled(username, ip);
  const user = await prisma.user.findUnique({ where: { username } });
  // Always run bcrypt so response time does not reveal whether the user exists.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  await prisma.loginAttempt.create({ data: { username, ip, success: ok && !!user?.active } });
  if (!user || !ok || !user.active) throw unauthorized("Invalid username or password");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3_600_000);
  await prisma.$transaction([
    prisma.session.create({ data: { id: hashToken(token), userId: user.id, expiresAt, ip, userAgent } }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    prisma.auditLog.create({
      data: { userId: user.id, userName: user.username, action: "LOGIN", entityType: "User", entityId: user.id, ip, userAgent },
    }),
  ]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
  return user;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const s = await prisma.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
    if (s) {
      await prisma.session.delete({ where: { id: s.id } });
      await prisma.auditLog.create({
        data: { userId: s.userId, userName: s.user.username, action: "LOGOUT", entityType: "User", entityId: s.userId },
      });
    }
  }
  jar.delete(SESSION_COOKIE);
}

/** Resolve the current user from the session cookie, or null. Permissions come from the DB every request. */
export async function getActor(): Promise<Actor | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  // Sliding "last seen" (cheap, at most once per minute).
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  const { user } = session;
  const meta = await requestMeta();
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleCode: user.role.code,
    roleName: user.role.name,
    permissions: new Set(user.role.permissions.map((rp) => rp.permission.code)),
    mustChangePassword: user.mustChangePassword,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) throw unauthorized();
  return a;
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw unauthorized("Current password is incorrect");
  const weak = validatePasswordStrength(next);
  if (weak) throw forbidden(weak);
  await prisma.$transaction([
    prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } }),
    prisma.auditLog.create({ data: { userId: actor.id, userName: actor.username, action: "PASSWORD_CHANGE", entityType: "User", entityId: actor.id } }),
  ]);
}
