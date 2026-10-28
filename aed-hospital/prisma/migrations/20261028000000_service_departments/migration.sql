-- Department-wise accounts: income departments matched by keywords on the billed item names.
CREATE TABLE "ServiceDepartment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceDepartment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceDepartment_name_key" ON "ServiceDepartment"("name");
