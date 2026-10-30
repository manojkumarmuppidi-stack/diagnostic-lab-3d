import { api } from "@/server/api";
import { expenditureSheet } from "@/server/services/departments";

/** Blank monthly expenditure sheet for department heads (one department, or every department). */
export const GET = api(async ({ actor, url }) => {
  const { buffer, fileName } = await expenditureSheet(actor, {
    departmentId: url.searchParams.get("departmentId"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${fileName}"` },
  });
});
