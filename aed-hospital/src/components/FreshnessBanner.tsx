"use client";
/**
 * "Accounts not up to date" warning: lists every stream whose last entry is older than allowed, so a
 * total that silently stops at an earlier date is never read as complete.
 */
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useApi } from "@/lib/client";
import { formatDayMonth } from "@/lib/dates";

interface Freshness {
  ref: string;
  refIsToday: boolean;
  behind: { key: string; label: string; href: string; lastDate: string | null; daysBehind: number | null }[];
}

export function FreshnessBanner({ to, print = false }: { to?: string | null; print?: boolean }) {
  const { data } = useApi<Freshness>(`/api/freshness${to ? `?to=${to}` : ""}`);
  if (!data || !data.behind.length) return null;
  const items = data.behind.map((s) => ({
    ...s,
    text: s.lastDate ? `last entry ${formatDayMonth(s.lastDate)}${s.daysBehind ? ` · ${s.daysBehind} day${s.daysBehind === 1 ? "" : "s"} missing` : ""}` : "no entries yet",
  }));
  if (print)
    return (
      <p className="ds-stale">
        <b>Not up to date:</b> {items.map((s) => `${s.label} (${s.text})`).join(" · ")}. Figures after those dates are missing.
      </p>
    );
  return (
    <div role="alert" className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--status-warning)", background: "color-mix(in srgb, var(--status-warning) 10%, var(--surface))" }}>
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--status-warning)" }} />
        {data.refIsToday ? "Accounts are not up to date" : `Some figures stop before ${formatDayMonth(data.ref)}`}
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {items.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="underline decoration-dotted">
              {s.label}
            </Link>{" "}
            <span className="muted">— {s.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs muted">Totals and comparisons on this page do not include anything after these dates. Enter or import the missing days before relying on them.</p>
    </div>
  );
}
