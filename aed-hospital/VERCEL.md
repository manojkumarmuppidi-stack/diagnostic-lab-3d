# Deploying on Vercel + Neon

Target setup: **Vercel** (app) + **Neon PostgreSQL** (data) + **Vercel Blob, private** (bill photos),
all in the region closest to Hyderabad.

## 1. Neon: a dedicated project, close to India
Do **not** reuse a database another app already uses — table names such as `User` or `Session` would collide.
1. Neon → **New project** → name `aed-hospital`, Postgres 16+, region **AWS Asia Pacific (Singapore)**
   (or Mumbai if offered). The region cannot be changed later.
2. **Connect** → copy **two** strings for the `neondb` database:
   - **Pooled** (hostname contains `-pooler`) → becomes `DATABASE_URL`, with `&pgbouncer=true` added.
   - **Direct** (connection pooling OFF) → becomes `DIRECT_URL` (used only for migrations).
   Both end with `?sslmode=require`.
3. Settings → **History retention** → raise to your plan's maximum (6 hours is not enough to recover
   from a mistake noticed the next day). Keep the nightly backup from BACKUP_RECOVERY.md as well.

## 2. Tables and first admin: automatic on deploy
You don't need a terminal. Vercel runs `npm run vercel-build` (`scripts/vercel-build.mjs`). That script runs
`prisma migrate deploy`, then the base seed, then `next build`. Every step is safe to repeat on each deploy:
- Migrations that are already applied are skipped.
- The seed only creates what is missing. It never changes customised roles, rates or data.
- The `admin` user is created once, from `SEED_ADMIN_PASSWORD`. Remove that variable after the first successful deploy.

The build stops with a clear message if `DIRECT_URL` is missing or points at the pooler, or if
`SEED_DEMO_DATA=true` on a production deploy.

## 3. Optional: a restricted app role
In Neon → **SQL Editor** (as the owner), run the SQL in DEPLOYMENT.md step 4 to create `aed_app`. Then use
its **pooled** URL for `DATABASE_URL`. Keep `DIRECT_URL` on the owner, because migrations need it.
With this role the running app cannot delete financial rows, edit amounts or disable the guards.

## 4. Vercel project
1. Vercel → **Add New → Project** → import `aed-hospital-analytics` from GitHub.
   Framework: Next.js (auto-detected). Leave the Build/Install/Output settings at their defaults.
2. Add the variables from step 5 **before** clicking Deploy.
3. After the project exists: **Storage → Create → Blob** → `aed-bills` → **Private** → connect it to this
   project. This adds `BLOB_READ_WRITE_TOKEN`.
4. **Settings → Functions → Function Region** → the region next to your Neon database (Singapore = `sin1`).
5. **Deployments → Redeploy**, so the Blob token and region take effect.

## 5. Environment variables (Settings → Environment Variables)
| Name | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** URL + `&pgbouncer=true` |
| `DIRECT_URL` | Neon **direct** URL (host without `-pooler`), used for migrations during the build |
| `SEED_ADMIN_PASSWORD` | strong temporary password, **first deploy only**, then delete it |
| `COOKIE_SECURE` | `true` |
| `APP_TIMEZONE` | `Asia/Kolkata` |
| `SESSION_TTL_HOURS` | `12` |
| `BLOB_READ_WRITE_TOKEN` | added by step 4.3 |

Never set `SEED_DEMO_DATA` or `UPLOAD_DIR` on Vercel.

## 6. Check it
From your computer, with the production values:
```bash
DATABASE_URL="<pooled url>&pgbouncer=true" DIRECT_URL="<direct url>" BLOB_READ_WRITE_TOKEN="<token>" \
  NODE_ENV=production COOKIE_SECURE=true npm run check:deploy -- --vercel
```
Open `https://<your-app>.vercel.app/api/health` → `{"status":"ok","db":"ok"}`.
Sign in as `admin` → change the password → Master Data (rates, doctors) → Users → Settings → Excel Import.

## Vercel-specific behaviour (already handled in the code)
- **Uploads**: bill photos are resized in the browser (≤ 2000 px JPEG) and stored in the **private** Blob store;
  they are only ever streamed through the signed-in app. Limit per file: 4 MB (Vercel's request limit is 4.5 MB).
- **Excel import**: files up to 4 MB per upload (split bigger files by month). Commits are batched —
  5,000 rows commit in about 4 s — and each request is allowed 60 s.
- **PDF reports**: font files are bundled explicitly for the serverless function.
- **Releases with schema changes**: run `npm run db:migrate` from your computer with `DIRECT_URL` before
  (or right after) deploying. The build itself does not touch the database.

## Locked out of the `admin` login

The password cannot be read back (only a one-way hash is stored). If another Admin / CEO can sign in, they reset it under **Staff logins → Edit → Reset password**. If nobody can:

1. Vercel → your project → **Settings → Environment Variables** → add `ADMIN_RESET_PASSWORD` with a temporary password (at least 8 characters), for Production.
2. **Deployments → ⋯ → Redeploy** the latest deployment.
3. Sign in as `admin` with that temporary password; the app makes you choose a new one immediately.
4. **Delete `ADMIN_RESET_PASSWORD`** from Vercel. (Each value is applied only once, so leaving it does not keep resetting the password — but it should not stay stored.)

The reset re-enables the `admin` login, signs it out everywhere and is written to the Audit Log.
