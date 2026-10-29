-- Department accounts are an analysis apart from the hospital's books: a department's costs are the
-- shares the Admin allocates to it (fixed ₹ per month, or % of an expense category), not expenses swept
-- in automatically by expense department.
ALTER TABLE "ServiceDepartment" DROP COLUMN "expenseDepartments";

CREATE TABLE "DepartmentCost" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FIXED',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "percent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "fromMonth" TEXT NOT NULL,
    "toMonth" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DepartmentCost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DepartmentCost_departmentId_idx" ON "DepartmentCost"("departmentId");
ALTER TABLE "DepartmentCost" ADD CONSTRAINT "DepartmentCost_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "ServiceDepartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
