import { api } from "@/server/api";
import { requireAnyPermission } from "@/server/authz";
import { badRequest } from "@/server/errors";
import { IMPORT_TYPES, isImportType, templateFor } from "@/lib/modules";
import { templateXlsx } from "@/server/exporters";

const NOTES = [
  "Dates: DD-MM-YYYY (Indian day-first), YYYY-MM-DD or real Excel dates all work.",
  "Amounts may include ₹, Rs, commas or /-. Do not enter negative amounts — record refunds/returns separately.",
  "If only one amount column is filled it is treated as the Net Amount collected.",
  "Payment Mode: Cash, Card, UPI (GPay/PhonePe/Paytm), Bank Transfer (NEFT/RTGS/IMPS), Cheque or Other.",
  "Do not include total / sub-total rows — they are detected and rejected to prevent double counting.",
  "Unknown doctors, tests, categories etc. are shown as warnings and added to master data only if you approve.",
  "Column names do not need to match exactly — the import centre suggests a mapping you can correct.",
];

export const GET = api<{ type: string }>(async ({ actor, params }) => {
  requireAnyPermission(actor, "import.run", "reports.export");
  if (!isImportType(params.type)) throw badRequest("Unknown template");
  const t = templateFor(params.type);
  const label = IMPORT_TYPES.find((x) => x.key === params.type)!.label;
  const buf = await templateXlsx(label, t.headers, t.sample, NOTES);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="AED-${params.type}-template.xlsx"`,
    },
  });
});
