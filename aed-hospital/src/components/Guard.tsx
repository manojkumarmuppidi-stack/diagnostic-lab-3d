"use client";
import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import type { PermissionCode } from "@/lib/permissions";
import { useCan } from "./session";
import { EmptyState } from "./ui";

/** Hides a page from users without the permission (the API enforces it regardless). */
export function Guard({ perm, children }: { perm: PermissionCode; children: ReactNode }) {
  const can = useCan();
  if (!can(perm)) return <EmptyState icon={<ShieldAlert className="h-8 w-8" />} title="You do not have access to this page" detail={`Required permission: ${perm}. Ask an Admin if you need it.`} />;
  return <>{children}</>;
}
