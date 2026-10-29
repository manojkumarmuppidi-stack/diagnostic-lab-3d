-- The Jan–Sep 2026 IPD monthly totals (imported with no patient-wise detail) were all long admissions,
-- as management confirmed. They were filed under another admission type, so Long admissions in
-- department accounts showed nothing for those months. Each is corrected the way a manual correction
-- is: the admission is marked SUPERSEDED, a copy under "Long Admission" points back to it
-- (correctionOfId), its payments move to the copy, and an audit entry records it. No amount changes.
INSERT INTO "AdmissionType" ("id", "name", "active", "createdAt", "updatedAt")
SELECT 'adm_long_admission', 'Long Admission', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "AdmissionType" WHERE lower("name") LIKE 'long adm%');

CREATE TEMP TABLE _ipd_long AS
SELECT a."id" AS aid, 'ipdl_' || md5(a."id") AS nid, at."name" AS old_type,
       (SELECT t."id" FROM "AdmissionType" t WHERE lower(t."name") LIKE 'long adm%' ORDER BY t."active" DESC, t."createdAt" LIMIT 1) AS type_id
  FROM "IpdAdmission" a JOIN "AdmissionType" at ON at."id" = a."admissionTypeId"
 WHERE a."status" = 'ACTIVE'
   AND (a."reference" LIKE 'IPD-MONTH-2026%' OR a."patientName" LIKE 'IPD monthly total%')
   AND lower(at."name") NOT LIKE 'long adm%';

UPDATE "IpdAdmission" SET "status" = 'SUPERSEDED', "updatedAt" = NOW() WHERE "id" IN (SELECT aid FROM _ipd_long);

INSERT INTO "IpdAdmission" ("id", "admissionDate", "dischargeDate", "patientId", "patientName", "admissionTypeId", "doctorId", "packageId",
                            "grossAmount", "discount", "netAmount", "reference", "remarks", "status", "fingerprint",
                            "importBatchId", "correctionOfId", "createdById", "createdAt", "updatedAt")
SELECT f.nid, a."admissionDate", a."dischargeDate", a."patientId", a."patientName", f.type_id, a."doctorId", a."packageId",
       a."grossAmount", a."discount", a."netAmount", a."reference", a."remarks", 'ACTIVE', a."fingerprint",
       a."importBatchId", a."id", a."createdById", NOW(), NOW()
  FROM _ipd_long f JOIN "IpdAdmission" a ON a."id" = f.aid;

-- Payments follow the corrected admission (admissionId is the only mutable column on IpdTransaction).
UPDATE "IpdTransaction" t SET "admissionId" = f.nid, "updatedAt" = NOW() FROM _ipd_long f WHERE t."admissionId" = f.aid;

INSERT INTO "AuditLog" ("id", "userName", "action", "entityType", "entityId", "before", "after", "reason", "createdAt")
SELECT 'ipla_' || md5(f.aid), 'system', 'CORRECT', 'IpdAdmission', f.nid,
       json_build_object('id', f.aid, 'admissionType', f.old_type),
       json_build_object('id', f.nid, 'admissionType', 'Long Admission'),
       'IPD monthly total confirmed by management as long admissions', NOW()
  FROM _ipd_long f;

DROP TABLE _ipd_long;
