# Changelog

All notable changes to the AED Hospital Financial, Accounting & Operational Analytics System.

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
