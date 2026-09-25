# AED Hospital — Financial, Accounting & Operational Analytics System

**Client:** AED Hospital, KPHB, Hyderabad
**Scope:** Integrated income, expenditure, accounting, daily closing, reconciliation, historical Excel import and operational analytics. It runs as a responsive web app and PWA on desktop, tablet, Android and iPhone.

Companion documents:

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, request flow, module registry, security model |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Entities, relationships, indexes, DB-level protections |
| [ACCOUNTING_RULES.md](ACCOUNTING_RULES.md) | **Exact** definition of every metric shown in the UI |
| [EXCEL_IMPORT_SPEC.md](EXCEL_IMPORT_SPEC.md) | Templates, column mapping, validation, duplicates, batches |
| [TESTING_PLAN.md](TESTING_PLAN.md) | Unit / integration / E2E strategy and edge cases |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environment variables, commands, production checklist |
| [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) | Database/file backup, restore, disaster recovery |
| [CHANGELOG.md](CHANGELOG.md) | Development history |

---

## 1. Requirements (summary)

### 1.1 Income streams
| Stream | Captured in | Recognised as income |
|---|---|---|
| OPD | `Consultation` | Net amount on consultation date |
| IPD | `IpdAdmission` + `IpdTransaction` | Collections (advance, payment, final settlement) less refunds, on collection date |
| Laboratory & diagnostics | `LabTransaction` | Net amount on test date |
| Pharmacy | `PharmacySale`, `PharmacyReturn` | Net sales less returns, on sale/return date |
| Diet & Nutrition | `DietTransaction` | Net amount on service date |
| Other income | `OtherIncome` | Amount on receipt date |

### 1.2 Expenditure
| Kind | Captured in |
|---|---|
| Hospital operating expenses | `Expense` in a category with group `HOSPITAL` |
| Other expenses | `Expense` in a category with group `OTHER` |
| Pharmacy purchases (stock) | `PharmacyPurchase` (never in `Expense`, which prevents double counting) |

### 1.3 Functional modules (navigation)
1. Dashboard: today's figures and period comparison, with alerts
2. Daily Accounts: per-day statement, payment-mode split and closing workflow
3. OPD
4. IPD: admissions, advances, payments, refunds, settlement, outstanding
5. Laboratory: configurable investigation master
6. Pharmacy: sales, purchases, returns and margin
7. Diet & Nutrition
8. Expenses: categories/subcategories, bill attachments (camera on mobile)
9. Accounting & Reconciliation: reconciliation by mode, correction approvals, day status
10. Analytics: Revenue, OPD, IPD, Lab, Pharmacy, Expense, Profitability
11. Reports: 13 report types, exported as Excel, CSV or PDF
12. Excel Import: templates, smart mapping, validation, duplicates, history, batch reversal
13. Excel Export: raw transaction export per module
14. Master Data
15. Users & Permissions
16. Audit Log
17. Settings: alert thresholds, fiscal year, hospital profile

Global search, quick-add actions (+OPD, +IPD, +LAB, +PHARMACY, +EXPENSE) and drill-down from every dashboard number are cross-cutting features.

### 1.4 Non-functional
- Responsive, mobile-first layout: bottom navigation and a quick-add button on phones, expanded tables on desktop.
- The PWA is installable. The service worker caches only the app shell and never caches financial API responses.
- Server-side permission enforcement on every API route.
- Append-only audit trail. Financial rows cannot be deleted (a DB trigger blocks it).
- All amounts are `NUMERIC(12,2)` in PostgreSQL. Aggregation happens in SQL, not in floating point.
- All analytics use the **transaction date**, never the upload or entry date.
- Business timezone is `Asia/Kolkata`. "Today" is computed in IST on the server.

## 2. Roles & permissions

| Role | Summary |
|---|---|
| `ADMIN` (Admin / CEO) | Everything, including reopening days, approving corrections, overriding duplicate protection, reversing imports, user and role management |
| `ACCOUNTS` | All income and expense entry, daily accounts, reconciliation, closing, correction approval, reports, import/export |
| `RECEPTION` | OPD entry and view, diet entry |
| `IPD_STAFF` | IPD admissions and payments |
| `LAB_STAFF` | Laboratory transactions |
| `PHARMACY` | Pharmacy sales, purchases, returns |
| `MANAGEMENT` | Read-only dashboards, analytics and reports. Patient names are masked. |

The permission catalogue and default role matrix are in `src/lib/permissions.ts`. The Admin can change the matrix at runtime in **Users & Permissions**. Every API handler calls `requirePermission()`; the UI hides controls only as a convenience.

## 3. Accounting definitions
See [ACCOUNTING_RULES.md](ACCOUNTING_RULES.md). In short:

```
Gross Income           = OPD + IPD collections + Lab + Pharmacy net sales + Diet + Other income
Total Expenses         = Hospital operating expenses + Pharmacy purchases + Other expenses
Net Operating Result   = Gross Income − Total Expenses
Pharmacy Gross Margin  = Pharmacy net sales − Pharmacy purchases   (separate view)
```

## 4. Daily closing
`OPEN → REVIEW → RECONCILED → CLOSED` (Admin can reopen: `CLOSED → OPEN`, a reason is mandatory and the event is logged).
- On a `CLOSED` day nobody can create, correct or void transactions. Corrections become **correction requests** that an approver must approve.
- Any change on a `RECONCILED` day sends it back to `REVIEW` automatically, because the reconciliation is stale.
- Closing requires a saved reconciliation. Every non-zero variance needs an explanation.

## 5. Corrections & deletion
- No transaction is edited in place. A correction marks the original `SUPERSEDED` and creates a new row with `correctionOfId → original`. The reason, user and timestamp go to the audit log.
- Void is a soft delete (`status = VOIDED`) and requires a reason.
- Reversing an import batch sets every row of the batch to `REVERSED`.
- Analytics count only `ACTIVE` rows.

## 6. Import structure
See [EXCEL_IMPORT_SPEC.md](EXCEL_IMPORT_SPEC.md). Upload (xlsx/xls/csv) → pick sheet(s) → auto-suggested column mapping → manual correction → validation (errors, warnings, duplicates) → confirm → import in a DB transaction → history → optional batch reversal.

## 7. Analytics calculations
See ACCOUNTING_RULES.md §4–§6. All analytics read two SQL views, `v_income_line` and `v_expense_line`. These views are the single source of truth for income and expense lines, so dashboards, reports, analytics and drill-down cannot disagree.

## 8. API structure
All routes live under `/api`, return JSON unless they are downloads, and are protected by a session cookie and permission checks.

| Route | Methods | Purpose |
|---|---|---|
| `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/password` | POST/GET | Session management |
| `/api/tx/[module]` | GET, POST | List (filters, search, paging, totals) / create transaction |
| `/api/tx/[module]/[id]` | GET | Record + history |
| `/api/tx/[module]/[id]/correct` | POST | Correct (supersede) or raise a correction request |
| `/api/tx/[module]/[id]/void` | POST | Soft-delete with reason |
| `/api/ipd/[id]/discharge` | POST | Record discharge date |
| `/api/expenses/[id]/attachments` | GET, POST | Bill/receipt upload & list |
| `/api/attachments/[id]` | GET | Authenticated file download |
| `/api/corrections`, `/api/corrections/[id]` | GET, POST | Correction request queue / approve / reject |
| `/api/masters`, `/api/masters/[type]`, `/api/masters/[type]/[id]` | GET, POST, PATCH | Master data |
| `/api/dashboard` | GET | Dashboard metrics for a period + comparison + alerts |
| `/api/analytics/[kind]` | GET | revenue / opd / ipd / lab / pharmacy / expense / profitability |
| `/api/daily/[date]` | GET | Daily account statement |
| `/api/daily/[date]/status` | POST | review / close / reopen |
| `/api/daily/[date]/reconciliation` | GET, PUT | Reconciliation by payment mode |
| `/api/daily` | GET | Day status list (calendar) |
| `/api/import/upload` | POST | Upload file, create batch(es) |
| `/api/import/[batchId]` | GET, DELETE | Batch detail / cancel un-committed batch |
| `/api/import/[batchId]/validate` | POST | Apply mapping + validate |
| `/api/import/[batchId]/rows` | GET, PATCH | Review rows; per-row duplicate decision |
| `/api/import/[batchId]/commit` | POST | Import |
| `/api/import/[batchId]/reverse` | POST | Reverse entire batch (Admin) |
| `/api/import/[batchId]/errors` | GET | Error rows as .xlsx |
| `/api/import/history` | GET | Import history |
| `/api/templates/[module]` | GET | Downloadable template (.xlsx) |
| `/api/export/[module]` | GET | Raw transaction export (xlsx/csv) |
| `/api/reports/[type]` | GET | Report JSON / xlsx / csv / pdf |
| `/api/search` | GET | Global search |
| `/api/users`, `/api/users/[id]`, `/api/roles`, `/api/roles/[id]` | GET, POST, PATCH | Users and role-permission matrix |
| `/api/audit` | GET | Audit log query |
| `/api/settings` | GET, PUT | Settings & alert thresholds |

## 9. Testing strategy
See [TESTING_PLAN.md](TESTING_PLAN.md): Vitest unit tests (pure calculation, period, import parsing/mapping, duplicate, permission and state-machine logic), Vitest integration tests against a real PostgreSQL test database (services, closing locks, corrections, imports, reversal, audit, analytics sums) and Playwright E2E tests for the critical workflows.

## 10. Out of scope / known limitations
- This is not a full double-entry general ledger. It is an income and expense (operating cash) system with controls. Journal-level GL, GST filing and inventory valuation are out of scope.
- Pharmacy gross margin uses **purchases as a proxy for cost of goods sold**. Without stock valuation this is only accurate over periods where stock levels are stable. See ACCOUNTING_RULES.md §3.
- Daily-total (summary) historical spreadsheets are not imported as transactions. See EXCEL_IMPORT_SPEC.md §9.
