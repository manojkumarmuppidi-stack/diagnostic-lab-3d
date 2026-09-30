-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "supplier" TEXT NOT NULL,
    "reference" TEXT,
    "invoiceRefs" TEXT[],
    "details" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPayment_date_status_idx" ON "SupplierPayment"("date", "status");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplier_idx" ON "SupplierPayment"("supplier");

-- CreateIndex
CREATE INDEX "SupplierPayment_fingerprint_idx" ON "SupplierPayment"("fingerprint");

-- CreateIndex
CREATE INDEX "SupplierPayment_importBatchId_idx" ON "SupplierPayment"("importBatchId");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Same protections as the financial tables. Matching purchases to payments needs the canonical invoice number.
CREATE TRIGGER no_delete_supplierpayment BEFORE DELETE ON "SupplierPayment"
  FOR EACH ROW EXECUTE FUNCTION aed_forbid_delete();
CREATE TRIGGER immutable_supplierpayment BEFORE UPDATE ON "SupplierPayment"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status');
CREATE TRIGGER status_guard_supplierpayment BEFORE UPDATE OF status ON "SupplierPayment"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_status();
CREATE INDEX "SupplierPayment_invoiceRefs_idx" ON "SupplierPayment" USING GIN ("invoiceRefs");
