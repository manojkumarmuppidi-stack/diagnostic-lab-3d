/** Normalise a header / master name for matching: lower-case, alphanumerics only, single spaces. */
export function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const compactX = x.replace(/ /g, "");
  const compactY = y.replace(/ /g, "");
  if (compactX === compactY) return 0.98;
  return 1 - levenshtein(compactX, compactY) / Math.max(compactX.length, compactY.length);
}

export interface NamedItem {
  id: string;
  name: string;
  code?: string | null;
}

export type MatchResult<T> = { item: T; exact: boolean; score: number } | null;

/**
 * Find a master item by name (or code). Exact normalised matches win; otherwise
 * the best fuzzy match above `threshold` is returned with exact=false so that the
 * caller can raise a "matched X to Y" warning.
 */
export function matchByName<T extends NamedItem>(value: string, items: T[], threshold = 0.84): MatchResult<T> {
  const v = norm(value);
  if (!v) return null;
  for (const it of items) {
    if (norm(it.name) === v || (it.code && norm(it.code) === v)) return { item: it, exact: true, score: 1 };
  }
  // Tolerate "Dr." prefixes and similar noise.
  const stripped = v.replace(/^(dr|mr|mrs|ms)\s+/, "");
  for (const it of items) {
    if (norm(it.name).replace(/^(dr|mr|mrs|ms)\s+/, "") === stripped) return { item: it, exact: true, score: 1 };
  }
  // Abbreviations: every word is a prefix of the matching word ("Diab Profile" → "Diabetic Profile").
  // Only accepted when exactly one item matches, so ambiguous abbreviations are never guessed.
  const vt = stripped.split(" ");
  if (vt.every((t) => t.length >= 2) && vt.join("").length >= 4) {
    const abbr = items.filter((it) => {
      const nt = norm(it.name).split(" ");
      return nt.length === vt.length && nt.every((t, i) => t.startsWith(vt[i]));
    });
    if (abbr.length === 1) return { item: abbr[0], exact: false, score: 0.9 };
  }
  let best: MatchResult<T> = null;
  for (const it of items) {
    if (meaningDiffers(v, norm(it.name))) continue;
    const s = Math.max(similarity(v, it.name), it.code ? similarity(v, it.code) : 0);
    if (s >= threshold && (!best || s > best.score)) best = { item: it, exact: false, score: s };
  }
  return best;
}

/**
 * Words that flip the meaning of an otherwise similar name. "Thyroid New Consultation" is
 * 3 edits from "Thyroid Old Consultation", and "T3" is one edit from "T4" — never a typo.
 */
const MEANING_WORDS = new Set(["new", "old", "with", "without", "pre", "post", "male", "female", "left", "right", "plain", "contrast", "fasting", "random", "single", "double", "first", "second", "adult", "child", "baby", "free", "total"]);
export function meaningDiffers(a: string, b: string): boolean {
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  for (const t of ta) if (MEANING_WORDS.has(t) && !tb.has(t)) return true;
  for (const t of tb) if (MEANING_WORDS.has(t) && !ta.has(t)) return true;
  const digits = (s: string) => (s.match(/\d+/g) ?? []).join(",");
  return digits(a) !== digits(b);
}
