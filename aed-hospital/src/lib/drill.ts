/** Drill-down targets: where each dashboard figure's underlying transactions are listed. */
export const STREAM_HREF: Record<string, string> = {
  OPD: "/opd",
  IPD: "/ipd?tab=payments",
  LAB: "/lab",
  PHARMACY: "/pharmacy",
  DIET: "/diet",
  SCP: "/opd",
  OTHER: "/other-income",
};

export function withRange(href: string, from: string, to: string) {
  return `${href}${href.includes("?") ? "&" : "?"}from=${from}&to=${to}`;
}
