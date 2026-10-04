-- CreateEnum
CREATE TYPE "LoanFacilityStatus" AS ENUM ('PENDING_DISBURSEMENT', 'ACTIVE');

-- CreateEnum
CREATE TYPE "LoanTransactionType" AS ENUM ('DISBURSEMENT');

-- AlterTable
ALTER TABLE "ApplicationDecision" ADD COLUMN     "authorizedPrincipalAmount" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "LoanFacilityNumberSequence" (
    "calendarYear" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL,

    CONSTRAINT "LoanFacilityNumberSequence_pkey" PRIMARY KEY ("calendarYear")
);

-- CreateTable
CREATE TABLE "LoanFacility" (
    "id" TEXT NOT NULL,
    "facilityNumber" TEXT NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "loanProductId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "productPurposeId" TEXT,
    "authorizedPrincipalAmount" DECIMAL(18,2) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "facilityDate" DATE NOT NULL,
    "status" "LoanFacilityStatus" NOT NULL DEFAULT 'PENDING_DISBURSEMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanFacility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanDisbursement" (
    "id" TEXT NOT NULL,
    "loanFacilityId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "disbursementDate" DATE NOT NULL,
    "reference" VARCHAR(120),
    "remarks" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanTransaction" (
    "id" TEXT NOT NULL,
    "loanFacilityId" TEXT NOT NULL,
    "type" "LoanTransactionType" NOT NULL,
    "principalAmount" DECIMAL(18,2) NOT NULL,
    "transactionDate" DATE NOT NULL,
    "loanDisbursementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanFacility_facilityNumber_key" ON "LoanFacility"("facilityNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LoanFacility_loanApplicationId_key" ON "LoanFacility"("loanApplicationId");

-- CreateIndex
CREATE INDEX "LoanFacility_borrowerId_idx" ON "LoanFacility"("borrowerId");

-- CreateIndex
CREATE INDEX "LoanFacility_loanProductId_idx" ON "LoanFacility"("loanProductId");

-- CreateIndex
CREATE INDEX "LoanFacility_productVersionId_idx" ON "LoanFacility"("productVersionId");

-- CreateIndex
CREATE INDEX "LoanFacility_productPurposeId_idx" ON "LoanFacility"("productPurposeId");

-- CreateIndex
CREATE INDEX "LoanFacility_status_idx" ON "LoanFacility"("status");

-- CreateIndex
CREATE INDEX "LoanDisbursement_loanFacilityId_idx" ON "LoanDisbursement"("loanFacilityId");

-- CreateIndex
CREATE INDEX "LoanDisbursement_loanFacilityId_disbursementDate_idx" ON "LoanDisbursement"("loanFacilityId", "disbursementDate");

-- CreateIndex
CREATE UNIQUE INDEX "LoanTransaction_loanDisbursementId_key" ON "LoanTransaction"("loanDisbursementId");

-- CreateIndex
CREATE INDEX "LoanTransaction_loanFacilityId_idx" ON "LoanTransaction"("loanFacilityId");

-- CreateIndex
CREATE INDEX "LoanTransaction_loanFacilityId_transactionDate_idx" ON "LoanTransaction"("loanFacilityId", "transactionDate");

-- AddForeignKey
ALTER TABLE "LoanFacility" ADD CONSTRAINT "LoanFacility_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanFacility" ADD CONSTRAINT "LoanFacility_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanFacility" ADD CONSTRAINT "LoanFacility_loanProductId_fkey" FOREIGN KEY ("loanProductId") REFERENCES "LoanProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanFacility" ADD CONSTRAINT "LoanFacility_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanFacility" ADD CONSTRAINT "LoanFacility_productPurposeId_fkey" FOREIGN KEY ("productPurposeId") REFERENCES "ProductPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanDisbursement" ADD CONSTRAINT "LoanDisbursement_loanFacilityId_fkey" FOREIGN KEY ("loanFacilityId") REFERENCES "LoanFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanTransaction" ADD CONSTRAINT "LoanTransaction_loanFacilityId_fkey" FOREIGN KEY ("loanFacilityId") REFERENCES "LoanFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanTransaction" ADD CONSTRAINT "LoanTransaction_loanDisbursementId_fkey" FOREIGN KEY ("loanDisbursementId") REFERENCES "LoanDisbursement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
