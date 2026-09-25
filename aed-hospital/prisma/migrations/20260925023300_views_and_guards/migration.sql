-- ============================================================================
-- Accounting views: the single source of truth for income and expense lines.
-- Every dashboard, analytics chart, report and drill-down reads these views.
-- Only ACTIVE rows are included (SUPERSEDED / VOIDED / REVERSED never count).
-- See ACCOUNTING_RULES.md.
-- ============================================================================

CREATE OR REPLACE VIEW v_income_line AS
  SELECT 'OPD'::text AS stream, c."visitType"::text AS sub_kind, c."date" AS date,
         c."netAmount" AS amount, c."grossAmount" AS gross, c."discount" AS discount, 1 AS units,
         c."paymentModeId" AS payment_mode_id, c."doctorId" AS doctor_id, c."specialtyId" AS specialty_id,
         NULL::text AS department_id, c."consultationTypeId" AS item_id,
         COALESCE(c."patientId", 'name:' || lower(trim(c."patientName"))) AS patient_key,
         'Consultation'::text AS source_table, c."id" AS source_id
    FROM "Consultation" c WHERE c."status" = 'ACTIVE'
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

CREATE OR REPLACE VIEW v_expense_line AS
  SELECT ec."group"::text AS kind, e."date" AS date, e."amount" AS amount,
         e."categoryId" AS category_id, e."subcategoryId" AS subcategory_id,
         e."departmentId" AS department_id, e."paymentModeId" AS payment_mode_id,
         'Expense'::text AS source_table, e."id" AS source_id
    FROM "Expense" e JOIN "ExpenseCategory" ec ON ec."id" = e."categoryId"
   WHERE e."status" = 'ACTIVE'
  UNION ALL
  SELECT 'PHARMACY_PURCHASE', p."date", p."amount", NULL, NULL, NULL, p."paymentModeId",
         'PharmacyPurchase', p."id"
    FROM "PharmacyPurchase" p WHERE p."status" = 'ACTIVE';

-- ============================================================================
-- Guards: financial rows can never be DELETEd, and their financial columns can
-- never be UPDATEd in place. Corrections create a new row (supersede); voids and
-- import reversals only change "status"/"voidReason". The audit log is append-only.
-- TRUNCATE (used by test fixtures and full restores) is a separate privilege.
-- ============================================================================

CREATE OR REPLACE FUNCTION aed_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Deleting rows from % is not permitted (use void/reversal)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

-- TG_ARGV lists the columns that MAY change. Everything else must stay identical.
CREATE OR REPLACE FUNCTION aed_guard_immutable() RETURNS trigger AS $$
DECLARE
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  i int;
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    o := o - TG_ARGV[i];
    n := n - TG_ARGV[i];
  END LOOP;
  IF o IS DISTINCT FROM n THEN
    RAISE EXCEPTION 'Financial columns of % are immutable; create a correction instead', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Consultation','IpdAdmission','IpdTransaction','LabTransaction','PharmacySale',
                           'PharmacyReturn','PharmacyPurchase','DietTransaction','OtherIncome','Expense',
                           'AuditLog','DayEvent','Attachment']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION aed_forbid_delete()',
                   'no_delete_' || lower(t), t);
  END LOOP;
END $$;

CREATE TRIGGER immutable_consultation BEFORE UPDATE ON "Consultation"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt');
CREATE TRIGGER immutable_ipdadmission BEFORE UPDATE ON "IpdAdmission"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt', 'dischargeDate', 'remarks');
CREATE TRIGGER immutable_ipdtransaction BEFORE UPDATE ON "IpdTransaction"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt', 'admissionId');
CREATE TRIGGER immutable_labtransaction BEFORE UPDATE ON "LabTransaction"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt');
CREATE TRIGGER immutable_pharmacysale BEFORE UPDATE ON "PharmacySale"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt');
CREATE TRIGGER immutable_pharmacyreturn BEFORE UPDATE ON "PharmacyReturn"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt');
CREATE TRIGGER immutable_pharmacypurchase BEFORE UPDATE ON "PharmacyPurchase"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt');
CREATE TRIGGER immutable_diettransaction BEFORE UPDATE ON "DietTransaction"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt');
CREATE TRIGGER immutable_otherincome BEFORE UPDATE ON "OtherIncome"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt');
CREATE TRIGGER immutable_expense BEFORE UPDATE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt');
CREATE TRIGGER immutable_auditlog BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable();

-- Status may only move away from ACTIVE, never back (a reversal is final).
CREATE OR REPLACE FUNCTION aed_guard_status() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'ACTIVE' AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'A % row with status % cannot change status', TG_TABLE_NAME, OLD."status"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Consultation','IpdAdmission','IpdTransaction','LabTransaction','PharmacySale',
                           'PharmacyReturn','PharmacyPurchase','DietTransaction','OtherIncome','Expense']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF status ON %I FOR EACH ROW EXECUTE FUNCTION aed_guard_status()',
                   'status_guard_' || lower(t), t);
  END LOOP;
END $$;
