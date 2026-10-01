/**
 * Expense helpers shared by the entry form, the cash-book importer and the server:
 *  - payment-mode suggestion from the amount (AED's rule; staff can always change it)
 *  - keyword search over monthly expense heads ("rent", "milk", "esi" …)
 */
import { norm } from "./import/text";

/** AED rule: below ₹3,000 cash, above ₹1,00,000 online (bank transfer), otherwise card. */
export const EXPENSE_MODE_RULE = { cashBelow: 3000, onlineAbove: 100_000 } as const;

export function suggestModeCode(amount: number | null | undefined): "CASH" | "CARD" | "BANK" | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) return null;
  if (amount < EXPENSE_MODE_RULE.cashBelow) return "CASH";
  if (amount > EXPENSE_MODE_RULE.onlineAbove) return "BANK";
  return "CARD";
}

export interface HeadLike {
  id: string;
  name: string;
  keywords?: string | null;
  vendor?: string | null;
  categoryName?: string | null;
  active?: boolean;
}

/**
 * Rank heads for a typed query: exact word > name starts with > a word starts with > keyword/vendor/category contains.
 * One word is enough ("rent" → Rent – Cash, Rent – Online). Substring-only matches are shown
 * only when nothing matches at a word start.
 */
export function searchHeads<T extends HeadLike>(heads: T[], q: string, limit = 8): T[] {
  const s = norm(q);
  if (!s) return [];
  const scored: [number, T][] = [];
  for (const h of heads) {
    if (h.active === false) continue;
    const name = norm(h.name);
    const words = name.split(" ");
    const keys = (h.keywords ?? "").split(",").map((k) => norm(k)).filter(Boolean);
    let score = 0;
    if (words.includes(s) || keys.includes(s)) score = 100;
    else if (name.startsWith(s)) score = 80;
    else if (words.some((w) => w.startsWith(s)) || keys.some((k) => k.startsWith(s))) score = 60;
    else if (name.includes(s) || keys.some((k) => k.includes(s))) score = 40;
    else if (norm(h.vendor).includes(s) || norm(h.categoryName).includes(s)) score = 20;
    if (score) scored.push([score - name.length / 100, h]);
  }
  // Word matches win outright: "rent" should not also offer Electricity (keyword "current").
  const strong = scored.some(([sc]) => sc >= 59);
  return scored
    .filter(([sc]) => !strong || sc >= 59)
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([, h]) => h);
}

/** "2026-09" → "Sep 2026" */
export function monthLabel(ym: string): string {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = ym.split("-");
  return `${M[Number(m) - 1]} ${y}`;
}

export interface HeadRule {
  id: string;
  name: string;
  keywords: string;
  categoryId: string;
  subcategoryId: string | null;
  departmentId: string | null;
  sortOrder: number;
}

const STOP = new Set(["and", "the", "of", "for", "to", "bill", "fees", "fee"]);

/**
 * Which routine head an expense belongs to, from its category and wording — used to link
 * imported expenses (cash book, register) so the monthly checklist and "last month" know them.
 * Only heads of the same category (and subcategory, if the head has one) are candidates; a
 * department-specific head (Wellness, Pharmacy) only takes expenses of that department. Returns
 * null when the wording does not single one out.
 */
export function matchHead<T extends HeadRule>(heads: T[], e: { description: string; vendor?: string | null; categoryId: string; subcategoryId?: string | null; departmentId?: string | null }): T | null {
  let cands = heads.filter((h) => h.categoryId === e.categoryId && (!h.subcategoryId || h.subcategoryId === (e.subcategoryId ?? null)));
  const sameDept = cands.filter((h) => h.departmentId && h.departmentId === e.departmentId);
  cands = sameDept.length ? sameDept : cands.filter((h) => !h.departmentId);
  if (!cands.length) return null;
  const text = ` ${norm(`${e.description} ${e.vendor ?? ""}`)} `;
  const hasWord = (w: string) => text.includes(` ${w} `);
  const scored = cands
    .map((h) => {
      const words = norm(h.name).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
      const keys = (h.keywords ?? "").split(",").map((k) => norm(k)).filter(Boolean);
      return { h, score: words.filter(hasWord).length * 2 + keys.filter(hasWord).length };
    })
    .sort((a, b) => b.score - a.score || a.h.sortOrder - b.h.sortOrder);
  if (scored[0].score > 0) return scored[0].h;
  return cands.length === 1 ? cands[0] : null;
}
