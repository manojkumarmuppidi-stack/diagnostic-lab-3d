/**
 * Deployment readiness check — run it against the database you will use in production:
 *
 *   DATABASE_URL="postgresql://…" npm run check:deploy
 *
 * It never changes data. Each line is PASS / WARN / FAIL; the exit code is 1 when any FAIL.
 */
import { existsSync, readdirSync, readFileSync, accessSync, constants, mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Load .env (without overriding variables already set in the shell / host).
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

type Level = "PASS" | "WARN" | "FAIL" | "INFO";
const results: { level: Level; area: string; msg: string }[] = [];
const add = (level: Level, area: string, msg: string) => results.push({ level, area, msg });

const REQUIRED_TRIGGERS = [
  "no_delete_consultation",
  "no_delete_auditlog",
  "no_delete_expense",
  "immutable_consultation",
  "immutable_expense",
  "immutable_auditlog",
  "status_guard_consultation",
];

function checkEnv() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    add("FAIL", "env", "DATABASE_URL is not set");
    return null;
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    add("FAIL", "env", "DATABASE_URL is not a valid URL (special characters in the password must be URL-encoded, e.g. @ → %40)");
    return null;
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) add("FAIL", "env", `DATABASE_URL must start with postgresql:// (got ${u.protocol})`);
  const host = u.hostname;
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  add("INFO", "env", `Database host: ${host}, database: ${u.pathname.slice(1) || "(default)"}, user: ${decodeURIComponent(u.username)}`);
  if (!local && !/sslmode=(require|verify-full|verify-ca)/.test(u.search)) {
    add("WARN", "env", "Remote database without sslmode=require — add ?sslmode=require (Neon, Supabase, RDS all support it)");
  }
  const pooled = /-pooler\.|pgbouncer=true|:6543\b/.test(url);
  const direct = process.env.DIRECT_URL;
  if (pooled && !/pgbouncer=true/.test(url)) add("FAIL", "env", "DATABASE_URL is a pooled connection but lacks pgbouncer=true — append &pgbouncer=true");
  else if (pooled) add("PASS", "env", "DATABASE_URL uses the connection pooler with pgbouncer=true (correct for Vercel)");
  if (!direct) add(pooled ? "FAIL" : "WARN", "env", "DIRECT_URL is not set — migrations need the direct (non-pooled) URL; locally it can equal DATABASE_URL");
  else if (/-pooler\.|:6543\b/.test(direct)) add("FAIL", "env", "DIRECT_URL points at the pooler — it must be the direct connection (hostname without -pooler)");
  else add("PASS", "env", "DIRECT_URL set for migrations");
  const prod = process.env.NODE_ENV === "production" || process.argv.includes("--production");
  if (prod && process.env.COOKIE_SECURE !== "true") add("FAIL", "env", "COOKIE_SECURE must be true in production (serve over HTTPS)");
  else if (process.env.COOKIE_SECURE === "true") add("PASS", "env", "COOKIE_SECURE=true");
  else add("WARN", "env", "COOKIE_SECURE is not true — fine for local testing, required in production");
  if (process.env.SEED_DEMO_DATA === "true") add(prod ? "FAIL" : "WARN", "env", "SEED_DEMO_DATA=true — never seed demo data into the production database");
  const ttl = Number(process.env.SESSION_TTL_HOURS || 12);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 72) add("WARN", "env", `SESSION_TTL_HOURS=${process.env.SESSION_TTL_HOURS} — use 1–72`);
  const tz = process.env.APP_TIMEZONE || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    add("PASS", "env", `Business timezone ${tz}`);
  } catch {
    add("FAIL", "env", `APP_TIMEZONE "${tz}" is not a valid IANA timezone`);
  }
  const vercel = !!process.env.VERCEL || process.argv.includes("--vercel");
  const blob = process.env.STORAGE_DRIVER === "vercel-blob" || (!process.env.STORAGE_DRIVER && !!process.env.BLOB_READ_WRITE_TOKEN);
  if (blob) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) add("FAIL", "storage", "STORAGE_DRIVER=vercel-blob but BLOB_READ_WRITE_TOKEN is missing");
    else add("INFO", "storage", "Bill attachments: private Vercel Blob store (checked below)");
  } else if (vercel) {
    add("FAIL", "storage", "On Vercel the disk is not persistent: connect a Vercel Blob store (Storage → Blob) so BLOB_READ_WRITE_TOKEN is set");
  } else {
    const dir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      add("PASS", "storage", `Upload directory writable: ${dir}`);
      if (prod) add("WARN", "storage", "Make sure the upload directory is on a persistent, backed-up volume (container disks are wiped on redeploy)");
    } catch {
      add("FAIL", "storage", `Upload directory not writable: ${dir}`);
    }
  }
  return u;
}

async function checkDb() {
  const prisma = new PrismaClient();
  try {
    const t0 = Date.now();
    const [v] = await prisma.$queryRaw<{ server_version_num: string; current_user: string; tz: string }[]>`
      SELECT current_setting('server_version_num') AS server_version_num, current_user, current_setting('TimeZone') AS tz`;
    const ms = Date.now() - t0;
    const ver = Number(v.server_version_num);
    add(ver >= 140000 ? "PASS" : "FAIL", "database", `Connected in ${ms} ms — PostgreSQL ${Math.floor(ver / 10000)}.${ver % 100} (needs 14+)`);
    if (ms > 500) add("WARN", "database", "High latency to the database — host the app in the same region (e.g. Mumbai / ap-south-1)");

    // Migrations
    const dirs = existsSync("prisma/migrations") ? readdirSync("prisma/migrations").filter((d) => /^\d+_/.test(d)) : [];
    const hasTable = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = '_prisma_migrations'`;
    if (!Number(hasTable[0].n)) {
      add("FAIL", "migrations", "No migrations applied — run: npm run db:migrate");
      return;
    }
    const applied = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    const done = new Set(applied.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name));
    const failed = applied.filter((m) => !m.finished_at && !m.rolled_back_at);
    const missing = dirs.filter((d) => !done.has(d));
    if (failed.length) add("FAIL", "migrations", `Failed migration(s): ${failed.map((m) => m.migration_name).join(", ")} — see DEPLOYMENT.md`);
    if (missing.length) add("FAIL", "migrations", `Not applied: ${missing.join(", ")} — run: npm run db:migrate`);
    else add("PASS", "migrations", `All ${dirs.length} migrations applied`);

    // Accounting views & guards
    const views = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.views WHERE table_name IN ('v_income_line', 'v_expense_line')`;
    add(views.length === 2 ? "PASS" : "FAIL", "controls", views.length === 2 ? "Accounting views present (v_income_line, v_expense_line)" : "Accounting views missing — migrations incomplete");
    const trig = await prisma.$queryRaw<{ tgname: string; tgenabled: string }[]>`SELECT tgname, tgenabled FROM pg_trigger WHERE NOT tgisinternal`;
    const names = new Map(trig.map((t) => [t.tgname, t.tgenabled]));
    const absent = REQUIRED_TRIGGERS.filter((t) => !names.has(t));
    const disabled = trig.filter((t) => t.tgname.startsWith("no_delete_") || t.tgname.startsWith("immutable_") || t.tgname.startsWith("status_guard_")).filter((t) => t.tgenabled === "D");
    if (absent.length) add("FAIL", "controls", `Guard triggers missing: ${absent.join(", ")}`);
    else if (disabled.length) add("FAIL", "controls", `Guard triggers DISABLED: ${disabled.map((t) => t.tgname).join(", ")}`);
    else add("PASS", "controls", `${trig.filter((t) => /^(no_delete_|immutable_|status_guard_)/.test(t.tgname)).length} guard triggers active (no deletes, no in-place edits of amounts)`);

    // Privileges: the app should not own the tables (an owner can disable triggers / truncate)
    const owner = await prisma.$queryRaw<{ tableowner: string }[]>`SELECT tableowner FROM pg_tables WHERE tablename = 'Consultation'`;
    if (owner[0]?.tableowner === v.current_user) {
      add("WARN", "security", `The app connects as the table owner "${v.current_user}". Recommended: a separate app role without ownership (see DEPLOYMENT.md §Production checklist 2)`);
    } else add("PASS", "security", `App role "${v.current_user}" does not own the tables`);

    // Seed state
    const [roles, perms, admins, activeAdmins, modes, specialties, invZero, invTotal, demo, users, settings] = await Promise.all([
      prisma.role.count(),
      prisma.permission.count(),
      prisma.user.findMany({ where: { role: { code: "ADMIN" } }, select: { username: true, mustChangePassword: true, active: true } }),
      prisma.user.count({ where: { active: true, role: { code: "ADMIN" } } }),
      prisma.paymentMode.count({ where: { active: true } }),
      prisma.specialty.count(),
      prisma.labInvestigation.count({ where: { active: true, rate: 0 } }),
      prisma.labInvestigation.count({ where: { active: true } }),
      prisma.patient.count({ where: { patientCode: { startsWith: "DEMO-" } } }),
      prisma.user.count(),
      prisma.setting.count(),
    ]);
    if (roles < 7 || perms < 30) add("FAIL", "seed", `Roles/permissions not seeded (${roles} roles, ${perms} permissions) — run: npm run db:seed`);
    else add("PASS", "seed", `${roles} roles and ${perms} permissions`);
    if (!activeAdmins) add("FAIL", "seed", "No active Admin user — run: npm run db:seed (needs SEED_ADMIN_PASSWORD)");
    else {
      const seeded = admins.find((a) => a.username === "admin" && a.active);
      if (seeded && seeded.mustChangePassword) add("WARN", "seed", 'The seeded "admin" account still has its initial password — sign in and change it now');
      else add("PASS", "seed", `${activeAdmins} active Admin user(s)`);
    }
    add(modes >= 5 ? "PASS" : "FAIL", "masters", `${modes} active payment modes`);
    add(specialties >= 5 ? "PASS" : "WARN", "masters", `${specialties} specialties`);
    if (invZero) add("WARN", "masters", `${invZero} of ${invTotal} lab investigations have rate ₹0 — set real rates in Master Data before billing`);
    else add("PASS", "masters", `All ${invTotal} active investigations have rates`);
    const doctors = await prisma.doctor.count({ where: { active: true } });
    if (!doctors) add("WARN", "masters", "No doctors yet — add them in Master Data");
    if (demo) add(process.env.NODE_ENV === "production" || process.argv.includes("--production") ? "FAIL" : "WARN", "data", `${demo} DEMO patients found — this database contains fictional demo data`);
    else add("PASS", "data", "No demo data");
    add(settings ? "PASS" : "WARN", "settings", settings ? "Hospital settings saved" : "Settings not saved yet (defaults are used)");
    add("INFO", "data", `${users} user account(s)`);

    // Round-trip a read on the views (catches permission problems)
    await prisma.$queryRaw`SELECT COUNT(*) FROM v_income_line`;
    add("PASS", "database", "App role can read the accounting views");
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n").filter(Boolean).slice(-1)[0] : String(e);
    add("FAIL", "database", `Cannot use the database: ${msg}`);
    if (/P1001|ECONNREFUSED|ETIMEDOUT|getaddrinfo|Can't reach/i.test(String(e))) add("INFO", "database", "Check host/port, that the database allows your IP, and that sslmode=require is set for hosted databases");
    if (/password authentication failed|P1000/i.test(String(e))) add("INFO", "database", "Wrong user or password in DATABASE_URL (URL-encode special characters)");
  } finally {
    await prisma.$disconnect();
  }
}

async function checkBlob() {
  const blob = process.env.STORAGE_DRIVER === "vercel-blob" || (!process.env.STORAGE_DRIVER && !!process.env.BLOB_READ_WRITE_TOKEN);
  if (!blob || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { list } = await import("@vercel/blob");
    await list({ limit: 1 });
    add("PASS", "storage", "Vercel Blob store reachable with BLOB_READ_WRITE_TOKEN");
  } catch (e) {
    add("FAIL", "storage", `Vercel Blob store not reachable: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  console.log("\nAED Hospital — deployment readiness check\n");
  const url = checkEnv();
  if (url) await checkDb();
  await checkBlob();
  const icon: Record<Level, string> = { PASS: "✔ PASS", WARN: "! WARN", FAIL: "✘ FAIL", INFO: "· INFO" };
  for (const r of results) console.log(`${icon[r.level]}  [${r.area}] ${r.msg}`);
  const fails = results.filter((r) => r.level === "FAIL").length;
  const warns = results.filter((r) => r.level === "WARN").length;
  console.log(`\n${fails ? "NOT READY" : warns ? "READY WITH WARNINGS" : "READY"} — ${fails} fail, ${warns} warning(s)\n`);
  console.log("Not checked automatically: backups (BACKUP_RECOVERY.md), HTTPS certificate, and a restore test.\n");
  process.exit(fails ? 1 : 0);
}

main();
