import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
const get = vi.fn();
vi.mock("@vercel/blob", () => ({ put, get }));

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const env = { ...process.env };

async function load() {
  vi.resetModules();
  return import("@/server/storage");
}

describe("attachment storage", () => {
  beforeEach(() => {
    put.mockReset();
    get.mockReset();
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("uses a PRIVATE Vercel Blob when BLOB_READ_WRITE_TOKEN is set", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    put.mockResolvedValue({ pathname: "attachments/2026/09/x.jpg" });
    const s = await load();
    expect(s.storageDriver()).toBe("vercel-blob");
    const r = await s.putFile(JPEG);
    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^attachments\/\d{4}\/\d{2}\/[0-9a-f-]+\.jpg$/), JPEG, expect.objectContaining({ access: "private", contentType: "image/jpeg", allowOverwrite: false }));
    expect(r.storageKey).toBe("blob:attachments/2026/09/x.jpg");
    expect(r.sha256).toHaveLength(64);
  });

  it("reads blobs back through the SDK (never via a public URL)", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    get.mockResolvedValue({ statusCode: 200, stream: new Blob([JPEG]).stream() });
    const s = await load();
    const buf = await s.getFile("blob:attachments/2026/09/x.jpg");
    expect(get).toHaveBeenCalledWith("attachments/2026/09/x.jpg", { access: "private", useCache: false });
    expect(buf.equals(JPEG)).toBe(true);
  });

  it("refuses to write to disk on Vercel without a Blob store (files would be lost)", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.VERCEL = "1";
    const s = await load();
    expect(s.storageDriver()).toBe("local");
    await expect(s.putFile(JPEG)).rejects.toThrow(/Vercel Blob/);
    expect(s.MAX_ATTACHMENT_BYTES).toBe(4 * 1024 * 1024);
  });

  it("still validates type and size before storing", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const s = await load();
    await expect(s.putFile(Buffer.from("not an image"))).rejects.toThrow(/Only JPEG/);
    expect(put).not.toHaveBeenCalled();
  });
});
