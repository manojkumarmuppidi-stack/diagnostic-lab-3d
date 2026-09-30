import { api } from "@/server/api";
import { errorWorkbook } from "@/server/services/import";

/** Vercel function time limit (60 s is allowed on every Vercel plan). */
export const maxDuration = 60;

export const GET = api<{ batchId: string }>(async ({ actor, params }) => {
  const buf = await errorWorkbook(actor, params.batchId);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="import-errors-${params.batchId.slice(-8)}.xlsx"`,
    },
  });
});
