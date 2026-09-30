// Vercel runs `npm run vercel-build` instead of `build` when it exists.
// It applies pending migrations and the (idempotent) base seed, then builds — so a deploy
// alone sets up a fresh database; no terminal needed. Safe on every deploy:
//  - migrations already applied are skipped;
//  - the seed only creates what is missing and never touches customised roles, rates or data;
//  - the admin user is created only once, from SEED_ADMIN_PASSWORD (delete that variable afterwards).
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const fail = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set (Vercel → Settings → Environment Variables).");
if (!process.env.DIRECT_URL) fail("DIRECT_URL is not set: add the Neon DIRECT (non-pooler) connection string — migrations need it.");
if (process.env.DIRECT_URL.includes("-pooler")) fail("DIRECT_URL points at the Neon pooler; use the direct connection string (host without -pooler).");
if (process.env.SEED_DEMO_DATA === "true" && process.env.VERCEL_ENV === "production")
  fail("SEED_DEMO_DATA=true on a production deploy — remove it; demo data must never enter the live books.");

run("npx prisma migrate deploy");
run("npx tsx prisma/seed.ts");
run("npx next build");
