-- 1. SCP follow-ups billed with the staff names misspelt ("f/u by spadana", "spanadana", "sheebha").
UPDATE "ConsultationType" SET "scp" = true, "updatedAt" = NOW()
 WHERE NOT "scp" AND "name" ~* '(sugar\s*control|\mscp\M|short\s*admission|bh?agh?ya|s[a-z]?pa[a-z]*d[a-z]*na|shee?bh?a)';

-- 2. Diet follow-ups that OneGlance's OP bill collection gave only as "f/u by deepika" (no item name)
--    were imported as OPD consultations. Move them to Diet & Nutrition: a diet entry with the same bill,
--    amounts, payment mode and import batch; the consultation is voided with the reason, and both are
--    in the audit log. Income totals do not change, only the stream.
CREATE TEMP TABLE _diet_move AS
SELECT c.*, ct."name" AS ct_name
  FROM "Consultation" c
  JOIN "ConsultationType" ct ON ct."id" = c."consultationTypeId"
 WHERE c."status" = 'ACTIVE' AND NOT ct."scp"
   AND ct."name" ~* '(\mdiet|deepika|deppika|dipika)'
   AND NOT EXISTS (SELECT 1 FROM "DietTransaction" d WHERE d."status" = 'ACTIVE' AND d."reference" = c."reference" AND d."date" = c."date");

INSERT INTO "DietService" ("id", "name", "rate", "updatedAt")
SELECT DISTINCT 'dsvc_' || md5(ct_name), ct_name, 0, NOW() FROM _diet_move
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "DietTransaction" ("id", "date", "patientId", "patientName", "serviceId", "grossAmount", "discount", "netAmount", "paymentModeId",
                               "reference", "remarks", "status", "fingerprint", "importBatchId", "createdById", "createdAt", "updatedAt")
SELECT 'mvd_' || md5(m."id"), m."date", m."patientId", m."patientName", ds."id", m."grossAmount", m."discount", m."netAmount", m."paymentModeId",
       m."reference", concat_ws(' · ', NULLIF(m."remarks", ''), 'Diet follow-up moved from OPD'), 'ACTIVE', 'moved:' || m."id", m."importBatchId", m."createdById", NOW(), NOW()
  FROM _diet_move m JOIN "DietService" ds ON ds."name" = m.ct_name;

INSERT INTO "AuditLog" ("id", "userName", "action", "entityType", "entityId", "before", "after", "reason", "createdAt")
SELECT 'mva_' || md5(m."id"), 'system', 'RECLASSIFY', 'Consultation', m."id",
       json_build_object('module', 'opd', 'reference', m."reference", 'date', m."date", 'netAmount', m."netAmount"),
       json_build_object('module', 'diet', 'id', 'mvd_' || md5(m."id")),
       'Diet follow-up billed as OPD (Visit Purpose names the dietitian) — moved to Diet & Nutrition', NOW()
  FROM _diet_move m;

UPDATE "Consultation" SET "status" = 'VOIDED', "voidReason" = 'Moved to Diet & Nutrition: diet follow-up', "updatedAt" = NOW()
 WHERE "id" IN (SELECT "id" FROM _diet_move);

DROP TABLE _diet_move;
