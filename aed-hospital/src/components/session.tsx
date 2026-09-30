"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PermissionCode } from "@/lib/permissions";
import { useApi } from "@/lib/client";

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
  hospitalName: string;
  today: string;
}

const Ctx = createContext<SessionUser | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** UI-only convenience. Every action is re-checked on the server. */
export function useCan() {
  const s = useSession();
  const set = useMemo(() => new Set(s.permissions), [s.permissions]);
  return (p: PermissionCode) => set.has(p);
}

// ─────────────────────────── masters ───────────────────────────

export interface MasterItem {
  id: string;
  name: string;
  active: boolean;
  [k: string]: unknown;
}
export type Masters = Record<
  | "departments"
  | "specialties"
  | "doctors"
  | "consultationTypes"
  | "admissionTypes"
  | "ipdPackages"
  | "investigations"
  | "dietServices"
  | "expenseCategories"
  | "expenseHeads"
  | "paymentModes",
  MasterItem[]
>;

const MastersCtx = createContext<{ masters: Masters | null; reload: () => void }>({ masters: null, reload: () => {} });

export function MastersProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi<Masters>("/api/masters");
  return <MastersCtx.Provider value={{ masters: data, reload }}>{children}</MastersCtx.Provider>;
}

export function useMasters() {
  return useContext(MastersCtx);
}

/** Options for a MasterKey used by module field definitions. */
export function masterOptions(masters: Masters | null, key: string, opts: { includeId?: string | null; parentId?: string | null } = {}) {
  if (!masters) return [];
  let list: MasterItem[] = [];
  switch (key) {
    case "doctors":
      list = masters.doctors.filter((d) => d.kind !== "DIETICIAN");
      break;
    case "dieticians":
      list = masters.doctors.filter((d) => d.kind === "DIETICIAN");
      break;
    case "expenseCategories":
      list = masters.expenseCategories.filter((c) => !c.parentId);
      break;
    case "expenseSubcategories":
      list = masters.expenseCategories.filter((c) => c.parentId && (!opts.parentId || c.parentId === opts.parentId));
      break;
    default:
      list = (masters as Record<string, MasterItem[]>)[key] ?? [];
  }
  // Inactive items are hidden from entry forms unless the record being edited already uses one.
  return list.filter((i) => i.active || i.id === opts.includeId);
}
