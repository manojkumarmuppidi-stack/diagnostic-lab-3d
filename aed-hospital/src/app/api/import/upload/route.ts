import { api } from "@/server/api";
import { badRequest } from "@/server/errors";
import { MAX_UPLOAD_BYTES } from "@/server/spreadsheet";
import { uploadFile } from "@/server/services/import";

export const POST = api(async ({ actor, req }) => {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw badRequest("File too large");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file uploaded");
  return uploadFile(actor, file.name, Buffer.from(await file.arrayBuffer()), String(form.get("type") ?? ""));
});
