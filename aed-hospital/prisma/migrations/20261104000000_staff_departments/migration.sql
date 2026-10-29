-- Staff → department, so payroll uploads book each person's pay to their department (department accounts only).
CREATE TABLE "StaffDepartment" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "names" TEXT NOT NULL DEFAULT '',
    "departmentId" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffDepartment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffDepartment_label_departmentId_key" ON "StaffDepartment"("label", "departmentId");
ALTER TABLE "StaffDepartment" ADD CONSTRAINT "StaffDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "ServiceDepartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A department cost can be "hospital expenses whose description contains …" (e.g. a visiting doctor's fees).
ALTER TABLE "DepartmentCost" ADD COLUMN "matchText" TEXT;
