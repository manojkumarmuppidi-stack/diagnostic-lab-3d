# Architecture

```
Browser / PWA (React client components, Tailwind, Recharts)
   │  fetch /api/*  (httpOnly session cookie, same-origin)
   ▼
Next.js 15 App Router ── middleware.ts (cookie-presence redirect only)
   │
   ├─ src/app/(app)/*          pages (client components); layout.tsx validates the session on the server
   ├─ src/app/api/**/route.ts  thin handlers: api() wrapper → service → JSON / file
   │
   ├─ src/server/              server-only code
   │    api.ts        origin (CSRF) check, session lookup, error → HTTP mapping
   │    auth.ts       login (bcrypt, DB-backed throttling), sessions (SHA-256 token hashes), logout
   │    authz.ts      Actor type, requirePermission()   ← every service calls this
   │    audit.ts      append-only audit writer (same DB transaction as the change)
   │    closing.ts    day state machine, closed-day lock, auto-unreconcile
   │    services/     transactions · modules (per-module adapters) · analytics · dashboard
   │                  daily · import · reports · masters · misc (search, users, attachments, audit)
   │    spreadsheet.ts  xlsx/xls/csv readers with magic-byte + size checks
   │    exporters.ts    Excel (ExcelJS), CSV (formula-injection safe), PDF (pdfkit)
   │    storage.ts      attachment storage adapter (local disk; swap for S3/GCS)
   │
   ├─ src/lib/                 isomorphic, pure, unit-tested
   │    accounting.ts  every formula · periods.ts · dates.ts (IST) · money.ts
   │    modules.ts     module registry (fields, columns, templates, import aliases)
   │    schemas.ts     Zod input schemas shared by manual entry and import
   │    import/        mapping.ts · values.ts · normalize.ts · text.ts · fingerprint.ts
   │
   ▼
PostgreSQL ── tables + v_income_line / v_expense_line views + guard triggers
```

## Key design decisions

1. **Module registry.** Ten transaction types (OPD, IPD admission, IPD payment, lab, pharmacy sale/return/purchase, diet, other income, expense) share one generic create/correct/void/list service (`services/transactions.ts`) and one generic UI (`ModuleList`, `TransactionForm`). Each module only defines its adapter (`services/modules.ts`) and field metadata (`lib/modules.ts`). A new income type is one adapter plus one registry entry.
2. **One definition of income.** All analytics read two SQL views. Dashboard, reports, daily accounts and drill-down lists therefore cannot disagree.
3. **Same validation for typing and importing.** Imported rows are normalised (`lib/import/normalize.ts`), then validated by the same Zod schema and inserted through the same `insertRecord()` as manual entry, including closed-day and duplicate checks.
4. **Immutability in depth.** App-level rules (supersede, void, closed-day lock) are backed by DB triggers.
5. **Services take an `Actor`**, not a request, so integration tests call them directly against a real database.
6. **Drill-down through URLs.** List pages keep their filters in the query string (`/lab?from=…&to=…&investigationId=…`). Every KPI card and chart mark links to its underlying transactions.

## Security model
- Sessions: 256-bit random token in an httpOnly, SameSite=Lax cookie (Secure in production). Only its SHA-256 is stored. TTL is configurable. Disabling a user or changing their role or password deletes their sessions.
- Passwords: bcrypt (cost 12), strength rule, forced change on first login.
- Brute force: 5 failed logins per username / 20 per IP per 15 minutes (DB-backed, so it works across instances).
- Authorisation: permissions are loaded from the DB on every request and checked inside every service. The UI hides controls only as a convenience.
- CSRF: SameSite cookies plus an `Origin` host check on every non-GET request.
- Input: Zod on all inputs; Prisma parameterised queries; raw SQL only via `Prisma.sql` tagged templates.
- Uploads: size limit, extension + magic-byte sniffing, random storage keys, path-traversal guard, served with `nosniff` and a sandbox CSP.
- CSV export neutralises formula injection (`=`, `+`, `-`, `@`).
- Patient data: billing identity only (ID, name, optional phone). Names are masked for roles without `patients.view_identity` (Management by default).
- Headers: X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
- PWA: the service worker caches static assets only, never `/api/*`.
