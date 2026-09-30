-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "headId" TEXT;

-- CreateTable
CREATE TABLE "ExpenseHead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "departmentId" TEXT,
    "vendor" TEXT,
    "defaultMode" TEXT,
    "typicalAmount" DECIMAL(12,2),
    "monthly" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseHead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseHead_name_key" ON "ExpenseHead"("name");

-- AddForeignKey
ALTER TABLE "ExpenseHead" ADD CONSTRAINT "ExpenseHead_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseHead" ADD CONSTRAINT "ExpenseHead_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseHead" ADD CONSTRAINT "ExpenseHead_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_headId_fkey" FOREIGN KEY ("headId") REFERENCES "ExpenseHead"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Expense approval: a PENDING expense may be approved (-> ACTIVE) or rejected (-> VOIDED);
-- every other status change stays one-way as before.
CREATE OR REPLACE FUNCTION aed_guard_status() RETURNS trigger AS $$
BEGIN
  -- Nothing can be sent back to PENDING (an approved expense stays approved).
  IF NEW."status"::text = 'PENDING' AND OLD."status"::text <> 'PENDING' THEN
    RAISE EXCEPTION 'A % row with status % cannot become pending', TG_TABLE_NAME, OLD."status"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" <> 'ACTIVE' AND NEW."status" <> OLD."status" THEN
    IF OLD."status"::text = 'PENDING' AND NEW."status"::text IN ('ACTIVE', 'VOIDED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A % row with status % cannot change status', TG_TABLE_NAME, OLD."status"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Approval stamps may be written once the row exists; amounts etc. stay immutable.
DROP TRIGGER IF EXISTS immutable_expense ON "Expense";
CREATE TRIGGER immutable_expense BEFORE UPDATE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt', 'approvedById', 'approvedAt');
