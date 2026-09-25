# Deployment

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

## Docker (optional)
```Dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
```
