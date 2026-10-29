-- A login can head one income department: it sees that department's statement and adds its costs.
ALTER TABLE "User" ADD COLUMN "headOfDepartmentId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_headOfDepartmentId_fkey" FOREIGN KEY ("headOfDepartmentId") REFERENCES "ServiceDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
