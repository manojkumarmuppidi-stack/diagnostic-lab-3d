# Accounting Rules & Metric Definitions

This document is the contract behind every number in the application. The code sources are:

- SQL views `v_income_line` and `v_expense_line`, defined in `prisma/migrations/20260925023300_views_and_guards/migration.sql`
- pure functions in `src/lib/accounting.ts`

Unit and integration tests pin each rule (see TESTING_PLAN.md).

## 1. Basis of accounting

| Rule | Detail |
|---|---|
| **Collections basis** | Income is recognised when money is received, on the **transaction date** (not the entry date and not the upload date). Daily reconciliation also counts cash, so both views agree. |
| Business date | Calendar date in **Asia/Kolkata**. "Today" is computed in IST on the server. |
| Record status | Only `ACTIVE` rows count. `SUPERSEDED` (corrected), `VOIDED` and `REVERSED` (import undone) rows are kept for audit and never counted. |
| Money | `NUMERIC(12,2)`, summed in PostgreSQL. JS rounding is half away from zero, to paise. |
| Discounts | Net = Amount − Discount. The discount can never exceed the amount. All income figures are **net**. |

## 2. Income streams (`v_income_line`)

| Stream | Source | Amount counted |
|---|---|---|
| OPD | `Consultation` | `netAmount` |
| IPD | `IpdTransaction` of an ACTIVE admission | `ADVANCE`, `PAYMENT`, `FINAL_SETTLEMENT` = +amount; `REFUND` = −amount |
| LAB | `LabTransaction` | `netAmount` (= rate × quantity − discount) |
| PHARMACY | `PharmacySale` / `PharmacyReturn` | sale `netAmount` (+) and return `amount` (−) |
| DIET | `DietTransaction` | `netAmount` |
| OTHER | `OtherIncome` | `amount` |

```
Gross Income (Total Income) = OPD + IPD + LAB + PHARMACY (net of returns) + DIET + OTHER
```

**IPD billed value vs IPD income.** `IpdAdmission.netAmount` is the billed value (accrual). It drives **Outstanding** but is *not* income. Income is only what was collected. Mixing billed IPD with collected OPD would double count the admission when it is later paid, so this rule is deliberate.

## 3. Expenditure (`v_expense_line`)

| Kind | Source |
|---|---|
| `HOSPITAL` (Hospital Operating Expenses) | `Expense` whose category group = HOSPITAL |
| `OTHER` (Other Expenses) | `Expense` whose category group = OTHER |
| `PHARMACY_PURCHASE` | `PharmacyPurchase` (stock) |

```
Total Expenses       = HOSPITAL + PHARMACY_PURCHASE + OTHER
Net Operating Result = Total Income − Total Expenses
```

**No double counting of pharmacy purchases.** Purchases live only in `PharmacyPurchase`. They are never an `Expense` category and never also subtracted as "cost of goods" in the operating view.

**Pharmacy view (separate):**
```
Total Sales       = Gross sales − Discount
Net Sales         = Total Sales − Returns
Gross Margin      = Net Sales − Purchases
Gross Margin %    = Gross Margin ÷ Net Sales × 100          (undefined when Net Sales = 0)
```
⚠ There is no stock valuation, so **purchases are a proxy for cost of goods sold**. The margin is reliable only over periods with stable stock, such as a month or quarter. A large stock-up week will show a misleadingly low margin.

## 4. Operational counts

| Metric | Definition |
|---|---|
| New / Old consultations | Count of ACTIVE `Consultation` by `visitType` |
| Total consultations | New + Old |
| IPD admissions | Count of ACTIVE `IpdAdmission` by **admission date** |
| Laboratory tests | Σ `quantity` of ACTIVE `LabTransaction` |
| Pharmacy transactions | Count of ACTIVE `PharmacySale` |
| Total patients | Distinct patients with an OPD, Lab or Diet line, or an IPD admission, in the period. Patient = Patient ID, else the lower-cased name. Pharmacy walk-ins are excluded because sales often carry no patient identity. |

## 5. Ratios (null / "—" when the denominator is 0)

| Metric | Formula |
|---|---|
| Net margin % | Net Operating Result ÷ Total Income × 100 |
| Revenue per patient | Total Income ÷ Total patients |
| Expense per patient | Total Expenses ÷ Total patients |
| Average consultation revenue | OPD income ÷ Total consultations |
| Revenue per IPD admission | IPD income ÷ Admissions in the period. Collections can relate to earlier admissions, so read this over longer periods. |
| Average lab revenue per test | Lab income ÷ Lab tests |
| New % | New ÷ Total consultations × 100 |
| Average daily expense | Total Expenses ÷ calendar days in the period |

## 6. Period comparison

- `diff = current − previous`
- `pct = diff ÷ |previous| × 100`. **When previous = 0, pct is undefined**: the UI shows "n/a" or "new (prev. 0)", never "∞%" or "100%".
- A running period (this week, month, quarter or year) is compared **like-for-like** by default: the same number of elapsed days in the previous period (Mon–Thu vs last Mon–Thu). "Full previous period" is available. Comparing a partial week with a full one always shows a false drop.
- Quarter and year follow the fiscal-year start month in Settings (default **April**, the Indian FY).
- A custom range is compared with the immediately preceding range of equal length, or with an explicit comparison range (e.g. year-on-year).

## 7. Controls (see also PROJECT_SPEC §4–5)

1. **Never overwrite.** A correction marks the original `SUPERSEDED` and inserts a new row (`correctionOfId`). A database trigger blocks updates to financial columns and blocks all deletes.
2. **Void** = status `VOIDED` + a mandatory reason.
3. **Closed day** = no create, correct or void by anyone. Corrections become requests. An approver (not the requester, unless Admin) applies them. The closing snapshot lets the UI flag "figures changed after closing".
4. **Reopen** = Admin only, mandatory reason, `DayEvent` + `AuditLog`, and `reopenCount` is incremented.
5. **Reconciliation** = the expected amount per mode comes from `v_income_line` (receipts net of refunds and returns). `Variance = Actual − Expected`. A non-zero variance needs an explanation. A day can close only if the saved expected amounts still match (no stale reconciliation).
6. **Audit** = every create, correct, void, approve, import, reversal, closing action, master change, user change, login and export writes an append-only `AuditLog` row with user, time, before/after, reason, IP and user-agent.

## Expense approval
- An expense entered by a user **without** `expense.approve` (every role except Admin by default) is stored with status `PENDING`. Every figure, view and report counts `ACTIVE` rows only, so a pending expense changes nothing until it is approved.
- **Approve** → `ACTIVE`, stamped with `approvedById`/`approvedAt`; the day's figures change, so a reconciled day goes back to review and a closed day must be reopened first.
- **Reject** → `VOIDED` with `voidReason = "Rejected: <reason>"`. The row is kept.
- The database status guard allows exactly `PENDING → ACTIVE` and `PENDING → VOIDED`; nothing can be moved back to `PENDING`. Amounts stay immutable while pending.
- A day cannot be closed while it has pending expenses.
- Expenses entered by an approver and rows imported from Excel are `ACTIVE` immediately.
- Payment mode default for new expenses (a suggestion; staff can change it): below ₹3,000 Cash, above ₹1,00,000 Bank Transfer, otherwise Card.

## AED Hospital totals (0.11.0 — supersedes the consolidated definitions above)
Every hospital total in the app is AED Hospital only: Total Income = OPD + IPD collections + Lab + Diet + Other; Total Expenses = HOSPITAL + OTHER expenses, excluding expenses booked to department "Pharmacy"; Net Result = Total Income − Total Expenses. Daily reconciliation compares AED collections only. The Hormonal Pharmacy (sales net of returns; stock purchases + pharmacy-department expenses) is a separate entity reported on its own.

## Entities: AED Hospital and Hormonal Pharmacy (supersedes "Segments" below)
- AED Hospital income = OPD + Lab + IPD collections + Diet + Other income. Expenses = every expense not tagged to the Pharmacy department.
- Hormonal Pharmacy income = pharmacy sales net of returns. Expenses = pharmacy purchases + expenses tagged to department "Pharmacy".
- Profit = income − expenses per entity; margin = profit ÷ income. Months with expenses but no income are reported as "income not recorded" and excluded from the profit figure shown.

## Segments: Hospital and Hormonal Pharmacy
- **Hormonal Pharmacy** = pharmacy net sales (after discount and returns) and pharmacy purchases (supplier invoices). Profit = Net sales − Purchases; Profit % = Profit ÷ Net sales. This is AED's monthly measure; it moves with stock build-up and sell-down, so the margin on medicines sold (taxable value − cost, ex-GST, from medicine lines) is shown beside it.
- **Hospital (without Hormonal Pharmacy)** = all other income streams − hospital and other expenses.
- The two segments add up to the consolidated Net Operating Result.

## Monthly expenses spread over the month
An expense flagged `spreadMonth` (rent, payroll, monthly register lines with no day) appears in `v_expense_line` as one line per day of its month: amount ÷ days, rounded to paise, with the last day taking the remainder. Month totals are unchanged. Such expenses are excluded from expenses paid by payment mode in daily reconciliation.

