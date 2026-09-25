/**
 * Duplicate-detection key. Two rows with the same key are treated as possible
 * duplicates (see EXCEL_IMPORT_SPEC.md §6). The same key is stored on every
 * transaction row (column "fingerprint"), including manually entered ones.
 */
import { norm } from "./text";

export interface FingerprintParts {
  module: string;
  date: string;
  patient?: string | null; // patient code, else patient name
  reference?: string | null; // invoice / bill / reference no.
  service?: string | null; // investigation / specialty / category id or name
  amount: number;
}

export function fingerprintKey(p: FingerprintParts): string {
  return [
    p.module,
    p.date,
    norm(p.patient ?? ""),
    norm(p.reference ?? ""),
    norm(p.service ?? ""),
    (Math.round(p.amount * 100) / 100).toFixed(2),
  ].join("|");
}
