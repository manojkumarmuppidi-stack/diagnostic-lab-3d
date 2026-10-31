-- Expense heads for payments found in the bank statement: donations, vehicles and other capital
-- purchases, and a working partner's remuneration (under Salaries & Wages). Only added when missing.
INSERT INTO "ExpenseCategory" ("id", "name", "group", "updatedAt")
SELECT 'cat_donations', 'Donations', 'OTHER', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ExpenseCategory" WHERE lower("name") = 'donations' AND "parentId" IS NULL);

INSERT INTO "ExpenseCategory" ("id", "name", "group", "updatedAt")
SELECT 'cat_equipment_capital', 'Equipment (capital)', 'OTHER', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ExpenseCategory" WHERE lower("name") = 'equipment (capital)' AND "parentId" IS NULL);

INSERT INTO "ExpenseCategory" ("id", "name", "group", "parentId", "updatedAt")
SELECT 'cat_vehicles', 'Vehicles', 'OTHER', c."id", NOW()
  FROM "ExpenseCategory" c
 WHERE lower(c."name") = 'equipment (capital)' AND c."parentId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "ExpenseCategory" s WHERE s."parentId" = c."id" AND lower(s."name") = 'vehicles')
 LIMIT 1;

INSERT INTO "ExpenseCategory" ("id", "name", "group", "parentId", "updatedAt")
SELECT 'cat_partner_remuneration', 'Partner remuneration', c."group", c."id", NOW()
  FROM "ExpenseCategory" c
 WHERE lower(c."name") = 'salaries & wages' AND c."parentId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "ExpenseCategory" s WHERE s."parentId" = c."id" AND lower(s."name") = 'partner remuneration')
 LIMIT 1;
