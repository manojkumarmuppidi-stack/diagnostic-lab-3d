import { api } from "@/server/api";
import { departmentStatementWorkbook } from "@/server/services/departments";

/** A department's account (or every department's) as an Excel workbook. */
export const GET = api(async ({ actor, url }) => {
  const { buffer, fileName } = await departmentStatementWorkbook(actor, {
    departmentId: url.searchParams.get("departmentId"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${fileName}"` },
  });
});
