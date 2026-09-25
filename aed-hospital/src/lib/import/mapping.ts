/**
 * Smart column mapping: suggests which spreadsheet header feeds which field.
 * Pure function — unit tested in tests/unit/import-mapping.test.ts.
 */
import type { FieldDef } from "../modules";
import { norm, similarity } from "./text";

export type Mapping = Record<string, string | null>; // fieldKey → header (or null)

export interface MappingSuggestion {
  mapping: Mapping;
  confidence: Record<string, number>; // fieldKey → 0..1
  unmappedHeaders: string[];
  missingRequired: string[];
}

function scoreHeader(header: string, field: FieldDef): number {
  const h = norm(header);
  if (!h) return 0;
  const candidates = [field.label, field.key.replace(/([A-Z])/g, " $1"), ...(field.aliases ?? [])].map(norm);
  let best = 0;
  candidates.forEach((c, idx) => {
    if (!c) return;
    // Aliases listed first are the strongest signals; label/key are exact names.
    const orderPenalty = idx < 2 ? 0 : Math.min(0.04, (idx - 2) * 0.002);
    let s = 0;
    if (h === c) s = 1;
    else if (h.replace(/ /g, "") === c.replace(/ /g, "")) s = 0.97;
    else {
      const ht = new Set(h.split(" "));
      const ct = c.split(" ");
      const overlap = ct.filter((t) => ht.has(t)).length;
      if (overlap && overlap === ct.length && overlap === ht.size) s = 0.95;
      else if (overlap && overlap === ct.length && ct.join("").length >= 4) s = 0.8; // header ⊃ alias ("Consultation Fee Amount" ⊃ "amount")
      else s = similarity(h, c) * 0.85;
    }
    best = Math.max(best, s - orderPenalty);
  });
  return best;
}

export function suggestMapping(headers: string[], fields: FieldDef[], threshold = 0.62): MappingSuggestion {
  const pairs: { field: string; header: string; score: number }[] = [];
  for (const f of fields) {
    for (const h of headers) {
      const s = scoreHeader(h, f);
      if (s >= threshold) pairs.push({ field: f.key, header: h, score: s });
    }
  }
  // Greedy assignment by descending score: each field and header used at most once.
  pairs.sort((a, b) => b.score - a.score || fields.findIndex((f) => f.key === a.field) - fields.findIndex((f) => f.key === b.field));
  const mapping: Mapping = Object.fromEntries(fields.map((f) => [f.key, null]));
  const confidence: Record<string, number> = {};
  const usedHeaders = new Set<string>();
  for (const p of pairs) {
    if (mapping[p.field] || usedHeaders.has(p.header)) continue;
    mapping[p.field] = p.header;
    confidence[p.field] = Math.round(p.score * 100) / 100;
    usedHeaders.add(p.header);
  }

  // A sheet with a single money column ("Amt", "Amount") records what was
  // collected, so it maps to Net Amount rather than the gross amount.
  if (
    "netAmount" in mapping &&
    "grossAmount" in mapping &&
    mapping.grossAmount &&
    !mapping.netAmount &&
    !mapping.discount
  ) {
    mapping.netAmount = mapping.grossAmount;
    confidence.netAmount = confidence.grossAmount;
    mapping.grossAmount = null;
    delete confidence.grossAmount;
  }

  return {
    mapping,
    confidence,
    unmappedHeaders: headers.filter((h) => !usedHeaders.has(h)),
    missingRequired: missingRequired(mapping, fields),
  };
}

/** Required fields that are not mapped. Amount fields are satisfied by any of gross/net. */
export function missingRequired(mapping: Mapping, fields: FieldDef[]): string[] {
  const hasAmount = !!(mapping.grossAmount || mapping.netAmount);
  return fields
    .filter((f) => f.required && !mapping[f.key])
    .filter((f) => !(f.key === "grossAmount" && hasAmount))
    .filter((f) => !(f.key === "paymentModeId")) // blank payment modes become a warning, not a blocker
    .map((f) => f.label);
}
