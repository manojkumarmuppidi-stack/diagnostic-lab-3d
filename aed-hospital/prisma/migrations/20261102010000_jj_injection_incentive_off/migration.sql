-- JJ Wellness's incentives (entered each month) already include the 1% on injection sales,
-- so the automatic 1% line would count it twice. The injection margin stays JJ Wellness income.
UPDATE "ServiceDepartment" SET "pharmacyIncentivePct" = 0, "updatedAt" = NOW() WHERE "name" = 'JJ Wellness';
