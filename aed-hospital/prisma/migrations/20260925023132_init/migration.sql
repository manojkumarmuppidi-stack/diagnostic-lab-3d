-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'VOIDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('NEW', 'OLD');

-- CreateEnum
CREATE TYPE "StaffKind" AS ENUM ('DOCTOR', 'DIETICIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseGroup" AS ENUM ('HOSPITAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ReconGroup" AS ENUM ('CASH', 'CARD', 'UPI', 'BANK', 'OTHER');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('OPEN', 'REVIEW', 'RECONCILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IpdTxnType" AS ENUM ('ADVANCE', 'PAYMENT', 'FINAL_SETTLEMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'IMPORTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'VALID', 'WARNING', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED', 'REVERSED');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "group" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specialty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StaffKind" NOT NULL DEFAULT 'DOCTOR',
    "specialtyId" TEXT,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpdPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "admissionTypeId" TEXT,
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabInvestigation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabInvestigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietService" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DietService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "ExpenseGroup" NOT NULL DEFAULT 'HOSPITAL',
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reconGroup" "ReconGroup" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "patientCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "patientId" TEXT,
    "patientName" TEXT,
    "doctorId" TEXT,
    "specialtyId" TEXT,
    "consultationTypeId" TEXT,
    "visitType" "VisitType" NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "reference" TEXT,
    "remarks" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpdAdmission" (
    "id" TEXT NOT NULL,
    "admissionDate" DATE NOT NULL,
    "dischargeDate" DATE,
    "patientId" TEXT,
    "patientName" TEXT,
    "admissionTypeId" TEXT NOT NULL,
    "doctorId" TEXT,
    "packageId" TEXT,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "remarks" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpdTransaction" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "IpdTxnType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "reference" TEXT,
    "remarks" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTransaction" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "patientId" TEXT,
    "patientName" TEXT,
    "investigationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "rate" DECIMAL(12,2) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "referringDoctorId" TEXT,
    "departmentId" TEXT,
    "reference" TEXT,
    "remarks" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacySale" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "invoiceNo" TEXT,
    "patientId" TEXT,
    "patientName" TEXT,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "remarks" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacySale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyReturn" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "invoiceNo" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "reason" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyPurchase" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "supplier" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "remarks" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietTransaction" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "patientId" TEXT,
    "patientName" TEXT,
    "serviceId" TEXT,
    "dieticianId" TEXT,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "reference" TEXT,
    "remarks" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DietTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherIncome" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "reference" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtherIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "departmentId" TEXT,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "billNumber" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentModeId" TEXT,
    "remarks" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "importBatchId" TEXT,
    "correctionOfId" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAccount" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reconciledById" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "closingSnapshot" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayEvent" (
    "id" TEXT NOT NULL,
    "dailyAccountId" TEXT NOT NULL,
    "fromStatus" "DayStatus" NOT NULL,
    "toStatus" "DayStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "dailyAccountId" TEXT NOT NULL,
    "reconGroup" "ReconGroup" NOT NULL,
    "expected" DECIMAL(12,2) NOT NULL,
    "actual" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "explanation" TEXT,
    "userId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "proposed" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "resultEntityId" TEXT,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sheetName" TEXT,
    "module" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "headers" JSONB NOT NULL,
    "mapping" JSONB,
    "options" JSONB,
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reverseReason" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "errors" JSONB,
    "warnings" JSONB,
    "fingerprint" TEXT,
    "duplicateOf" TEXT,
    "forceImport" BOOLEAN NOT NULL DEFAULT false,
    "entityIds" JSONB,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_name_key" ON "Specialty"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_name_kind_key" ON "Doctor"("name", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationType_name_key" ON "ConsultationType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionType_name_key" ON "AdmissionType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "IpdPackage_name_key" ON "IpdPackage"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LabInvestigation_name_key" ON "LabInvestigation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DietService_name_key" ON "DietService"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_parentId_key" ON "ExpenseCategory"("name", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMode_code_key" ON "PaymentMode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_patientCode_key" ON "Patient"("patientCode");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_correctionOfId_key" ON "Consultation"("correctionOfId");

-- CreateIndex
CREATE INDEX "Consultation_date_status_idx" ON "Consultation"("date", "status");

-- CreateIndex
CREATE INDEX "Consultation_fingerprint_idx" ON "Consultation"("fingerprint");

-- CreateIndex
CREATE INDEX "Consultation_importBatchId_idx" ON "Consultation"("importBatchId");

-- CreateIndex
CREATE INDEX "Consultation_patientId_idx" ON "Consultation"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "IpdAdmission_correctionOfId_key" ON "IpdAdmission"("correctionOfId");

-- CreateIndex
CREATE INDEX "IpdAdmission_admissionDate_status_idx" ON "IpdAdmission"("admissionDate", "status");

-- CreateIndex
CREATE INDEX "IpdAdmission_fingerprint_idx" ON "IpdAdmission"("fingerprint");

-- CreateIndex
CREATE INDEX "IpdAdmission_importBatchId_idx" ON "IpdAdmission"("importBatchId");

-- CreateIndex
CREATE INDEX "IpdAdmission_patientId_idx" ON "IpdAdmission"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "IpdTransaction_correctionOfId_key" ON "IpdTransaction"("correctionOfId");

-- CreateIndex
CREATE INDEX "IpdTransaction_date_status_idx" ON "IpdTransaction"("date", "status");

-- CreateIndex
CREATE INDEX "IpdTransaction_admissionId_idx" ON "IpdTransaction"("admissionId");

-- CreateIndex
CREATE INDEX "IpdTransaction_fingerprint_idx" ON "IpdTransaction"("fingerprint");

-- CreateIndex
CREATE INDEX "IpdTransaction_importBatchId_idx" ON "IpdTransaction"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "LabTransaction_correctionOfId_key" ON "LabTransaction"("correctionOfId");

-- CreateIndex
CREATE INDEX "LabTransaction_date_status_idx" ON "LabTransaction"("date", "status");

-- CreateIndex
CREATE INDEX "LabTransaction_investigationId_idx" ON "LabTransaction"("investigationId");

-- CreateIndex
CREATE INDEX "LabTransaction_fingerprint_idx" ON "LabTransaction"("fingerprint");

-- CreateIndex
CREATE INDEX "LabTransaction_importBatchId_idx" ON "LabTransaction"("importBatchId");

-- CreateIndex
CREATE INDEX "LabTransaction_patientId_idx" ON "LabTransaction"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacySale_correctionOfId_key" ON "PharmacySale"("correctionOfId");

-- CreateIndex
CREATE INDEX "PharmacySale_date_status_idx" ON "PharmacySale"("date", "status");

-- CreateIndex
CREATE INDEX "PharmacySale_invoiceNo_idx" ON "PharmacySale"("invoiceNo");

-- CreateIndex
CREATE INDEX "PharmacySale_fingerprint_idx" ON "PharmacySale"("fingerprint");

-- CreateIndex
CREATE INDEX "PharmacySale_importBatchId_idx" ON "PharmacySale"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyReturn_correctionOfId_key" ON "PharmacyReturn"("correctionOfId");

-- CreateIndex
CREATE INDEX "PharmacyReturn_date_status_idx" ON "PharmacyReturn"("date", "status");

-- CreateIndex
CREATE INDEX "PharmacyReturn_fingerprint_idx" ON "PharmacyReturn"("fingerprint");

-- CreateIndex
CREATE INDEX "PharmacyReturn_importBatchId_idx" ON "PharmacyReturn"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyPurchase_correctionOfId_key" ON "PharmacyPurchase"("correctionOfId");

-- CreateIndex
CREATE INDEX "PharmacyPurchase_date_status_idx" ON "PharmacyPurchase"("date", "status");

-- CreateIndex
CREATE INDEX "PharmacyPurchase_fingerprint_idx" ON "PharmacyPurchase"("fingerprint");

-- CreateIndex
CREATE INDEX "PharmacyPurchase_importBatchId_idx" ON "PharmacyPurchase"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "DietTransaction_correctionOfId_key" ON "DietTransaction"("correctionOfId");

-- CreateIndex
CREATE INDEX "DietTransaction_date_status_idx" ON "DietTransaction"("date", "status");

-- CreateIndex
CREATE INDEX "DietTransaction_fingerprint_idx" ON "DietTransaction"("fingerprint");

-- CreateIndex
CREATE INDEX "DietTransaction_importBatchId_idx" ON "DietTransaction"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "OtherIncome_correctionOfId_key" ON "OtherIncome"("correctionOfId");

-- CreateIndex
CREATE INDEX "OtherIncome_date_status_idx" ON "OtherIncome"("date", "status");

-- CreateIndex
CREATE INDEX "OtherIncome_fingerprint_idx" ON "OtherIncome"("fingerprint");

-- CreateIndex
CREATE INDEX "OtherIncome_importBatchId_idx" ON "OtherIncome"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_correctionOfId_key" ON "Expense"("correctionOfId");

-- CreateIndex
CREATE INDEX "Expense_date_status_idx" ON "Expense"("date", "status");

-- CreateIndex
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");

-- CreateIndex
CREATE INDEX "Expense_fingerprint_idx" ON "Expense"("fingerprint");

-- CreateIndex
CREATE INDEX "Expense_importBatchId_idx" ON "Expense"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_expenseId_idx" ON "Attachment"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAccount_date_key" ON "DailyAccount"("date");

-- CreateIndex
CREATE INDEX "DayEvent_dailyAccountId_createdAt_idx" ON "DayEvent"("dailyAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reconciliation_dailyAccountId_reconGroup_key" ON "Reconciliation"("dailyAccountId", "reconGroup");

-- CreateIndex
CREATE INDEX "CorrectionRequest_status_requestedAt_idx" ON "CorrectionRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "CorrectionRequest_module_entityId_idx" ON "CorrectionRequest"("module", "entityId");

-- CreateIndex
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_fileHash_idx" ON "ImportBatch"("fileHash");

-- CreateIndex
CREATE INDEX "ImportRecord_batchId_status_idx" ON "ImportRecord"("batchId", "status");

-- CreateIndex
CREATE INDEX "ImportRecord_batchId_rowNumber_idx" ON "ImportRecord"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdPackage" ADD CONSTRAINT "IpdPackage_admissionTypeId_fkey" FOREIGN KEY ("admissionTypeId") REFERENCES "AdmissionType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabInvestigation" ADD CONSTRAINT "LabInvestigation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_consultationTypeId_fkey" FOREIGN KEY ("consultationTypeId") REFERENCES "ConsultationType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdAdmission" ADD CONSTRAINT "IpdAdmission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdAdmission" ADD CONSTRAINT "IpdAdmission_admissionTypeId_fkey" FOREIGN KEY ("admissionTypeId") REFERENCES "AdmissionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdAdmission" ADD CONSTRAINT "IpdAdmission_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdAdmission" ADD CONSTRAINT "IpdAdmission_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "IpdPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdAdmission" ADD CONSTRAINT "IpdAdmission_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdTransaction" ADD CONSTRAINT "IpdTransaction_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "IpdAdmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdTransaction" ADD CONSTRAINT "IpdTransaction_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdTransaction" ADD CONSTRAINT "IpdTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTransaction" ADD CONSTRAINT "LabTransaction_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTransaction" ADD CONSTRAINT "LabTransaction_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "LabInvestigation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTransaction" ADD CONSTRAINT "LabTransaction_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTransaction" ADD CONSTRAINT "LabTransaction_referringDoctorId_fkey" FOREIGN KEY ("referringDoctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTransaction" ADD CONSTRAINT "LabTransaction_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTransaction" ADD CONSTRAINT "LabTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySale" ADD CONSTRAINT "PharmacySale_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySale" ADD CONSTRAINT "PharmacySale_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySale" ADD CONSTRAINT "PharmacySale_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyReturn" ADD CONSTRAINT "PharmacyReturn_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyReturn" ADD CONSTRAINT "PharmacyReturn_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyPurchase" ADD CONSTRAINT "PharmacyPurchase_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyPurchase" ADD CONSTRAINT "PharmacyPurchase_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietTransaction" ADD CONSTRAINT "DietTransaction_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietTransaction" ADD CONSTRAINT "DietTransaction_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "DietService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietTransaction" ADD CONSTRAINT "DietTransaction_dieticianId_fkey" FOREIGN KEY ("dieticianId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietTransaction" ADD CONSTRAINT "DietTransaction_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietTransaction" ADD CONSTRAINT "DietTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayEvent" ADD CONSTRAINT "DayEvent_dailyAccountId_fkey" FOREIGN KEY ("dailyAccountId") REFERENCES "DailyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_dailyAccountId_fkey" FOREIGN KEY ("dailyAccountId") REFERENCES "DailyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
