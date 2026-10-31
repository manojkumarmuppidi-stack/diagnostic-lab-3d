"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Field } from "@/components/ui";

export const EMPTY_ASSET = { name: "", category: "Vehicles", purchaseDate: "", cost: "", method: "SLM", usefulLifeYears: 8, residualPct: 5, ratePct: 15, notes: "" };

/** Name, cost and depreciation method of an asset; used here and on the bank page (with its payments). */
export function AssetForm({ v, set, withCost = true }: { v: any; set: (k: string, val: any) => void; withCost?: boolean }) {
  return (
    <div className="space-y-3">
      <Field label="Asset" required help="e.g. VinFast car (Nanesh Automotives)">
        <input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <input className="input" value={v.category} onChange={(e) => set("category", e.target.value)} />
        </Field>
        {withCost && (
          <Field label="Purchase date" required>
            <input type="date" className="input" value={v.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
          </Field>
        )}
      </div>
      {withCost && (
        <Field label="Cost (₹)" required>
          <input type="number" className="input" min={0} value={v.cost} onChange={(e) => set("cost", e.target.value)} />
        </Field>
      )}
      <Field label="Depreciation">
        <select className="input" value={v.method} onChange={(e) => set("method", e.target.value)}>
          <option value="SLM">Straight line over the useful life (books — motor cars 8 years, 5% residual)</option>
          <option value="WDV">A fixed % of the remaining value each year (income tax — motor cars 15%)</option>
        </select>
      </Field>
      {v.method === "SLM" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Useful life (years)">
            <input type="number" className="input" min={1} value={v.usefulLifeYears} onChange={(e) => set("usefulLifeYears", e.target.value)} />
          </Field>
          <Field label="Residual value (% of cost)">
            <input type="number" className="input" min={0} max={100} value={v.residualPct} onChange={(e) => set("residualPct", e.target.value)} />
          </Field>
        </div>
      ) : (
        <Field label="Rate (% a year)">
          <input type="number" className="input" min={0} max={100} value={v.ratePct} onChange={(e) => set("ratePct", e.target.value)} />
        </Field>
      )}
    </div>
  );
}
