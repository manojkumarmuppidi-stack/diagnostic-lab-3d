-- SCP (Sugar Control Plans and short admissions) is its own AED income line, not consultations.
-- SCP bills come only from OneGlance's OPD report; their billed name ("Sugar Control Plan",
-- "f/u by bhagya" …) is the consultation type, which is flagged SCP. Counted once: the IPD totals
-- exclude SCP.
ALTER TABLE "ConsultationType" ADD COLUMN "scp" BOOLEAN NOT NULL DEFAULT false;

-- Billing names used for SCP so far (names of the SCP staff, the plan, short admissions).
UPDATE "ConsultationType" SET "scp" = true
 WHERE "name" ~* '(sugar\s*control|\mscp\M|short\s*admission|bhagya|spandana|sheeba)';

CREATE OR REPLACE VIEW v_income_line AS
  SELECT CASE WHEN ct."scp" THEN 'SCP' ELSE 'OPD' END::text AS stream, c."visitType"::text AS sub_kind, c."date" AS date,
         c."netAmount" AS amount, c."grossAmount" AS gross, c."discount" AS discount, 1 AS units,
         c."paymentModeId" AS payment_mode_id, c."doctorId" AS doctor_id, c."specialtyId" AS specialty_id,
         NULL::text AS department_id, c."consultationTypeId" AS item_id,
         COALESCE(c."patientId", 'name:' || lower(trim(c."patientName"))) AS patient_key,
         'Consultation'::text AS source_table, c."id" AS source_id
    FROM "Consultation" c LEFT JOIN "ConsultationType" ct ON ct."id" = c."consultationTypeId" WHERE c."status" = 'ACTIVE'
  UNION ALL
  SELECT 'IPD', t."type"::text, t."date",
         CASE WHEN t."type" = 'REFUND' THEN -t."amount" ELSE t."amount" END, 
         CASE WHEN t."type" = 'REFUND' THEN -t."amount" ELSE t."amount" END, 0, 0,
         t."paymentModeId", a."doctorId", NULL, NULL, a."admissionTypeId",
         COALESCE(a."patientId", 'name:' || lower(trim(a."patientName"))),
         'IpdTransaction', t."id"
    FROM "IpdTransaction" t JOIN "IpdAdmission" a ON a."id" = t."admissionId"
   WHERE t."status" = 'ACTIVE' AND a."status" = 'ACTIVE'
  UNION ALL
  SELECT 'LAB', 'TEST', l."date", l."netAmount", l."grossAmount", l."discount", l."quantity",
         l."paymentModeId", l."referringDoctorId", NULL, l."departmentId", l."investigationId",
         COALESCE(l."patientId", 'name:' || lower(trim(l."patientName"))),
         'LabTransaction', l."id"
    FROM "LabTransaction" l WHERE l."status" = 'ACTIVE'
  UNION ALL
  SELECT 'PHARMACY', 'SALE', s."date", s."netAmount", s."grossAmount", s."discount", 1,
         s."paymentModeId", NULL, NULL, NULL, NULL,
         NULL, 'PharmacySale', s."id"
    FROM "PharmacySale" s WHERE s."status" = 'ACTIVE'
  UNION ALL
  SELECT 'PHARMACY', 'RETURN', r."date", -r."amount", -r."amount", 0, 0,
         r."paymentModeId", NULL, NULL, NULL, NULL,
         NULL, 'PharmacyReturn', r."id"
    FROM "PharmacyReturn" r WHERE r."status" = 'ACTIVE'
  UNION ALL
  SELECT 'DIET', 'SERVICE', d."date", d."netAmount", d."grossAmount", d."discount", 1,
         d."paymentModeId", d."dieticianId", NULL, NULL, d."serviceId",
         COALESCE(d."patientId", 'name:' || lower(trim(d."patientName"))),
         'DietTransaction', d."id"
    FROM "DietTransaction" d WHERE d."status" = 'ACTIVE'
  UNION ALL
  SELECT 'OTHER', 'OTHER', o."date", o."amount", o."amount", 0, 1,
         o."paymentModeId", NULL, NULL, NULL, NULL,
         NULL, 'OtherIncome', o."id"
    FROM "OtherIncome" o WHERE o."status" = 'ACTIVE';
