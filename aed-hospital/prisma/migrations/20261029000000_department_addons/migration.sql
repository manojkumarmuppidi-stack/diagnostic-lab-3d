-- Combined OneGlance bills ("New Thyroid + Wellness Consultation" = consultation + ₹200 wellness):
-- a department can take a fixed amount per bill from them.
ALTER TABLE "ServiceDepartment" ADD COLUMN "addOnKeywords" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ServiceDepartment" ADD COLUMN "addOnAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- The ₹200 wellness consultation inside combined bills, and the stand-alone "Wellness Consultation", belong to JJ Wellness.
UPDATE "ServiceDepartment"
   SET "addOnKeywords" = 'consultation, wellness consultation, wellness',
       "addOnAmount" = 200,
       "keywords" = CASE WHEN "keywords" ILIKE '%wellness consultation%' THEN "keywords" ELSE "keywords" || ', wellness consultation' END
 WHERE "name" = 'JJ Wellness (skin, hair, BMI)' AND "addOnKeywords" = '';
