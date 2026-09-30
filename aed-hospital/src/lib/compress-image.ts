"use client";
/**
 * Shrink phone photos before upload: bills photographed at 12 MP are 4–8 MB, above Vercel's
 * 4.5 MB request limit and slow on mobile data. Resizes to ≤ 2000 px on the long side and
 * re-encodes as JPEG (~300–700 KB) — still sharp enough to read a bill. PDFs and small images
 * are sent unchanged; formats the browser cannot decode (e.g. HEIC on Chrome) are sent as-is.
 */
const MAX_SIDE = 2000;
const SKIP_BELOW = 900 * 1024;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < SKIP_BELOW || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
