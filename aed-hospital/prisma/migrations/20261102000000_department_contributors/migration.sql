-- People who bring income into a department, the income they generate each month and their incentive %.
CREATE TABLE "DepartmentContributor" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "incentivePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DepartmentContributor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DepartmentContributor_departmentId_idx" ON "DepartmentContributor"("departmentId");
ALTER TABLE "DepartmentContributor" ADD CONSTRAINT "DepartmentContributor_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "ServiceDepartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContributorIncome" (
    "id" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContributorIncome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContributorIncome_contributorId_month_key" ON "ContributorIncome"("contributorId", "month");
ALTER TABLE "ContributorIncome" ADD CONSTRAINT "ContributorIncome_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "DepartmentContributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
