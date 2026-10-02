-- CreateEnum
CREATE TYPE "ApplicationDecisionType" AS ENUM ('APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoanApplicationStatus" ADD VALUE 'APPROVED';
ALTER TYPE "LoanApplicationStatus" ADD VALUE 'REJECTED';

-- CreateTable
CREATE TABLE "ApplicationDecision" (
    "id" TEXT NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "decision" "ApplicationDecisionType" NOT NULL,
    "remarks" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationDecision_loanApplicationId_idx" ON "ApplicationDecision"("loanApplicationId");

-- CreateIndex
CREATE INDEX "ApplicationDecision_loanApplicationId_decidedAt_idx" ON "ApplicationDecision"("loanApplicationId", "decidedAt");

-- AddForeignKey
ALTER TABLE "ApplicationDecision" ADD CONSTRAINT "ApplicationDecision_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
