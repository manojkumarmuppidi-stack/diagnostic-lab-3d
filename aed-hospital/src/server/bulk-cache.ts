/**
 * Per-operation lookup cache for bulk work (import commit). Inside `withBulkCache`, master-data
 * lookups, patient resolution and day-status checks hit the database once per distinct key instead
 * of once per row — the difference between minutes and seconds on a remote database.
 * Outside a bulk operation nothing is cached, so normal entry always sees fresh data.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface BulkCache {
  rows: Map<string, unknown>;
  patients: Map<string, { id: string; name: string }>;
  days: Map<string, string>;
  /** Historical backfill by an Admin: rows may land on closed days (each day is re-snapshotted afterwards). */
  allowClosed?: boolean;
}

const store = new AsyncLocalStorage<BulkCache>();

export function withBulkCache<T>(fn: () => Promise<T>, opts: { allowClosed?: boolean } = {}): Promise<T> {
  return store.run({ rows: new Map(), patients: new Map(), days: new Map(), allowClosed: opts.allowClosed }, fn);
}

export function bulkCache(): BulkCache | undefined {
  return store.getStore();
}
