/**
 * SCP — Sugar Control Plans and short admissions. Billed in OneGlance's OPD report, but they are
 * not consultations: they are AED income of their own (the SCP staff are paid a percentage,
 * booked as an expense). A bill is SCP when its billed name says so or names an SCP staff member.
 */
// Staff names as billed, including the spellings seen in OneGlance ("spadana", "spanadana", "sheebha").
const SCP_NAME = /(sugar\s*control|\bscp\b|short\s*admission|bh?agh?ya|s[a-z]?pa[a-z]*d[a-z]*na|shee?bh?a)/i;

export function isScpName(name: string | null | undefined): boolean {
  return !!name && SCP_NAME.test(name);
}

/**
 * Diet follow-ups: OneGlance's OP bill collection has no item name, only the Visit Purpose, where the
 * diet follow-ups are written as "Diet F/u by Deepika" or just "f/u by deepika" (the dietitian).
 */
const DIET_NAME = /(\bdiet|deepika|deppika|dipika)/i;

export function isDietName(name: string | null | undefined): boolean {
  return !!name && DIET_NAME.test(name) && !isScpName(name);
}
