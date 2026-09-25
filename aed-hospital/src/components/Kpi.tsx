"use client";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatINR, formatINRCompact, formatNumber, formatPct } from "@/lib/money";
import type { Change } from "@/lib/accounting";
import { cn } from "@/lib/client";

export type KpiFormat = "money" | "int" | "pct";

function fmt(v: number | null | undefined, f: KpiFormat, compact = false) {
  if (v === null || v === undefined) return "—";
  if (f === "money") return compact ? formatINRCompact(v) : formatINR(v);
  if (f === "pct") return `${v.toFixed(1)}%`;
  return formatNumber(v);
}

/**
 * KPI card. Every number links to the transactions behind it (drill-down).
 * `goodWhen` sets whether an increase is favourable (income) or not (expenses).
 */
export function Kpi({
  label,
  value,
  format = "money",
  change,
  href,
  goodWhen = "up",
  hint,
  emphasis,
  swatch,
}: {
  label: string;
  value: number | null | undefined;
  format?: KpiFormat;
  change?: Change;
  href?: string;
  goodWhen?: "up" | "down";
  hint?: string;
  emphasis?: boolean;
  swatch?: string;
}) {
  const body = (
    <div className={cn("card h-full p-3 transition sm:p-4", href && "hover:shadow-md")} title={hint}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-2">
        {swatch && <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: swatch }} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1 font-semibold tabular-nums tracking-tight", emphasis ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl")} style={emphasis && typeof value === "number" && value < 0 ? { color: "var(--bad)" } : undefined}>
        <span className="sm:hidden">{fmt(value, format, true)}</span>
        <span className="hidden sm:inline">{fmt(value, format)}</span>
      </div>
      {change && <Delta change={change} format={format} goodWhen={goodWhen} />}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full" aria-label={`${label}: ${fmt(value, format)} — view transactions`}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function Delta({ change, format, goodWhen = "up" }: { change: Change; format: KpiFormat; goodWhen?: "up" | "down" }) {
  const good = change.direction === "flat" ? null : (change.direction === "up") === (goodWhen === "up");
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : Minus;
  const color = good === null ? "var(--text-3)" : good ? "var(--good)" : "var(--bad)";
  const pct = change.pct === null ? (change.previous === 0 && change.current !== 0 ? "new (prev. 0)" : "—") : formatPct(change.pct);
  const diff = format === "money" ? formatINRCompact(change.diff) : formatNumber(change.diff);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs" style={{ color }}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="font-medium">{pct}</span>
      <span className="muted">
        ({change.diff > 0 ? "+" : ""}
        {diff} vs {fmt(change.previous, format, true)})
      </span>
    </div>
  );
}
