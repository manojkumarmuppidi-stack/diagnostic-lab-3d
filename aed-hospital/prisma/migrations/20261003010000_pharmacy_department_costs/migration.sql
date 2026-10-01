-- Hormonal Pharmacy is a separate entity. Expenses booked to department "Pharmacy" (pharmacy staff,
-- its share of costs) are pharmacy costs: they get the same kind as stock purchases, so every
-- AED Hospital total (which sums HOSPITAL + OTHER) leaves them out.
CREATE OR REPLACE VIEW v_expense_line AS
  SELECT CASE WHEN dep."name" = 'Pharmacy' THEN 'PHARMACY_PURCHASE' ELSE ec."group"::text END AS kind, e."date" AS date, e."amount" AS amount,
         e."categoryId" AS category_id, e."subcategoryId" AS subcategory_id,
         e."departmentId" AS department_id, e."paymentModeId" AS payment_mode_id,
         'Expense'::text AS source_table, e."id" AS source_id, false AS spread
    FROM "Expense" e JOIN "ExpenseCategory" ec ON ec."id" = e."categoryId"
    LEFT JOIN "Department" dep ON dep."id" = e."departmentId"
   WHERE e."status" = 'ACTIVE' AND NOT e."spreadMonth"
  UNION ALL
  -- One line per day of the month; the last day takes the rounding remainder.
  SELECT CASE WHEN dep."name" = 'Pharmacy' THEN 'PHARMACY_PURCHASE' ELSE ec."group"::text END, d.day::date,
         (CASE WHEN d.day::date = m.last_day
               THEN e."amount" - ROUND(e."amount" / m.days, 2) * (m.days - 1)
               ELSE ROUND(e."amount" / m.days, 2) END)::numeric(12,2),
         e."categoryId", e."subcategoryId", e."departmentId", e."paymentModeId",
         'Expense', e."id", true
    FROM "Expense" e
    JOIN "ExpenseCategory" ec ON ec."id" = e."categoryId"
    LEFT JOIN "Department" dep ON dep."id" = e."departmentId"
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
