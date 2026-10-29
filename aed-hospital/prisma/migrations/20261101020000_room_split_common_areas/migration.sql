-- The USG & 2D Echo room is shared 80/20: 2D Echo income counts under Cardiac.
UPDATE "DepartmentCost" c
   SET "amount" = 6064.29, "label" = 'First-floor space — 5% of ₹1,51,607.10 (USG & 2D Echo room, 80% for USG)', "updatedAt" = NOW()
  FROM "ServiceDepartment" d
 WHERE d.id = c."departmentId" AND d."name" = 'USG scan room' AND c."label" = 'First-floor space — 5% of ₹1,51,607.10 (USG & 2D Echo room)';
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_echo_' || md5(d.id), d.id, 'First-floor space — 5% of ₹1,51,607.10 (USG & 2D Echo room, 20% for 2D Echo)', 'FIXED', 1516.07, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Cardiac (2D Echo, TMT, ECG)'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE '%20% for 2D Echo%');

-- Reception & Administration and the Lobby serve the whole hospital: they are not departments to evaluate.
-- Switched off (not deleted), so their space costs can be brought back from Master Data.
UPDATE "ServiceDepartment" SET "active" = false, "updatedAt" = NOW() WHERE "name" IN ('Reception & Administration', 'Lobby');
