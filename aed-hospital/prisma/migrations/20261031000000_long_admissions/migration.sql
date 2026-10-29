-- Long admissions as their own department, next to Short admissions.
INSERT INTO "ServiceDepartment" ("id", "name", "keywords", "sortOrder", "updatedAt")
SELECT 'dept_long_admissions', 'Long admissions', 'long admission, long admissions, long adm',
       COALESCE((SELECT "sortOrder" FROM "ServiceDepartment" WHERE "name" = 'Short admissions'), 80) + 5, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ServiceDepartment" WHERE "name" = 'Long admissions');
