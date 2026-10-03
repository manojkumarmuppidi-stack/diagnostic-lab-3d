"use client";
/**
 * Chart wrappers over Recharts following the data-viz rules used across the app:
 *  - colour follows the entity (fixed slot per income stream), never its rank;
 *  - one y-axis only; thin marks; 4px rounded bar ends; 2px surface gap in stacks;
 *  - legend for ≥2 series; hover tooltip always; a table view for accessibility;
 *  - clicking a mark drills down to the underlying transactions.
 */
import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Table2, BarChart3 } from "lucide-react";
import { formatINR, formatINRCompact, formatNumber } from "@/lib/money";
import { formatDayMonth, formatMonth } from "@/lib/dates";
import type { Granularity } from "@/lib/periods";

export const STREAM_COLORS: Record<string, string> = {
  OPD: "var(--series-1)",
  IPD: "var(--series-2)",
  LAB: "var(--series-3)",
  PHARMACY: "var(--series-4)",
  DIET: "var(--series-5)",
  SCP: "var(--series-6)",
  OTHER: "var(--series-6)",
};
export const SLOT = (i: number) => `var(--series-${(i % 8) + 1})`;

export interface Series {
  key: string;
  label: string;
  color: string;
}

type ValueFormat = "money" | "int";
const fmtAxis = (f: ValueFormat) => (v: number) => (f === "money" ? formatINRCompact(v) : formatNumber(v));
const fmtFull = (f: ValueFormat) => (v: number) => (f === "money" ? formatINR(v) : formatNumber(v));

export function bucketLabel(b: string, g: Granularity) {
  // Recharts can call tick formatters with numeric ticks while data is changing; only format real dates.
  if (!/^\d{4}-\d{2}-\d{2}/.test(b)) return b;
  if (g === "month") return formatMonth(b);
  if (g === "week") return `Wk ${formatDayMonth(b)}`;
  return formatDayMonth(b);
}

const axisStyle = { fontSize: 11, fill: "var(--text-3)" };

function TooltipBox({ active, payload, label, format, labelFormatter }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string; format: ValueFormat; labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  const total = payload.length > 1 ? payload.reduce((a, p) => a + (Number(p.value) || 0), 0) : null;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg" style={{ minWidth: 160 }}>
      {label !== undefined && <p className="mb-1 font-semibold">{labelFormatter ? labelFormatter(String(label)) : label}</p>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-2">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular-nums font-medium">{fmtFull(format)(Number(p.value))}</span>
        </div>
      ))}
      {total !== null && payload.length > 2 && (
        <div className="mt-1 flex justify-between border-t pt-1" style={{ borderColor: "var(--border)" }}>
          <span className="text-2">Total</span>
          <span className="tabular-nums font-semibold">{fmtFull(format)(total)}</span>
        </div>
      )}
    </div>
  );
}

/** Card wrapper with a chart ⇄ table toggle (table view = accessible alternative). */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  actions,
  height = 280,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  table?: { columns: { key: string; label: string; format?: ValueFormat | "text" }[]; rows: Record<string, unknown>[] };
  actions?: ReactNode;
  height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {table && (
            <button className="btn btn-ghost btn-sm" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable} title={asTable ? "Show chart" : "Show as table"}>
              {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
              <span className="sr-only">{asTable ? "Show chart" : "Show as table"}</span>
            </button>
          )}
        </div>
      </header>
      <div className="px-2 pb-3 pt-2" style={{ minHeight: height }}>
        {asTable && table ? (
          <div className="max-h-[320px] overflow-auto px-2">
            <table className="table">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c.key} className={c.format && c.format !== "text" ? "num" : ""}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {table.columns.map((c) => (
                      <td key={c.key} className={c.format && c.format !== "text" ? "num" : ""}>
                        {c.format === "money" ? formatINR(Number(r[c.key])) : c.format === "int" ? formatNumber(Number(r[c.key])) : String(r[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </section>
  );
}

export function TrendChart({
  data,
  xKey,
  series,
  format = "money",
  granularity = "day",
  onPointClick,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  format?: ValueFormat;
  granularity?: Granularity;
  onPointClick?: (row: Record<string, unknown>) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
        onClick={(e: { activePayload?: { payload: Record<string, unknown> }[] } | null) => e?.activePayload?.[0] && onPointClick?.(e.activePayload[0].payload)}
        style={{ cursor: onPointClick ? "pointer" : undefined }}
      >
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={xKey} tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--grid)" }} tickFormatter={(v) => bucketLabel(String(v), granularity)} minTickGap={16} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={fmtAxis(format)} width={72} />
        <Tooltip content={<TooltipBox format={format} labelFormatter={(l) => bucketLabel(l, granularity)} />} cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }} />
        {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--text-2)" }} formatter={(v: string) => <span style={{ color: "var(--text-2)" }}>{v}</span>} />}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={data.length <= 31 ? { r: 3, strokeWidth: 0, fill: s.color } : false} activeDot={{ r: 5, stroke: "var(--chart-surface)", strokeWidth: 2 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({
  data,
  xKey,
  series,
  format = "money",
  stacked,
  horizontal,
  granularity,
  onBarClick,
  colorByRow,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  format?: ValueFormat;
  stacked?: boolean;
  horizontal?: boolean;
  granularity?: Granularity;
  onBarClick?: (row: Record<string, unknown>) => void;
  /** Single-series bars coloured per category (e.g. income stream) — colour follows the entity. */
  colorByRow?: (row: Record<string, unknown>) => string;
}) {
  const tickFmt = granularity ? (v: unknown) => bucketLabel(String(v), granularity) : (v: unknown) => String(v);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barCategoryGap="20%">
        <CartesianGrid stroke="var(--grid)" vertical={!!horizontal} horizontal={!horizontal} />
        {/* Recharts only discovers axes that are direct children — no fragments here. */}
        {horizontal && <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={fmtAxis(format)} />}
        {horizontal && <YAxis type="category" dataKey={xKey} tick={axisStyle} tickLine={false} axisLine={false} width={120} />}
        {!horizontal && <XAxis dataKey={xKey} tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--grid)" }} tickFormatter={tickFmt} minTickGap={8} />}
        {!horizontal && <YAxis tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={fmtAxis(format)} width={72} />}
        <Tooltip content={<TooltipBox format={format} labelFormatter={granularity ? (l) => bucketLabel(l, granularity) : undefined} />} cursor={{ fill: "color-mix(in srgb, var(--text-3) 10%, transparent)" }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-2)" }} iconType="square" formatter={(v: string) => <span style={{ color: "var(--text-2)" }}>{v}</span>} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            stackId={stacked ? "a" : undefined}
            stroke="var(--chart-surface)"
            strokeWidth={stacked ? 2 : 0}
            radius={stacked ? (i === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            onClick={(d: { payload?: Record<string, unknown> }) => d?.payload && onBarClick?.(d.payload)}
            style={{ cursor: onBarClick ? "pointer" : undefined }}
            isAnimationActive={false}
            maxBarSize={48}
          >
            {colorByRow && data.map((row, j) => <Cell key={j} fill={colorByRow(row)} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  format = "money",
  onSliceClick,
}: {
  data: { name: string; value: number; color: string; key?: string }[];
  format?: ValueFormat;
  onSliceClick?: (d: { name: string; key?: string }) => void;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const positive = data.filter((d) => d.value > 0);
  return (
    <div className="flex h-full flex-col items-center gap-2 sm:flex-row">
      <div className="relative h-[200px] w-full sm:h-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={positive} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1} stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} onClick={(d: { name: string; key?: string }) => onSliceClick?.(d)} style={{ cursor: onSliceClick ? "pointer" : undefined }}>
              {positive.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox format={format} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs muted">Total</span>
          <span className="text-sm font-semibold tabular-nums">{format === "money" ? formatINRCompact(total) : formatNumber(total)}</span>
        </div>
      </div>
      <ul className="w-full space-y-1 text-sm sm:w-1/2">
        {data.map((d) => (
          <li key={d.name}>
            <button className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:opacity-80" onClick={() => onSliceClick?.(d)} disabled={!onSliceClick}>
              <span className="flex items-center gap-2 text-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                {d.name}
              </span>
              <span className="tabular-nums">
                {format === "money" ? formatINRCompact(d.value) : formatNumber(d.value)}
                <span className="ml-1 text-xs muted">{total ? `${((d.value / total) * 100).toFixed(0)}%` : ""}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
