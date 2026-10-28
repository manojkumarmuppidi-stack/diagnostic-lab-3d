/**
 * Nightly JJ Wellness sync: the JJ Wellness workbook lives in Google Drive. A Google service account
 * that the file is shared with (Viewer) downloads it every night and the workbook goes through the
 * normal import pipeline as the sync user, so only new package payments are added (see
 * convertJjWorkbook) and closed days are never touched. Manual upload of the same file keeps working.
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  the service account's JSON key (whole file contents)
 *   JJ_WELLNESS_FILE_ID          the Drive file id (from its link: /d/<id>/)
 *   JJ_SYNC_USERNAME             login the imports are recorded under (default "admin")
 *   CRON_SECRET                  Vercel sends it with the nightly call; other callers are refused
 */
import { createSign } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../authz";
import { cancelBatch, commitBatch, uploadFile, validateBatch } from "./import";

const SETTING_KEY = "jjWellnessSync";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function actorForUsername(username: string): Promise<Actor> {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!user || !user.active) throw new AppError(500, `Sync user "${username}" not found or disabled`, "CONFIG");
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleCode: user.role.code,
    roleName: user.role.name,
    permissions: new Set(user.role.permissions.map((rp) => rp.permission.code)),
    mustChangePassword: false,
    ip: null,
    userAgent: "nightly JJ Wellness sync",
  };
}

/** Upload → validate → commit every sheet without a person: only valid new rows are imported. */
export async function importUnattended(actor: Actor, fileName: string, buf: Buffer) {
  const up = await uploadFile(actor, fileName, buf);
  const sheets = [];
  for (const b of up.batches) {
    const v = await validateBatch(actor, b.id, { type: b.type, mapping: b.suggestion.mapping });
    const s = v.summary;
    if (s.valid + s.warnings > 0) {
      const r = await commitBatch(actor, b.id, { approveWarnings: true });
      sheets.push({ sheet: b.sheetName, imported: r.imported, amount: r.amount, duplicates: s.duplicates, invalid: s.invalid });
    } else {
      // Nothing new (every row already imported, or on a closed day): no batch is kept, so the nightly
      // run does not fill Import history with empty entries. Nothing was imported from it.
      await cancelBatch(actor, b.id);
      await prisma.importBatch.delete({ where: { id: b.id } });
      sheets.push({ sheet: b.sheetName, imported: 0, amount: 0, duplicates: s.duplicates, invalid: s.invalid });
    }
  }
  return {
    imported: sheets.reduce((a, s) => a + s.imported, 0),
    amount: Math.round(sheets.reduce((a, s) => a + s.amount, 0) * 100) / 100,
    sheets,
  };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function googleToken(): Promise<string> {
  let key: { client_email?: string; private_key?: string };
  try {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "");
  } catch {
    throw new AppError(500, "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON", "CONFIG");
  }
  if (!key.client_email || !key.private_key) throw new AppError(500, "GOOGLE_SERVICE_ACCOUNT_JSON lacks client_email / private_key", "CONFIG");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }),
  )}`;
  const signature = b64url(createSign("RSA-SHA256").update(unsigned).sign(key.private_key.replace(/\\n/g, "\n")));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new AppError(502, `Google sign-in failed (${res.status})`, "UPSTREAM");
  return ((await res.json()) as { access_token: string }).access_token;
}

async function driveFile(fileId: string) {
  const token = await googleToken();
  const auth = { Authorization: `Bearer ${token}` };
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const meta = await fetch(`${base}?fields=name,mimeType,modifiedTime&supportsAllDrives=true`, { headers: auth });
  if (meta.status === 404) throw new AppError(502, "The JJ Wellness file is not shared with the service account (or the file id is wrong)", "UPSTREAM");
  if (!meta.ok) throw new AppError(502, `Google Drive refused the file (${meta.status})`, "UPSTREAM");
  const m = (await meta.json()) as { name: string; mimeType: string; modifiedTime: string };
  // A native Google Sheet is exported as .xlsx; an uploaded .xlsx is downloaded as it is.
  const url = m.mimeType === "application/vnd.google-apps.spreadsheet" ? `${base}/export?mimeType=${encodeURIComponent(XLSX)}` : `${base}?alt=media&supportsAllDrives=true`;
  const body = await fetch(url, { headers: auth });
  if (!body.ok) throw new AppError(502, `Google Drive download failed (${body.status})`, "UPSTREAM");
  const name = /\.xlsx$/i.test(m.name) ? m.name : `${m.name}.xlsx`;
  return { name, modifiedTime: m.modifiedTime, buf: Buffer.from(await body.arrayBuffer()) };
}

export function jjSyncConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.JJ_WELLNESS_FILE_ID);
}

/** The nightly run. Skips the import when the file has not changed since the last successful sync. */
export interface JjSyncState {
  modifiedTime?: string;
  at?: string;
  imported?: number;
  amount?: number;
  /** Set when the last run failed; the Admin's bell shows it. */
  error?: string | null;
  errorAt?: string | null;
}

export async function jjSyncState(): Promise<JjSyncState | null> {
  return ((await prisma.setting.findUnique({ where: { key: SETTING_KEY } }))?.value as JjSyncState | undefined) ?? null;
}

async function saveState(value: JjSyncState) {
  const v = value as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: v }, update: { value: v } });
}

export async function syncJjWellness() {
  if (!jjSyncConfigured()) throw new AppError(503, "JJ Wellness sync is not set up (GOOGLE_SERVICE_ACCOUNT_JSON, JJ_WELLNESS_FILE_ID)", "CONFIG");
  const last = (await jjSyncState()) ?? {};
  try {
    const actor = await actorForUsername(process.env.JJ_SYNC_USERNAME || "admin");
    const file = await driveFile(process.env.JJ_WELLNESS_FILE_ID!);
    if (last.modifiedTime === file.modifiedTime && !last.error) return { skipped: "unchanged since the last sync", modifiedTime: file.modifiedTime };
    const result = await importUnattended(actor, file.name, file.buf);
    await saveState({ modifiedTime: file.modifiedTime, at: new Date().toISOString(), imported: result.imported, amount: result.amount, error: null, errorAt: null });
    return { modifiedTime: file.modifiedTime, ...result };
  } catch (e) {
    await saveState({ ...last, error: e instanceof AppError ? e.message : "Unexpected error (see Vercel logs)", errorAt: new Date().toISOString() });
    throw e;
  }
}
