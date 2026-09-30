# Deployment

## Deploy with your own PostgreSQL — step by step

Verified end-to-end on a fresh PostgreSQL 16 database with the app running as a restricted role
(every workflow: entry, correction, attachments, import/commit/reverse, reconcile/close/reopen,
users/roles, reports, board pack, logout).

1. **Get two connection strings** from your PostgreSQL provider:
   - the **owner/admin** one (used only for migrations), and
   - later, the **app** one (step 4).
   - **Own server / Docker** (long-running process): use the **direct** connection for both
     `DATABASE_URL` and `DIRECT_URL`.
   - **Vercel / serverless**: `DATABASE_URL` = **pooled** connection with `&pgbouncer=true`,
     `DIRECT_URL` = direct connection (for migrations). Full guide: [VERCEL.md](VERCEL.md).
   Hosted databases need `?sslmode=require` at the end of the URL. URL-encode special characters
   in passwords (`@` → `%40`, `#` → `%23`).
2. **Create the tables, views and guards** (from a machine that can reach the database):
   ```bash
   git clone https://github.com/manojkumarmuppidi-stack/aed-hospital-analytics && cd aed-hospital-analytics
   npm ci
   DATABASE_URL="<owner url>" DIRECT_URL="<owner url>" npm run db:migrate
   ```
3. **Seed roles, permissions, masters and the first admin** (no demo data):
   ```bash
   DATABASE_URL="<owner url>" DIRECT_URL="<owner url>" SEED_ADMIN_PASSWORD="<strong temporary password>" SEED_DEMO_DATA=false npm run db:seed
   ```
4. **Create the restricted app role** (run as the owner, in your provider's SQL editor or psql; replace names):
   ```sql
   CREATE ROLE aed_app LOGIN PASSWORD '<strong password>';
   GRANT CONNECT ON DATABASE <your_db> TO aed_app;
   GRANT USAGE ON SCHEMA public TO aed_app;
   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO aed_app;
   GRANT DELETE ON "Session", "ImportRecord", "RolePermission" TO aed_app;  -- non-financial housekeeping only
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO aed_app;
   ```
   With this role the app **cannot** truncate, delete financial rows, edit amounts, disable the guard
   triggers or drop the views (all verified).
5. **Run the readiness check** with the app URL:
   ```bash
   DATABASE_URL="<app url>" NODE_ENV=production COOKIE_SECURE=true npm run check:deploy
   ```
   Fix every `FAIL`. Expected `WARN`s on a brand-new hospital: initial admin password, lab rates ₹0,
   no doctors yet — these are resolved in the app after the first login.
6. **Deploy the app** (any Node 20+ host or Docker) with these environment variables:
   `DATABASE_URL=<app url>`, `COOKIE_SECURE=true`, `NODE_ENV=production`, `UPLOAD_DIR=<persistent volume path>`,
   `APP_TIMEZONE=Asia/Kolkata`. Build `npm run build`, start `npm start` (uses `$PORT`), or use the `Dockerfile`.
   Health check path: **`/api/health`** (returns 503 if the database is unreachable).
7. **First login**: sign in as `admin` → forced password change → Master Data (rates, doctors) →
   Users (named accounts) → Settings (FY April, thresholds) → Excel Import (history).
8. Configure **backups** before real data goes in (BACKUP_RECOVERY.md), and re-run step 5.

> Future migrations: run `npm run db:migrate` with the **owner** URL on each release; the default
> privileges above give the app role access to new tables automatically.

## Requirements
Node.js 20+ (tested on 22), PostgreSQL 14+ (tested on 16), HTTPS termination (reverse proxy or platform), and a persistent, backed-up volume **or** object storage for bill attachments.

## Environment variables (`.env.example`)
| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✔ | PostgreSQL connection string |
| `SESSION_TTL_HOURS` | | Default 12 |
| `COOKIE_SECURE` | ✔ in prod | `true` behind HTTPS |
| `SEED_ADMIN_PASSWORD` | first seed | Initial `admin` password (forced change on first login) |
| `SEED_DEMO_DATA` | | `true` only for demo/test databases; **never in production** |
| `UPLOAD_DIR` | | Attachment directory (mount a backed-up volume) |
| `MAX_UPLOAD_MB` | | Default 10 |
| `APP_TIMEZONE` | | Default `Asia/Kolkata` |

No secrets are hard-coded. Store them in the platform's secret manager.

## Commands
```bash
npm ci                     # installs and runs `prisma generate`
npm run db:migrate         # prisma migrate deploy (tables, views, guard triggers)
npm run db:seed            # roles, permissions, masters, admin user (idempotent)
npm run build
npm start                  # PORT=3000 by default
```

## Production checklist
1. Serve **only over HTTPS**; set `COOKIE_SECURE=true`.
2. Create two DB roles: a **migration owner** (runs `db:migrate`) and an **app role** with only `SELECT, INSERT, UPDATE` on tables and `USAGE` on sequences. The app role cannot `TRUNCATE`, `DROP` or disable the guard triggers:
   ```sql
   CREATE ROLE aed_app LOGIN PASSWORD '…';
   GRANT CONNECT ON DATABASE aed_hospital TO aed_app;
   GRANT USAGE ON SCHEMA public TO aed_app;
   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO aed_app;
   GRANT DELETE ON "Session", "ImportRecord", "RolePermission" TO aed_app;  -- non-financial housekeeping
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO aed_app;
   ```
3. Set **master rates** (investigations, consultation types, packages, diet services). Production seeding sets them to 0 on purpose.
4. Add doctors, dieticians and the real users; disable or rename the `admin` account after creating named Admins.
5. Set Settings → financial year start (April) and alert thresholds.
6. Configure backups (BACKUP_RECOVERY.md) **before** going live, and test a restore.
7. For multi-instance deployments, use object storage for attachments (replace `src/server/storage.ts`).
8. For `.xls` support in production, install SheetJS 0.20.3 from cdn.sheetjs.com (see EXCEL_IMPORT_SPEC.md §10).

## Suggested hosting
- **Single hospital server / VM**: Ubuntu + PostgreSQL + Node behind Nginx (Let's Encrypt), run as a systemd service (`npm start`).
- **Managed**: any Node host (Render, Railway, Fly.io, AWS App Runner) + managed PostgreSQL (e.g. AWS RDS or Supabase in the Mumbai region, for data residency) + S3-compatible storage.

## Docker
A production `Dockerfile` is included (multi-stage, runs as non-root, health check on `/api/health`,
uploads at `/data/uploads` — mount a persistent volume there). Note it runs `prisma migrate deploy`
on start, which needs owner rights: either give the container the owner URL only for the first
start, or run migrations separately (step 2) and start with `CMD ["npm","start"]`.
```bash
docker build -t aed-hospital .
docker run -p 3000:3000 -e DATABASE_URL="<url>" -e COOKIE_SECURE=true -v aed_uploads:/data/uploads aed-hospital
```
