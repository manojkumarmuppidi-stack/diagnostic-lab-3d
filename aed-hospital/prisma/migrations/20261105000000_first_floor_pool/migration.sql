-- First-floor space becomes each department's occupancy % of a pool defined on the core accounts'
-- expenses (Department accounts → First-floor cost pool). The fixed amount stays on the row and is used
-- until the pool is set, so nothing changes until the Admin defines it. Department accounts only.
UPDATE "DepartmentCost"
   SET "kind" = 'POOL',
       "percent" = ROUND("amount" / 1516.071, 2),
       "label" = replace("label", 'of ₹1,51,607.10', 'of the first-floor pool'),
       "updatedAt" = NOW()
 WHERE "kind" = 'FIXED' AND "label" LIKE 'First-floor space%';
