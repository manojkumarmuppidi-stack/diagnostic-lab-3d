"use client";
import { PERIOD_PRESETS, type CompareMode, type PeriodPreset } from "@/lib/periods";

export interface PeriodValue {
  preset: PeriodPreset;
  from?: string;
  to?: string;
  compareMode?: CompareMode;
}

/** Period selector used by every dashboard: presets, custom range, comparison mode. */
export function PeriodPicker({ value, onChange, showCompare = true, presets }: { value: PeriodValue; onChange: (v: PeriodValue) => void; showCompare?: boolean; presets?: PeriodPreset[] }) {
  const list = PERIOD_PRESETS.filter((p) => !presets || presets.includes(p.key));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-2">
        Period
        <select aria-label="Period" className="input !w-auto" value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value as PeriodPreset })}>
          {list.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {value.preset === "custom" && (
        <>
          <label className="flex flex-col gap-1 text-xs text-2">
            From
            <input aria-label="From date" type="date" className="input !w-auto" value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-2">
            To
            <input aria-label="To date" type="date" className="input !w-auto" value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </label>
        </>
      )}
      {showCompare && (
        <label className="flex flex-col gap-1 text-xs text-2" title="Like-for-like compares the same number of elapsed days (e.g. Mon–Thu vs last Mon–Thu).">
          Compare with previous
          <select aria-label="Comparison mode" className="input !w-auto" value={value.compareMode ?? "like_for_like"} onChange={(e) => onChange({ ...value, compareMode: e.target.value as CompareMode })}>
            <option value="like_for_like">Same elapsed days</option>
            <option value="full">Full previous period</option>
          </select>
        </label>
      )}
    </div>
  );
}

export function periodQuery(v: PeriodValue) {
  const p: Record<string, string> = { preset: v.preset };
  if (v.preset === "custom") {
    if (v.from) p.from = v.from;
    if (v.to) p.to = v.to;
  }
  if (v.compareMode) p.compareMode = v.compareMode;
  return p;
}
