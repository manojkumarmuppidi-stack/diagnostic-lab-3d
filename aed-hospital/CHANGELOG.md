# Changelog

All notable changes to the AED Hospital Financial, Accounting & Operational Analytics System.

## 0.4.1: Test-wise lab counts
- Analytics → Laboratory → **Test-wise counts**: every test performed in the period with this period vs previous, change, revenue and average. It has a search box ("ECG") and sort by volume, revenue, biggest change or least performed. Tests done last period but not this one are listed with 0.
- Click a test to see it day by day, week by week or month by month (follows "Group by"). The panel shows total, revenue, average per week and the busiest week, and links to the transactions.
- Board Meeting: new slide "Laboratory — tests performed, test by test". It shows the top 16 tests with this period, previous, change and per-week average.

## 0.4.0: OneGlance HMS import
- The importer recognises OneGlance exports (Outpatient Collection, Bill Item Wise Collection, Pharmacy Collection) and converts them to OPD/Diet, Lab and Pharmacy records, split by month. Lab Bill Collection is refused with guidance. See EXCEL_IMPORT_SPEC.md §8a.
- "Check all months → Import all months" panel for recognised reports.
- Browser gzips uploads over 1 MB, so large HMS exports fit Vercel's request limit (40 MB uncompressed max).
- Fix: new master names longer than about 20 characters were rejected during import validation.
- Fix: fuzzy matching no longer matches across meaning-changing words or numbers ("New" ↔ "Old", "T3" ↔ "T4").
- Import results count only master entries actually created.
- Verified on AED's Apr–Sep 2026 exports: OPD, lab and pharmacy monthly totals match OneGlance to the rupee.

## 0.3.1: Zero-terminal Vercel setup
- `vercel-build` applies migrations and the idempotent base seed before `next build`, so importing the repo on Vercel sets up a fresh Neon database without a terminal.
- The build fails fast when `DIRECT_URL` is missing, `DIRECT_URL` is a pooler URL, or demo data is enabled on production.

## [0.3.0] — 2026-09-25 — Vercel deployment
### Added
- **Private Vercel Blob storage** for bill attachments (automatic when `BLOB_READ_WRITE_TOKEN` is set); files are only streamed to signed-in users. Refuses to write to Vercel's ephemeral disk rather than silently losing bills.
- Browser-side photo compression (≤ 2000 px JPEG) before upload; upload limit 4 MB on Vercel.
- `DIRECT_URL` for migrations so the app can use Neon's pooled connection (`pgbouncer=true`) on serverless.
- VERCEL.md step-by-step guide; `check:deploy` validates pooled/direct URLs and Blob connectivity (`--vercel`).
### Changed
- Import commit is batched (cached lookups within the operation, one INSERT per 500 rows, bulk staging-row rewrite): 5,000 rows 38 s → ~4 s, largely independent of database latency.
- 60 s function time limit declared on import, report, export and board-pack routes; pdfkit font files bundled for serverless.

## [0.2.1] — 2026-09-25 — Deployment readiness
### Added
- `npm run check:deploy`: read-only readiness check of env vars, database version/latency, migrations, accounting views, guard triggers, role ownership, seed state, master rates and demo data (PASS/WARN/FAIL, exit code 1 on FAIL).
- `/api/health` probe, production `Dockerfile` + `.dockerignore`, `engines` (Node ≥ 20.9).
- DEPLOYMENT.md: step-by-step for your own PostgreSQL (direct vs pooled URLs, SSL, restricted app role).
### Verified
- Fresh clone → `npm ci` → migrate → seed → build → run as a restricted role: all workflows succeed; the role cannot truncate, delete, edit amounts, disable triggers or drop views.

## [0.2.0] — 2026-09-25 — Insights & Board Meeting pack

### Added
- **Insight engine** (`src/lib/insights.ts`): plain-English findings from current-vs-previous figures — biggest riser/faller, concentration risk, mix shift, activity that stopped, KPI moves, costs growing faster than revenue, operating loss. Every insight shows the numbers behind it and links to the transactions.
- **Insights & comparison panels** on OPD, IPD, Laboratory, Pharmacy, Diet, Expenses, every Analytics tab and Daily Accounts (vs the same weekday last week): KPI deltas, comparison bars (current vs previous) and share pies with a table view for every chart.
- **Dashboard**: key-insights strip and comparison bars + pies for income by stream, expenditure and payment modes.
- **Board Meeting pack** (`/meeting`): 12-slide presentation — cover, executive summary, six-month trend, revenue mix (pies this vs last period), operations & collections, one slide per department, key findings with method notes. Full-screen slideshow (← → keys, Esc), prints one slide per A4-landscape page (Save as PDF).
- Month-to-date ranges compare with the same days of the previous month; compact period labels ("1–25 Sep 2026").
- 7 new unit/integration tests (117 total).

### Changed
- Removed the old per-module KPI strip (superseded by the comparison KPIs).
- Compact currency drops trailing zeros (₹60 L, not ₹60.00 L); chart legends use text colours; pie slices beyond the sixth fold into "Other" with a distinct neutral.
- Demo seed posts monthly bills even when the 5th falls on a Sunday.

## [0.1.0] — 2026-09-25

### Phase 1 — Project setup
- Next.js 15 (App Router) + TypeScript + Tailwind + PostgreSQL/Prisma project in `aed-hospital/`, alongside the existing 3D lab viewer (unchanged).
- Design documents: PROJECT_SPEC, ARCHITECTURE, DATABASE_SCHEMA, ACCOUNTING_RULES, EXCEL_IMPORT_SPEC, TESTING_PLAN, DEPLOYMENT, BACKUP_RECOVERY.
- Database-backed session authentication (bcrypt, hashed tokens, login throttling), base layout with sidebar, mobile bottom navigation, PWA manifest and service worker.

### Phase 2 — Master data & users
- Masters: departments, specialties, doctors/dieticians, consultation types, admission types, IPD packages, lab investigations, diet services, 2-level expense categories, payment modes. Deactivate-only (no deletes).
- Seven roles with a runtime-editable permission matrix, enforced server-side; patient-name masking.

### Phase 3 — Transactions
- OPD, IPD (admissions + advance/payment/settlement/refund), laboratory, pharmacy (sales/returns/purchases), diet, other income. Generic create / correct / void with duplicate warnings and master-rate auto-fill.

### Phase 4 — Expenses & accounting
- Expenses with bill/receipt attachments (camera capture on phones, magic-byte validated).
- SQL views `v_income_line` / `v_expense_line` as the single accounting definition; pharmacy purchases counted once.

### Phase 5 — Daily closing & reconciliation
- OPEN → REVIEW → RECONCILED → CLOSED workflow, reconciliation by Cash/Card/UPI/Bank/Other with mandatory variance explanations, Admin reopen with reason, closing snapshot, correction requests with approval.
- DB triggers forbid deleting financial rows and editing their amounts.

### Phase 6 — Excel import/export
- Import centre: xlsx/xls/csv, multi-sheet, header detection, smart mapping with fixed values, validation summary, error workbook, duplicate detection (in-file + DB + file hash), warnings approval, Admin duplicate override, import history, batch reversal.
- Templates for every module plus combined income/expenditure; raw transaction export (Excel/CSV).

### Phase 7 — Analytics & dashboards
- Executive dashboard with 12 period presets, like-for-like comparison, KPI drill-down, alerts.
- Analytics: revenue, OPD, IPD, laboratory, pharmacy, expense, profitability — interactive charts with table views and click-to-drill.

### Phase 8 — Reports
- 13 reports (daily … historical comparison) with on-screen preview and Excel / CSV / PDF export.

### Phase 9 — Audit & security
- Append-only audit log with before/after diff, IP and device; audit viewer. CSRF origin checks, security headers, CSV formula-injection protection.

### Phase 10 — Testing & deployment
- 110 Vitest unit/integration tests (real PostgreSQL) and 8 Playwright E2E tests (desktop + mobile).
- Deployment, backup and recovery documentation; realistic, clearly fictional demo seed (~4 months).

### Fixed during verification
- `round2(1.005)` returned 1.00 (binary float noise) → precision-corrected rounding.
- Recharts axes wrapped in fragments were not rendered → axes are now direct children.
- A wide table on the dashboard caused horizontal scroll (and zoom-out) on phones → grid cards can shrink (`min-width: 0`).
- Abbreviated test names ("Diab Profile") did not match masters during import → unique token-prefix matching.
