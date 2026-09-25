import type { Prisma } from "@prisma/client";
import type { Actor } from "./authz";
import type { Tx } from "./db";

/** Convert Prisma rows (Decimal, Date) into plain JSON for before/after snapshots. */
export function snapshot(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Append an audit record. Always call inside the same DB transaction as the change. */
export async function audit(tx: Tx, actor: Actor | null, e: AuditEntry) {
  await tx.auditLog.create({
    data: {
      userId: actor?.id ?? null,
      userName: actor?.username ?? "system",
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: snapshot(e.before),
      after: snapshot(e.after),
      reason: e.reason ?? null,
      ip: actor?.ip ?? null,
      userAgent: actor?.userAgent ?? null,
    },
  });
}
