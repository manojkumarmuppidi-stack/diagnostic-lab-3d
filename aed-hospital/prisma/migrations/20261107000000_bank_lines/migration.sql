-- Bank statement lines, to check the core accounts against the bank. Not part of the books.
CREATE TABLE "BankLine" (
    "id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "party" TEXT,
    "fingerprint" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankLine_fingerprint_key" ON "BankLine"("fingerprint");
CREATE INDEX "BankLine_date_idx" ON "BankLine"("date");
