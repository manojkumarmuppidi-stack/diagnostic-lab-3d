-- "Doctor fees" is paid per visit (e.g. consultation charges), so it is not a monthly item: picking it
-- must not spread the fee over the month. Monthly retainers have their own heads (Visiting doctor – …).
UPDATE "ExpenseHead" SET "monthly" = false WHERE "name" = 'Doctor fees';

-- Fees entered by hand from October 2026 with that head were spread by mistake: put them back on their day.
-- (Imported monthly register lines, which have no day, stay spread.)
UPDATE "Expense" e SET "spreadMonth" = false
  FROM "ExpenseHead" h
 WHERE h."id" = e."headId" AND h."name" = 'Doctor fees'
   AND e."spreadMonth" AND e."importBatchId" IS NULL AND e."date" >= DATE '2026-10-01';
