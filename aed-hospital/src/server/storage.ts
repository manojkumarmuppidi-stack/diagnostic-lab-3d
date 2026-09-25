/**
 * File storage for expense bills/receipts. Local-disk adapter; in production point
 * UPLOAD_DIR at a backed-up volume (see BACKUP_RECOVERY.md) or swap this adapter for
 * object storage — callers only use put/get.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { badRequest } from "./errors";

const ROOT = path.resolve(process.env.UPLOAD_DIR || "./uploads");
export const MAX_ATTACHMENT_BYTES = Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024;

/** Allowed types, verified by magic bytes (the browser-supplied MIME type is not trusted). */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mime: "image/heic", ext: "heic", test: (b) => b.subarray(4, 8).toString() === "ftyp" && /hei|mif1|msf1/.test(b.subarray(8, 12).toString()) },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
];

export function sniff(buf: Buffer) {
  return SIGNATURES.find((s) => s.test(buf)) ?? null;
}

export async function putFile(buf: Buffer) {
  if (!buf.length) throw badRequest("Empty file");
  if (buf.length > MAX_ATTACHMENT_BYTES) throw badRequest(`File too large (max ${process.env.MAX_UPLOAD_MB || 10} MB)`);
  const kind = sniff(buf);
  if (!kind) throw badRequest("Only JPEG, PNG, WEBP, HEIC images or PDF files are allowed");
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${kind.ext}`;
  const full = path.join(ROOT, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { flag: "wx" });
  return { storageKey: key, mimeType: kind.mime, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
}

export async function getFile(storageKey: string): Promise<Buffer> {
  const full = path.resolve(ROOT, storageKey);
  if (!full.startsWith(ROOT + path.sep)) throw badRequest("Invalid file key");
  return readFile(full);
}
