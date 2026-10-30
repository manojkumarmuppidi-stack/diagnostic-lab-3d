-- Hormonal Pharmacy as a department in department accounts, to see its performance beside the others:
-- income = its net sales and costs = its supplier purchases, both read from the core accounts, plus the
-- pharmacists' salaries entered for it. Department accounts only; the core accounts do not change.
INSERT INTO "ServiceDepartment" ("id", "name", "keywords", "sortOrder", "updatedAt")
SELECT 'dept_pharmacy', 'Hormonal Pharmacy', 'stream:PHARMACY', 140, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ServiceDepartment" WHERE "name" = 'Hormonal Pharmacy');
