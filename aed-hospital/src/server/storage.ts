/**
 * File storage for expense bills/receipts.
 *  - "vercel-blob": PRIVATE Vercel Blob store (used automatically when BLOB_READ_WRITE_TOKEN is set).
 *    Files are never publicly reachable; the app streams them to signed-in users only.
 *  - "local": UPLOAD_DIR on disk (own server / Docker with a persistent volume).
 * Choose explicitly with STORAGE_DRIVER=local|vercel-blob. Callers only use putFile/getFile.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { badRequest } from "./errors";

/** Vercel functions reject request bodies over 4.5 MB, so keep uploads under 4 MB there. */
export const ON_VERCEL = !!process.env.VERCEL;
const DEFAULT_MB = ON_VERCEL ? 4 : 10;
export const MAX_ATTACHMENT_BYTES = Number(process.env.MAX_UPLOAD_MB || DEFAULT_MB) * 1024 * 1024;

export type StorageDriver = "local" | "vercel-blob";

export function storageDriver(): StorageDriver {
  const explicit = process.env.STORAGE_DRIVER;
  if (explicit === "local" || explicit === "vercel-blob") return explicit;
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local";
}

const BLOB_PREFIX = "blob:";

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

function localRoot() {
  return path.resolve(process.env.UPLOAD_DIR || "./uploads");
}

export async function putFile(buf: Buffer) {
  if (!buf.length) throw badRequest("Empty file");
  if (buf.length > MAX_ATTACHMENT_BYTES) throw badRequest(`File too large (max ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB)`);
  const kind = sniff(buf);
  if (!kind) throw badRequest("Only JPEG, PNG, WEBP, HEIC images or PDF files are allowed");
  const now = new Date();
  const rel = `attachments/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${kind.ext}`;
  const sha256 = createHash("sha256").update(buf).digest("hex");

  if (storageDriver() === "vercel-blob") {
    const { put } = await import("@vercel/blob");
    const res = await put(rel, buf, { access: "private", contentType: kind.mime, addRandomSuffix: false, allowOverwrite: false });
    return { storageKey: `${BLOB_PREFIX}${res.pathname}`, mimeType: kind.mime, size: buf.length, sha256 };
  }

  if (ON_VERCEL) {
    // Vercel's filesystem is read-only and wiped between requests — never silently lose a bill.
    throw badRequest("File storage is not configured: connect a Vercel Blob store to this project (Storage → Blob).");
  }
  const root = localRoot();
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { flag: "wx" });
  return { storageKey: rel, mimeType: kind.mime, size: buf.length, sha256 };
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function getFile(storageKey: string): Promise<Buffer> {
  if (storageKey.startsWith(BLOB_PREFIX)) {
    const { get } = await import("@vercel/blob");
    const res = await get(storageKey.slice(BLOB_PREFIX.length), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) throw badRequest("File not found in storage");
    return streamToBuffer(res.stream);
  }
  const root = localRoot();
  const full = path.resolve(root, storageKey);
  if (!full.startsWith(root + path.sep)) throw badRequest("Invalid file key");
  return readFile(full);
}
