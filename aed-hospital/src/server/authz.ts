/** Authorization primitives. Kept free of Next.js imports so services and tests can use them. */
import type { PermissionCode } from "@/lib/permissions";
import { forbidden } from "./errors";

export interface Actor {
  id: string;
  username: string;
  name: string;
  roleCode: string;
  roleName: string;
  permissions: Set<string>;
  mustChangePassword: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export function can(actor: Actor, code: PermissionCode): boolean {
  return actor.permissions.has(code);
}

export function requirePermission(actor: Actor, ...codes: PermissionCode[]) {
  for (const c of codes) if (!actor.permissions.has(c)) throw forbidden(`Missing permission: ${c}`);
}

export function requireAnyPermission(actor: Actor, ...codes: PermissionCode[]) {
  if (!codes.some((c) => actor.permissions.has(c))) throw forbidden(`Requires one of: ${codes.join(", ")}`);
}
