-- DropForeignKey
ALTER TABLE "InterestCalculation" DROP CONSTRAINT "InterestCalculation_loanFacilityId_fkey";

-- DropForeignKey
ALTER TABLE "RepaymentSchedule" DROP CONSTRAINT "RepaymentSchedule_interestCalculationId_fkey";

-- DropForeignKey
ALTER TABLE "RepaymentSchedule" DROP CONSTRAINT "RepaymentSchedule_loanFacilityId_fkey";

-- DropIndex
DROP INDEX "InterestCalculation_loanFacilityId_idx";

-- DropIndex
DROP INDEX "RepaymentSchedule_loanFacilityId_idx";

-- AlterTable
ALTER TABLE "InterestCalculation" ADD COLUMN     "historySequence" INTEGER NOT NULL,
ADD COLUMN     "productVersionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "RepaymentSchedule" ADD COLUMN     "historySequence" INTEGER NOT NULL,
ADD COLUMN     "productVersionId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "InterestCalculation_id_loanFacilityId_key" ON "InterestCalculation"("id", "loanFacilityId");

-- CreateIndex
CREATE UNIQUE INDEX "InterestCalculation_loanFacilityId_historySequence_key" ON "InterestCalculation"("loanFacilityId", "historySequence");

-- CreateIndex
CREATE UNIQUE INDEX "LoanFacility_id_productVersionId_key" ON "LoanFacility"("id", "productVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentSchedule_loanFacilityId_historySequence_key" ON "RepaymentSchedule"("loanFacilityId", "historySequence");

-- AddForeignKey
ALTER TABLE "InterestCalculation" ADD CONSTRAINT "InterestCalculation_loanFacilityId_productVersionId_fkey" FOREIGN KEY ("loanFacilityId", "productVersionId") REFERENCES "LoanFacility"("id", "productVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentSchedule" ADD CONSTRAINT "RepaymentSchedule_loanFacilityId_productVersionId_fkey" FOREIGN KEY ("loanFacilityId", "productVersionId") REFERENCES "LoanFacility"("id", "productVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentSchedule" ADD CONSTRAINT "RepaymentSchedule_interestCalculationId_loanFacilityId_fkey" FOREIGN KEY ("interestCalculationId", "loanFacilityId") REFERENCES "InterestCalculation"("id", "loanFacilityId") ON DELETE RESTRICT ON UPDATE CASCADE;
