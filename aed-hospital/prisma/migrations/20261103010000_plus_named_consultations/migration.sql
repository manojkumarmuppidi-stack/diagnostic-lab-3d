-- Imported bills named "… + Consultation" / "…+Wellness Consultation" (consultation + ₹200 wellness share)
-- were filed under the same name without "+" when such a consultation type already existed, because
-- names were compared without punctuation. The name exactly as OneGlance gave it is still in the import
-- record, so each such bill is corrected the way a manual correction is: the wrong record is marked
-- SUPERSEDED and a copy under the right consultation type points back to it (correctionOfId), with an
-- audit entry. Amounts, dates, patients and payment modes do not change.
CREATE TEMP TABLE _plus AS
SELECT DISTINCT ON (c."id") c."id" AS cid,
       btrim(regexp_replace(r."raw"->>'Consultation Type', '\s+', ' ', 'g')) AS orig
  FROM "Consultation" c
  JOIN "ConsultationType" ct ON ct."id" = c."consultationTypeId"
  JOIN "ImportRecord" r ON jsonb_typeof(r."entityIds") = 'array' AND r."entityIds" ? c."id"
 WHERE c."status" = 'ACTIVE'
   AND strpos(r."raw"->>'Consultation Type', '+') > 0
   AND strpos(ct."name", '+') = 0
 ORDER BY c."id";

-- The consultation types with "+" that are missing (SCP names flagged as on import).
INSERT INTO "ConsultationType" ("id", "name", "scp", "updatedAt")
SELECT DISTINCT 'ctp_' || md5(p.orig), p.orig,
       p.orig ~* '(sugar\s*control|\mscp\M|short\s*admission|bh?agh?ya|s[a-z]?pa[a-z]*d[a-z]*na|shee?bh?a)', NOW()
  FROM _plus p
 WHERE NOT EXISTS (SELECT 1 FROM "ConsultationType" t WHERE lower(t."name") = lower(p.orig))
ON CONFLICT ("name") DO NOTHING;

CREATE TEMP TABLE _plus_fix AS
SELECT p.cid, 'fixp_' || md5(p.cid) AS nid,
       (SELECT t."id" FROM "ConsultationType" t WHERE lower(t."name") = lower(p.orig) ORDER BY (t."name" = p.orig) DESC LIMIT 1) AS type_id,
       p.orig
  FROM _plus p;

UPDATE "Consultation" SET "status" = 'SUPERSEDED', "updatedAt" = NOW() WHERE "id" IN (SELECT cid FROM _plus_fix WHERE type_id IS NOT NULL);

INSERT INTO "Consultation" ("id", "date", "patientId", "patientName", "doctorId", "specialtyId", "consultationTypeId", "visitType",
                            "grossAmount", "discount", "netAmount", "paymentModeId", "reference", "remarks", "status", "fingerprint",
                            "importBatchId", "correctionOfId", "createdById", "createdAt", "updatedAt")
SELECT f.nid, c."date", c."patientId", c."patientName", c."doctorId", c."specialtyId", f.type_id, c."visitType",
       c."grossAmount", c."discount", c."netAmount", c."paymentModeId", c."reference", c."remarks", 'ACTIVE', c."fingerprint",
       c."importBatchId", c."id", c."createdById", NOW(), NOW()
  FROM _plus_fix f JOIN "Consultation" c ON c."id" = f.cid
 WHERE f.type_id IS NOT NULL;

INSERT INTO "AuditLog" ("id", "userName", "action", "entityType", "entityId", "before", "after", "reason", "createdAt")
SELECT 'fpa_' || md5(f.cid), 'system', 'CORRECT', 'Consultation', f.nid,
       json_build_object('id', f.cid, 'consultationType', ct."name"),
       json_build_object('id', f.nid, 'consultationType', f.orig),
       'Billed as "' || f.orig || '" (includes the ₹200 wellness share) but filed under "' || ct."name" || '"', NOW()
  FROM _plus_fix f JOIN "Consultation" c ON c."id" = f.cid JOIN "ConsultationType" ct ON ct."id" = c."consultationTypeId"
 WHERE f.type_id IS NOT NULL;

DROP TABLE _plus_fix;
DROP TABLE _plus;
