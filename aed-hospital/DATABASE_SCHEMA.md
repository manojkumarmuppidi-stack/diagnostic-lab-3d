# Database Schema

PostgreSQL 14+ via Prisma. Source of truth: `prisma/schema.prisma` plus the migrations in `prisma/migrations/`.

## Entity map

```
Role ─< RolePermission >─ Permission            User >─ Role        Session >─ User
Department ─< Doctor >─ Specialty              LoginAttempt
AdmissionType ─< IpdPackage                    Setting (key/value JSON)
LabInvestigation >─ Department
ExpenseCategory ─< ExpenseCategory (subcategories, 2 levels)
PaymentMode (reconGroup: CASH/CARD/UPI/BANK/OTHER)
Patient (patientCode unique; name; phone) — no clinical data

Consultation   >─ Patient, Doctor, Specialty, ConsultationType, PaymentMode, ImportBatch
IpdAdmission   >─ Patient, AdmissionType, Doctor, IpdPackage, ImportBatch
  └─< IpdTransaction (ADVANCE/PAYMENT/FINAL_SETTLEMENT/REFUND) >─ PaymentMode
LabTransaction >─ Patient, LabInvestigation, Doctor (referring), Department, PaymentMode
PharmacySale   >─ Patient, PaymentMode          PharmacyReturn >─ PaymentMode
PharmacyPurchase >─ PaymentMode                 DietTransaction >─ Patient, DietService, Doctor (dietician)
OtherIncome >─ PaymentMode                      Expense >─ ExpenseCategory (×2), Department, PaymentMode
  └─< Attachment (bill/receipt files)

DailyAccount (one per date) ─< DayEvent, ─< Reconciliation (per reconGroup)
CorrectionRequest (module, entityId, proposed JSON, status)
ImportBatch ─< ImportRecord (raw row, normalized, status, errors, warnings, fingerprint)
AuditLog (append-only)
```

## Mapping to the entities in the brief

| Requested | Implemented as |
|---|---|
| User, Role, Permission | `User`, `Role`, `Permission`, `RolePermission` |
| Patient, Doctor, Department, Specialty | same names (`Doctor.kind` distinguishes dieticians) |
| Consultation | `Consultation` |
| IPDAdmission, IPDTransaction | `IpdAdmission`, `IpdTransaction` |
| LaboratoryInvestigation, LaboratoryTransaction | `LabInvestigation`, `LabTransaction` |
| PharmacySale / Purchase / Return | same |
| DietTransaction, Expense, ExpenseCategory | same (+ `DietService`, `Attachment`) |
| Payment | `PaymentMode` master + `paymentModeId` on each row; IPD money movements are `IpdTransaction` |
| DailyAccount, Reconciliation | `DailyAccount` (+ `DayEvent`), `Reconciliation` |
| ImportBatch, ImportRecord, AuditLog | same |

## Common columns on every financial table

| Column | Purpose |
|---|---|
| `status` | `ACTIVE` / `SUPERSEDED` / `VOIDED` / `REVERSED`. A DB trigger allows only ACTIVE → other, once. |
| `fingerprint` | Duplicate-detection key (date + patient + reference + service + amount), indexed |
| `importBatchId` | Set for imported rows; used for batch reversal |
| `correctionOfId` | Unique; points to the row this one corrects |
| `voidReason`, `createdById`, `createdAt`, `updatedAt` | Audit context |

Indexes: `(date, status)` on every transaction table (all analytics filter on these), plus `fingerprint`, `importBatchId` and FK indexes.

## Database-level protections (migration `…_views_and_guards`)

- `aed_forbid_delete`: BEFORE DELETE triggers on all financial tables, `AuditLog`, `DayEvent` and `Attachment`.
- `aed_guard_immutable(allowed…)`: BEFORE UPDATE triggers. Only `status`, `voidReason` and `updatedAt` may change (plus `dischargeDate`/`remarks` on admissions and `admissionId` on IPD payments, when an admission is corrected). `AuditLog` is fully immutable.
- `aed_guard_status`: status can leave ACTIVE once and never return.
- Views `v_income_line` and `v_expense_line`: the single definition of income and expense lines.

These guards hold even against a buggy code path or a manual SQL session. `TRUNCATE` (used by test fixtures and full restores) needs the table-owner privilege, so production should run the app as a role that is **not** the table owner (see DEPLOYMENT.md).

## ExpenseHead (0.8.0)
Recurring expense heads for the one-word quick pick and the monthly checklist. `name` (unique), `keywords` (comma separated), `categoryId` (top-level category), `subcategoryId` (must belong to it), `departmentId`, `vendor`, `defaultMode` (payment-mode code; empty = suggest from amount), `typicalAmount` (optional), `monthly` (appears in the checklist as "not entered" when missing), `active`, `sortOrder`.
`Expense` gains `headId`, `approvedById`, `approvedAt`. `RecordStatus` gains `PENDING` (expenses waiting for approval). Migrations `20261002000000_record_status_pending`, `20261002000100_expense_heads_approval`.

