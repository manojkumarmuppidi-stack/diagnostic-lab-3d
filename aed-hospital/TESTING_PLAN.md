# Testing Plan

| Layer | Tool | Location | Needs |
|---|---|---|---|
| Unit | Vitest | `tests/unit` | nothing |
| Integration | Vitest + real PostgreSQL | `tests/integration` | `TEST_DATABASE_URL` (default `postgresql://aed:aed_dev_pw@localhost:5432/aed_test`); migrations run automatically |
| End-to-end | Playwright (desktop + Pixel 7) | `tests/e2e` | a running app on a **disposable demo database** (`SEED_DEMO_DATA=true`) |

```bash
npm test                        # unit + integration (110 tests)
SKIP_DB_SETUP=1 npm run test:unit
BASE_URL=http://localhost:3000 npm run test:e2e      # add PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome if needed
```

## Coverage by requirement

| Area | Tests |
|---|---|
| Income / expense / net result, zero revenue, zero expense, negatives, paise rounding | `unit/accounting.test.ts`, `integration/transactions.test.ts` |
| Consultation classification & KPIs | `unit/accounting`, `unit/import-parsing` (New/Old words), `integration` (correction flips NEW→OLD) |
| Lab calculations (master rate × qty − discount, tests = Σ qty) | `integration/transactions`, `unit/import-normalize` |
| Pharmacy (net sales, returns, purchases, margin, no double counting) | `unit/accounting`, `integration/transactions` |
| IPD (advance, settlement, refund > collected rejected, outstanding) | `unit/accounting`, `integration/transactions` |
| Period comparison (like-for-like, full, FY April, custom, zero base) | `unit/periods`, `unit/accounting` |
| Excel import (header detection, mapping, dates, amounts, modes, totals rows, missing dates, invalid rows, new masters, multi-sheet, CSV) | `unit/import-*`, `integration/import` |
| Duplicate detection (in-file, DB, re-upload, Admin override) | `unit/import-parsing`, `integration/import` |
| Daily closing (state machine, variance explanation, stale reconciliation, closed-day lock, reopen with reason) | `unit/permissions`, `integration/transactions` |
| Corrections (supersede, audit before/after, approval, no self-approval) | `integration/transactions` |
| Permissions (server-side 403s, masking, role matrix) | `unit/permissions`, `integration/*`, `e2e` |
| Audit logs & DB guards (delete/update blocked) | `integration/transactions`, `e2e` |
| Batch reversal | `integration/import` |
| Workflows in a real browser (login, drill-down, quick add, import, reports PDF/Excel, RBAC, mobile no-overflow) | `e2e/*.spec.ts` |

## Edge cases explicitly covered
Zero revenue · zero expense · discounts > amount · refunds · duplicate Excel upload · invalid Excel rows · missing dates · negative transactions · reopened day · % change from a zero base · month-end clipping · IST vs UTC "today" · abbreviation matching ambiguity.

## Per-phase checklist (run before each release)
1. `npm run typecheck && npm run lint`
2. `npm test`
3. `npx prisma migrate status` (no drift)
4. `npm run build`, then E2E against a seeded disposable DB
5. Manual responsive check at 390 px, 768 px and 1440 px
6. Reconcile one demo day by hand against Daily Accounts
