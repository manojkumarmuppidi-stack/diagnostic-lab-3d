-- Fixed assets (vehicles, equipment): recorded at cost, depreciated each financial year.
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Vehicles',
    "purchaseDate" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'SLM',
    "usefulLifeYears" INTEGER NOT NULL DEFAULT 8,
    "residualPct" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "ratePct" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "bankLineIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);
-- The year's depreciation is posted as an expense under this head (Other expenses).
INSERT INTO "ExpenseCategory" ("id", "name", "group", "updatedAt")
SELECT 'cat_depreciation', 'Depreciation', 'OTHER', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ExpenseCategory" WHERE lower("name") = 'depreciation' AND "parentId" IS NULL);
-- Book entries (depreciation) move no money: they are entered with this non-cash payment mode.
INSERT INTO "PaymentMode" ("id", "code", "name", "reconGroup", "updatedAt")
SELECT 'pm_book_entry', 'BOOK', 'Book entry (non-cash)', 'OTHER', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "PaymentMode" WHERE "code" = 'BOOK');
