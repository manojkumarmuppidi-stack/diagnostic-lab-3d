-- CreateEnum
CREATE TYPE "PharmacyLineKind" AS ENUM ('SALE', 'PURCHASE');

-- CreateTable
CREATE TABLE "PharmacyItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PharmacyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyItemLine" (
    "id" TEXT NOT NULL,
    "kind" "PharmacyLineKind" NOT NULL,
    "date" DATE NOT NULL,
    "docNo" TEXT,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT,
    "expiry" TEXT,
    "supplier" TEXT,
    "manufacturer" TEXT,
    "qty" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxable" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "cost" DECIMAL(12,2),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PharmacyItemLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyItem_name_key" ON "PharmacyItem"("name");

-- CreateIndex
CREATE INDEX "PharmacyItemLine_kind_date_status_idx" ON "PharmacyItemLine"("kind", "date", "status");

-- CreateIndex
CREATE INDEX "PharmacyItemLine_itemId_kind_date_idx" ON "PharmacyItemLine"("itemId", "kind", "date");

-- CreateIndex
CREATE INDEX "PharmacyItemLine_fingerprint_idx" ON "PharmacyItemLine"("fingerprint");

-- CreateIndex
CREATE INDEX "PharmacyItemLine_importBatchId_idx" ON "PharmacyItemLine"("importBatchId");

-- AddForeignKey
ALTER TABLE "PharmacyItemLine" ADD CONSTRAINT "PharmacyItemLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PharmacyItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyItemLine" ADD CONSTRAINT "PharmacyItemLine_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Same protections as the financial tables: no deletes, values immutable, reversal is final.
CREATE TRIGGER no_delete_pharmacyitemline BEFORE DELETE ON "PharmacyItemLine"
  FOR EACH ROW EXECUTE FUNCTION aed_forbid_delete();
CREATE TRIGGER immutable_pharmacyitemline BEFORE UPDATE ON "PharmacyItemLine"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status');
CREATE TRIGGER status_guard_pharmacyitemline BEFORE UPDATE OF status ON "PharmacyItemLine"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_status();
