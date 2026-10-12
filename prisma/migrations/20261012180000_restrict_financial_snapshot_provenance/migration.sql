-- DropForeignKey
ALTER TABLE "InterestCalculation" DROP CONSTRAINT "InterestCalculation_loanFacilityId_productVersionId_fkey";

-- DropForeignKey
ALTER TABLE "LoanApplication" DROP CONSTRAINT "LoanApplication_productVersionId_fkey";

-- DropForeignKey
ALTER TABLE "LoanFacility" DROP CONSTRAINT "LoanFacility_productVersionId_fkey";

-- DropForeignKey
ALTER TABLE "RepaymentSchedule" DROP CONSTRAINT "RepaymentSchedule_interestCalculationId_loanFacilityId_fkey";

-- DropForeignKey
ALTER TABLE "RepaymentSchedule" DROP CONSTRAINT "RepaymentSchedule_loanFacilityId_productVersionId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "ProductVersion_id_loanProductId_key" ON "ProductVersion"("id", "loanProductId");

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_productVersionId_loanProductId_fkey" FOREIGN KEY ("productVersionId", "loanProductId") REFERENCES "ProductVersion"("id", "loanProductId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LoanFacility" ADD CONSTRAINT "LoanFacility_productVersionId_loanProductId_fkey" FOREIGN KEY ("productVersionId", "loanProductId") REFERENCES "ProductVersion"("id", "loanProductId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InterestCalculation" ADD CONSTRAINT "InterestCalculation_loanFacilityId_productVersionId_fkey" FOREIGN KEY ("loanFacilityId", "productVersionId") REFERENCES "LoanFacility"("id", "productVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RepaymentSchedule" ADD CONSTRAINT "RepaymentSchedule_loanFacilityId_productVersionId_fkey" FOREIGN KEY ("loanFacilityId", "productVersionId") REFERENCES "LoanFacility"("id", "productVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RepaymentSchedule" ADD CONSTRAINT "RepaymentSchedule_interestCalculationId_loanFacilityId_fkey" FOREIGN KEY ("interestCalculationId", "loanFacilityId") REFERENCES "InterestCalculation"("id", "loanFacilityId") ON DELETE RESTRICT ON UPDATE RESTRICT;
