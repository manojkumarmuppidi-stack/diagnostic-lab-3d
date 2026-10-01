-- Monthly expenses (rent, payroll, register lines with no day) are spread over the days of their
-- month in every day-level figure, instead of landing on one day. Month totals are unchanged.
ALTER TABLE "Expense" ADD COLUMN "spreadMonth" BOOLEAN NOT NULL DEFAULT false;

-- The flag only moves an expense between days of its own month, so it may be changed after entry.
DROP TRIGGER IF EXISTS immutable_expense ON "Expense";
CREATE TRIGGER immutable_expense BEFORE UPDATE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt', 'approvedById', 'approvedAt', 'spreadMonth');

-- Monthly-register lines imported with no day were dated on the last day of the month.
UPDATE "Expense" SET "spreadMonth" = true
 WHERE ("billNumber" LIKE 'REG-%' OR "billNumber" LIKE 'HP-REM-%' OR "billNumber" LIKE 'HP-SAL-%')
   AND "date" = (date_trunc('month', "date") + interval '1 month - 1 day')::date;

CREATE OR REPLACE VIEW v_expense_line AS
  SELECT ec."group"::text AS kind, e."date" AS date, e."amount" AS amount,
         e."categoryId" AS category_id, e."subcategoryId" AS subcategory_id,
         e."departmentId" AS department_id, e."paymentModeId" AS payment_mode_id,
         'Expense'::text AS source_table, e."id" AS source_id, false AS spread
    FROM "Expense" e JOIN "ExpenseCategory" ec ON ec."id" = e."categoryId"
   WHERE e."status" = 'ACTIVE' AND NOT e."spreadMonth"
  UNION ALL
  -- One line per day of the month; the last day takes the rounding remainder.
  SELECT ec."group"::text, d.day::date,
         (CASE WHEN d.day::date = m.last_day
               THEN e."amount" - ROUND(e."amount" / m.days, 2) * (m.days - 1)
               ELSE ROUND(e."amount" / m.days, 2) END)::numeric(12,2),
         e."categoryId", e."subcategoryId", e."departmentId", e."paymentModeId",
         'Expense', e."id", true
    FROM "Expense" e
    JOIN "ExpenseCategory" ec ON ec."id" = e."categoryId"
    CROSS JOIN LATERAL (
      SELECT date_trunc('month', e."date")::date AS first_day,
             (date_trunc('month', e."date") + interval '1 month - 1 day')::date AS last_day,
             EXTRACT(day FROM date_trunc('month', e."date") + interval '1 month - 1 day')::int AS days
    ) m
    CROSS JOIN LATERAL generate_series(m.first_day, m.last_day, interval '1 day') AS d(day)
   WHERE e."status" = 'ACTIVE' AND e."spreadMonth"
  UNION ALL
  SELECT 'PHARMACY_PURCHASE', p."date", p."amount", NULL, NULL, NULL, p."paymentModeId",
         'PharmacyPurchase', p."id", false
    FROM "PharmacyPurchase" p WHERE p."status" = 'ACTIVE';
