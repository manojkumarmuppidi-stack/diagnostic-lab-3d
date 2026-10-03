/**
 * SCP — Sugar Control Plans and short admissions. Billed in OneGlance's OPD report, but they are
 * not consultations: they are AED income of their own (the SCP staff are paid a percentage,
 * booked as an expense). A bill is SCP when its billed name says so or names an SCP staff member.
 */
const SCP_NAME = /(sugar\s*control|\bscp\b|short\s*admission|bhagya|spandana|sheeba)/i;

export function isScpName(name: string | null | undefined): boolean {
  return !!name && SCP_NAME.test(name);
}
