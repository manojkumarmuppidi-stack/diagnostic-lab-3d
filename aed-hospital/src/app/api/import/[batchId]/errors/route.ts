import { api } from "@/server/api";
import { errorWorkbook } from "@/server/services/import";

export const GET = api<{ batchId: string }>(async ({ actor, params }) => {
  const buf = await errorWorkbook(actor, params.batchId);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="import-errors-${params.batchId.slice(-8)}.xlsx"`,
    },
  });
});
