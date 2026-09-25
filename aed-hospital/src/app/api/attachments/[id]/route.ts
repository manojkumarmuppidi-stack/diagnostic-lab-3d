import { api } from "@/server/api";
import { readAttachment } from "@/server/services/misc";

export const GET = api<{ id: string }>(async ({ actor, params }) => {
  const { meta, data } = await readAttachment(actor, params.id);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": meta.mimeType,
      "Content-Disposition": `inline; filename="${meta.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
