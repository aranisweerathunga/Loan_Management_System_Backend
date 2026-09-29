-- CreateEnum
CREATE TYPE "LoanApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "EligibilityAssessmentStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateTable
CREATE TABLE "LoanApplicationNumberSequence" (
    "calendarYear" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL,

    CONSTRAINT "LoanApplicationNumberSequence_pkey" PRIMARY KEY ("calendarYear")
);

-- CreateTable
CREATE TABLE "LoanApplication" (
    "id" TEXT NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "loanProductId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "productPurposeId" TEXT,
    "status" "LoanApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationStatusHistory" (
    "id" TEXT NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "fromStatus" "LoanApplicationStatus",
    "toStatus" "LoanApplicationStatus" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ApplicationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityAssessment" (
    "id" TEXT NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "status" "EligibilityAssessmentStatus" NOT NULL DEFAULT 'PENDING',
    "inputSnapshot" JSONB NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB,
    "assessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EligibilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanApplication_applicationNumber_key" ON "LoanApplication"("applicationNumber");

-- CreateIndex
CREATE INDEX "LoanApplication_borrowerId_idx" ON "LoanApplication"("borrowerId");

-- CreateIndex
CREATE INDEX "LoanApplication_status_idx" ON "LoanApplication"("status");

-- CreateIndex
CREATE INDEX "LoanApplication_loanProductId_idx" ON "LoanApplication"("loanProductId");

-- CreateIndex
CREATE INDEX "LoanApplication_productVersionId_idx" ON "LoanApplication"("productVersionId");

-- CreateIndex
CREATE INDEX "LoanApplication_productPurposeId_idx" ON "LoanApplication"("productPurposeId");

-- CreateIndex
CREATE INDEX "ApplicationStatusHistory_loanApplicationId_idx" ON "ApplicationStatusHistory"("loanApplicationId");

-- CreateIndex
CREATE INDEX "ApplicationStatusHistory_loanApplicationId_changedAt_idx" ON "ApplicationStatusHistory"("loanApplicationId", "changedAt");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_loanApplicationId_idx" ON "EligibilityAssessment"("loanApplicationId");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_productVersionId_idx" ON "EligibilityAssessment"("productVersionId");

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_loanProductId_fkey" FOREIGN KEY ("loanProductId") REFERENCES "LoanProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_productPurposeId_fkey" FOREIGN KEY ("productPurposeId") REFERENCES "ProductPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationStatusHistory" ADD CONSTRAINT "ApplicationStatusHistory_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityAssessment" ADD CONSTRAINT "EligibilityAssessment_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityAssessment" ADD CONSTRAINT "EligibilityAssessment_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
