-- Cost centres from the first-floor plan, and lab tests / consultations that no department claims.
INSERT INTO "ServiceDepartment" ("id", "name", "keywords", "sortOrder", "updatedAt")
SELECT v.id, v.name, v.keywords, v.sort, NOW()
  FROM (VALUES ('dept_laboratory', 'Laboratory', 'stream:LAB', 100),
               ('dept_consultations', 'Consultation chambers', 'stream:OPD', 110),
               ('dept_reception', 'Reception & Administration', '', 120),
               ('dept_lobby', 'Lobby', '', 130)) AS v(id, name, keywords, sort)
 WHERE NOT EXISTS (SELECT 1 FROM "ServiceDepartment" d WHERE d."name" = v.name);

-- First-floor expense pool of Rs 1,51,607.10 a month, shared by floor area (Oct 2026), from January 2026.
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 15% of ₹1,51,607.10', 'FIXED', 22741.07, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Laboratory'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 7% of ₹1,51,607.10', 'FIXED', 10612.50, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Reception & Administration'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 20% of ₹1,51,607.10', 'FIXED', 30321.42, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Lobby'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 25% of ₹1,51,607.10', 'FIXED', 37901.78, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Consultation chambers'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 5% of ₹1,51,607.10 (USG & 2D Echo room)', 'FIXED', 7580.36, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'USG scan room'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 7% of ₹1,51,607.10', 'FIXED', 10612.50, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Ophthalmology'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 3% of ₹1,51,607.10 (ECG & TMT room)', 'FIXED', 4548.21, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Cardiac (2D Echo, TMT, ECG)'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 6% of ₹1,51,607.10', 'FIXED', 9096.43, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'JJ Wellness'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 5% of ₹1,51,607.10 (Dietetics)', 'FIXED', 7580.36, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Diet'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
INSERT INTO "DepartmentCost" ("id", "departmentId", "label", "kind", "amount", "fromMonth", "createdById", "updatedAt")
SELECT 'ffa_' || md5(d.id), d.id, 'First-floor space — 5% of ₹1,51,607.10 (Physiotherapy)', 'FIXED', 7580.36, '2026-01', 'system', NOW()
  FROM "ServiceDepartment" d
 WHERE d."name" = 'Foot exam, neuropathy & physiotherapy'
   AND NOT EXISTS (SELECT 1 FROM "DepartmentCost" c WHERE c."departmentId" = d.id AND c."label" LIKE 'First-floor space%');
