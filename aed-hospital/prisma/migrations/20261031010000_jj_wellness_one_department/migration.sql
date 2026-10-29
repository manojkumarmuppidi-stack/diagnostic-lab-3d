-- JJ Wellness as one department: skin, hair, BMI, the ₹200 wellness share, MMP packages and admissions,
-- GLP injections, Wellness expenses and the 20% partner share.
UPDATE "ServiceDepartment"
   SET "name" = 'JJ Wellness',
       "keywords" = 'skin, hair, bmi, wellness consultation, mmp',
       "addOnKeywords" = 'consultation, wellness consultation, wellness',
       "addOnAmount" = 200,
       "expenseDepartments" = 'Wellness',
       "pharmacyIncentivePct" = 1,
       "pharmacyItems" = 'mounjaro, yurpeak, yurpeck, glipiq, semanext, semanat, semalix, semasize, semafull, sematrinity, semabest, semawin, semaglu, sembolic, sunday, sundae, ozempic, wegovy, ozanta, wyntide, obeda, extensior, povizitra',
       "partnerName" = 'JJ Wellness',
       "partnerSharePct" = 20,
       "updatedAt" = NOW()
 WHERE "name" = 'JJ Wellness (skin, hair, BMI)'
   AND NOT EXISTS (SELECT 1 FROM "ServiceDepartment" WHERE "name" = 'JJ Wellness');
DELETE FROM "ServiceDepartment" WHERE "name" = 'JJ Wellness — MMP admissions' AND EXISTS (SELECT 1 FROM "ServiceDepartment" WHERE "name" = 'JJ Wellness');
