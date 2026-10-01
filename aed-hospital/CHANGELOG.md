# Changelog

All notable changes to the AED Hospital Financial, Accounting & Operational Analytics System.

## 0.9.2: OneGlance OP bill collection export; exact payment modes
- A second OneGlance OPD export (BillNo, Bill Date, Visit Purpose, Cash / Online / Cheque / OneGlance Wallet) is recognised. It converts to OPD (and Diet) **with payment modes**: Online → UPI, Wallet → Other. A bill paid in two modes goes under the larger one, with the split in Remarks.
- That export has no consultation name. Specialty is General unless Visit Purpose names one. New/Old comes from the patient registration number: a bill whose patient ID is higher than every ID billed before it is a new registration.
- **Exact payment modes**: new modes **GPay** and **PhonePe** (both reconcile under UPI), alongside Cash, Card, UPI, Bank Transfer and Cheque. Imports record "cheque", "Google Pay" and "Phone Pe" as Cheque / GPay / PhonePe instead of the generic Bank / UPI.
- Expenses → Month-wise has a **by payment mode** view.
- Import duplicate check: a OneGlance OPD/diet bill already in the app (same `OP-<bill no>` on the same date) is flagged as a duplicate, even when the two exports disagree on specialty.

## 0.9.1: Cash book repeats are kept
- Cash-book lines without a cheque number get the cash-book row as their reference (`CB-412`). Genuine repeats on one day (three ₹10,000 payments to one doctor, several ₹1,000 per-case charges) are no longer dropped as duplicates; re-uploading the same cash book is still caught.

## 0.9.0: Hormonal Pharmacy as its own segment
- The pharmacy is now **Hormonal Pharmacy** everywhere (income stream, purchases, Analytics tab, reports, navigation).
- New page **Hormonal Pharmacy → accounts** (`/hormonal-pharmacy`), built for phones:
  - For any month: net sales, purchases, **profit = Sale − Purchase** and **profit %** (of net sales), compared with last month. For the current month the comparison is against the same days of last month.
  - Month by month for 12 months (chart + table with a 12-month total) and day by day with a running month-so-far profit and profit %.
  - Where medicine lines are imported, the **margin on medicines actually sold** (ex-GST) is shown beside it, with a note when stock build-up or sell-down makes Sale − Purchase misleading.
- Dashboard **By segment**: Hospital (without Hormonal Pharmacy) income, expenses, net; Hormonal Pharmacy net sales, purchases, profit and %. The consolidated Financial result is unchanged and equals the two added together.
- Cash book: staff token payments (salary top-ups, performance bonus) go to Salaries & Wages → **Incentives & bonus**; new head "Staff incentives & bonus".

## 0.8.0: Expense heads, approval and month-wise expenses
- **Expense heads** (Masters → Expense heads): recurring items such as rent, electricity, salaries, ESI/PF, TDS, milk, gas, oxygen and water cans. Each head has keywords, category/subcategory, payee, default payment mode, an optional typical amount and a "monthly" flag. The seed adds 36 generic heads with no amounts or names; the Admin fills those in.
- **One-word quick pick** in the expense form. Typing "rent", "milk" or "esi" shows the matching heads. Picking one fills the category, payee, description ("Milk – Sep 2026"), typical amount and payment mode.
- **Payment mode suggestion** from the amount: below ₹3,000 Cash, above ₹1,00,000 Bank Transfer, otherwise Card. The suggestion stops once staff pick a mode themselves.
- **Admin approval.** Expenses entered by staff (anyone without the new permission `expense.approve`) wait in Expenses → Waiting approval and are not counted until approved.
  - Approve counts the expense. Reject voids it with the reason.
  - Both are audited, and the dashboard shows an alert to approvers.
  - A day with waiting expenses cannot be closed.
  - The database guard allows only PENDING → ACTIVE/VOIDED.
- **Monthly checklist**: for any month, every recurring head marked as entered, waiting approval or not entered, with last month's amount and an Add button.
- **Month-wise** view: approved expenses by category, subcategory or head × month (pharmacy purchases as their own line), with CSV download.
- **Cash book import**: a cash book with Date/Description/Debit/Credit/Balance columns is recognised.
  - Debit lines become expenses, split by month, with the category taken from the description.
  - Dates that Excel had read month-first are corrected from the neighbouring rows.
  - The payment mode is estimated from the amount.
  - Verified on AED's Jan–Aug 2026 cash book: 1,452 payments, ₹35.36 L, 82 dates corrected.
- **Wellness programme costs**: new department "Wellness" and two monthly heads tagged to it, "Wellness – revenue share" (JJ Wellness, paid a share of wellness-patient revenue under an MOU) and "Wellness – staff salaries". Analytics → Expenses → by department shows them together.
- **No double counting of pharmacy stock**: cash-book payments to a pharmacy supplier whose invoices come from OneGlance (Vijaya Pharma — surgicals, mostly IPD) import as supplier payments, not expenses (₹29,761 in the Jan–Aug cash book).
- New categories: MOU partners (with subcategory Revenue share), Doctor & consultant fees, Referral fees, Outsourced lab tests, Taxes & compliance, Staff welfare, Equipment (capital), Patient refunds. New subcategories: OT technicians, Security, Uniforms, Bio-medical waste.

## 0.7.0: One-page daily summary PDF
- New **Daily summary** page (`/daily-summary?date=…`), opened from the Dashboard button **Day summary PDF**. It is one A4 portrait page on white paper, whatever the screen theme. It shows:
  - total income vs the same weekday last week, vs yesterday, and vs a typical weekday (average of the last four with activity)
  - patients, consultations (New/Old), lab tests, pharmacy bills and margin, admissions, expenses and net
  - income by stream vs last week, collections by payment mode, the last 14 days, stream split, top tests and top medicines
  - up to 6 plain-language insights
- It has previous/next day and a date picker. `?print=1` opens the print dialog automatically (choose "Save as PDF").
- Board Meeting PDF fix: with real data, slides spilled onto a second page (24 pages for 15 slides) and printed in the narrow layout. Now each slide is exactly one landscape page: tall slides are zoomed to fit and the wide layout is pinned in print. The daily sheet uses a named portrait page, and the deck's dark print background is scoped to the deck.

## 0.6.1: Fix Analytics crash when switching tabs
- Switching from one Analytics tab to another rendered the new tab with the previous tab's data for a moment and crashed ("Application error: a client-side exception"). The API now tags each response with its `kind`, and the page only renders data for the tab that is open.
- New E2E test switches every tab on every tabbed page and fails on any client-side exception.

## 0.6.0: Supplier payments, open invoices and product search
- New `SupplierPayment` table (migration `20261001010000_supplier_payments`, DB-guarded). Payments are **not** expenses, because the purchase invoices already are.
- The OneGlance **Pharmacy Invoice Report** is recognised. The cheque/UTR and the invoice numbers are read from "Details", tolerating typos like "INVOICDE NO".
- Analytics → Pharmacy → **Suppliers — purchased vs paid**. Per supplier it shows invoices, purchased, paid, open invoices and value, oldest open invoice, last payment, and the average days from invoice to payment. An invoice is "paid" when a payment to that supplier lists its number.
- Global search finds **medicines** (units sold in the last 30 days → opens the medicine's units per week/month) and **test counts** (opens the test's week/month counts). Analytics accepts `?medicine=` and `?investigationId=` deep links.
- The analytics-only import path is generalised (medicine lines, supplier payments share validation, duplicate detection, commit and reversal).
- Verified on AED data: 126 payments (₹71.75 L) settle 403 invoices, mostly from before April. The average credit taken is 56 days.

## 0.5.0: Medicine-wise pharmacy analytics
- New `PharmacyItem` / `PharmacyItemLine` tables (migration `20261001000000_pharmacy_items`) with the same DB guards (no deletes, immutable values, final reversal). Medicine lines are analytics only: pharmacy income stays collections and purchase expense stays invoices, so nothing is counted twice.
- The OneGlance **Purchase/Sales Report** is recognised in both views. **Sales view** becomes medicine lines: units, bill, value incl. GST, taxable value and cost. **Purchase view** becomes one pharmacy purchase (expense) per supplier invoice, plus medicine purchase lines (supplier, manufacturer, batch, expiry, free units). New import type "Pharmacy medicine lines" with its own template for other sources.
- Analytics → Pharmacy:
  - Real bill count and average bill value.
  - Margin on medicines sold (sale value − cost, ex-GST).
  - A searchable medicine table with units, previous period, bills, value and margin.
  - Search such as "janumet" totals all strengths and shows units per day/week/month.
  - Top medicines and purchases by supplier.
- Board Meeting: the pharmacy section uses real bills and margin, plus slides for top medicines by sales value and by units.
- Verified on AED's Apr–Sep 2026 export: 49,239 lines in 14,681 bills. Monthly totals match the Pharmacy Collection Report's billed amount (e.g. Jun ₹46,80,663 vs ₹46,80,669).

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
