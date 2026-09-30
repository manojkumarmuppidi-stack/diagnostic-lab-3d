import { gunzipSync } from "node:zlib";
import { api } from "@/server/api";
import { badRequest } from "@/server/errors";
import { MAX_FILE_BYTES, MAX_UPLOAD_BYTES } from "@/server/spreadsheet";
import { uploadFile } from "@/server/services/import";

/** Vercel function time limit (60 s is allowed on every Vercel plan). */
export const maxDuration = 60;

export const POST = api(async ({ actor, req }) => {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw badRequest("File too large");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file uploaded");
  let buf = Buffer.from(await file.arrayBuffer());
  // The browser gzips large files so they fit Vercel's request limit.
  if (form.get("encoding") === "gzip") {
    try {
      buf = gunzipSync(buf, { maxOutputLength: MAX_FILE_BYTES + 1 });
    } catch {
      throw badRequest("Could not decompress the upload, or the file is larger than 40 MB");
    }
  }
  return uploadFile(actor, file.name, buf, String(form.get("type") ?? ""));
});
