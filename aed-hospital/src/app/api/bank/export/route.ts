import { api } from "@/server/api";
import { bankReportWorkbook } from "@/server/services/bank";

export const GET = api(async ({ actor, url }) => {
  const { buffer, fileName } = await bankReportWorkbook(actor, { from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${fileName}"` },
  });
});
