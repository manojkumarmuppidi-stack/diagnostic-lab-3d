-- Department profit: each income department's own expenses, pharmacy margin (GLP injections) with the
-- staff incentive on them, and a profit-sharing partner (JJ Wellness 20%).
ALTER TABLE "ServiceDepartment" ADD COLUMN "expenseDepartments" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ServiceDepartment" ADD COLUMN "pharmacyItems" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ServiceDepartment" ADD COLUMN "pharmacyIncentivePct" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "ServiceDepartment" ADD COLUMN "partnerName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ServiceDepartment" ADD COLUMN "partnerSharePct" DECIMAL(5,2) NOT NULL DEFAULT 0;

UPDATE "ServiceDepartment" SET "expenseDepartments" = 'Radiology' WHERE "name" = 'USG scan room';
UPDATE "ServiceDepartment" SET "expenseDepartments" = 'Cardiology' WHERE "name" = 'Cardiac (2D Echo, TMT, ECG)';
UPDATE "ServiceDepartment" SET "expenseDepartments" = 'Diet & Nutrition' WHERE "name" = 'Diet';
UPDATE "ServiceDepartment" SET "partnerName" = 'JJ Wellness', "partnerSharePct" = 20 WHERE "name" IN ('JJ Wellness (skin, hair, BMI)', 'JJ Wellness — MMP admissions');
UPDATE "ServiceDepartment"
   SET "expenseDepartments" = 'Wellness',
       "pharmacyIncentivePct" = 1,
       "pharmacyItems" = 'mounjaro, yurpeak, yurpeck, glipiq, semanext, semanat, semalix, semasize, semafull, sematrinity, semabest, semawin, semaglu, sembolic, sunday, sundae, ozempic, wegovy, ozanta, wyntide, obeda, extensior, povizitra'
 WHERE "name" = 'JJ Wellness — MMP admissions';
