-- CreateTable
CREATE TABLE "InterestCalculation" (
    "id" TEXT NOT NULL,
    "loanFacilityId" TEXT NOT NULL,
    "calculationStrategy" TEXT NOT NULL,
    "principalAmount" DECIMAL(18,2) NOT NULL,
    "annualRate" DECIMAL(18,4) NOT NULL,
    "annualInterestAmount" DECIMAL(18,2) NOT NULL,
    "allocationFrequency" TEXT NOT NULL,
    "recalculationFrequency" TEXT NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "inputSnapshot" JSONB NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterestCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterestAllocation" (
    "id" TEXT NOT NULL,
    "interestCalculationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "interestAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterestAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepaymentSchedule" (
    "id" TEXT NOT NULL,
    "loanFacilityId" TEXT NOT NULL,
    "interestCalculationId" TEXT,
    "principalAmount" DECIMAL(18,2) NOT NULL,
    "totalScheduledPrincipal" DECIMAL(18,2) NOT NULL,
    "totalScheduledInterest" DECIMAL(18,2) NOT NULL,
    "totalScheduledAmount" DECIMAL(18,2) NOT NULL,
    "remainingPrincipal" DECIMAL(18,2) NOT NULL,
    "numberOfInstalments" INTEGER NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepaymentScheduleEntry" (
    "id" TEXT NOT NULL,
    "repaymentScheduleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "openingPrincipal" DECIMAL(18,2) NOT NULL,
    "scheduledPrincipal" DECIMAL(18,2) NOT NULL,
    "scheduledInterest" DECIMAL(18,2) NOT NULL,
    "totalScheduledAmount" DECIMAL(18,2) NOT NULL,
    "closingPrincipal" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepaymentScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterestCalculation_loanFacilityId_idx" ON "InterestCalculation"("loanFacilityId");

-- CreateIndex
CREATE INDEX "InterestCalculation_loanFacilityId_createdAt_idx" ON "InterestCalculation"("loanFacilityId", "createdAt");

-- CreateIndex
CREATE INDEX "InterestAllocation_interestCalculationId_idx" ON "InterestAllocation"("interestCalculationId");

-- CreateIndex
CREATE UNIQUE INDEX "InterestAllocation_interestCalculationId_sequence_key" ON "InterestAllocation"("interestCalculationId", "sequence");

-- CreateIndex
CREATE INDEX "RepaymentSchedule_loanFacilityId_idx" ON "RepaymentSchedule"("loanFacilityId");

-- CreateIndex
CREATE INDEX "RepaymentSchedule_loanFacilityId_createdAt_idx" ON "RepaymentSchedule"("loanFacilityId", "createdAt");

-- CreateIndex
CREATE INDEX "RepaymentSchedule_interestCalculationId_idx" ON "RepaymentSchedule"("interestCalculationId");

-- CreateIndex
CREATE INDEX "RepaymentScheduleEntry_repaymentScheduleId_idx" ON "RepaymentScheduleEntry"("repaymentScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentScheduleEntry_repaymentScheduleId_sequence_key" ON "RepaymentScheduleEntry"("repaymentScheduleId", "sequence");

-- AddForeignKey
ALTER TABLE "InterestCalculation" ADD CONSTRAINT "InterestCalculation_loanFacilityId_fkey" FOREIGN KEY ("loanFacilityId") REFERENCES "LoanFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestAllocation" ADD CONSTRAINT "InterestAllocation_interestCalculationId_fkey" FOREIGN KEY ("interestCalculationId") REFERENCES "InterestCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentSchedule" ADD CONSTRAINT "RepaymentSchedule_loanFacilityId_fkey" FOREIGN KEY ("loanFacilityId") REFERENCES "LoanFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentSchedule" ADD CONSTRAINT "RepaymentSchedule_interestCalculationId_fkey" FOREIGN KEY ("interestCalculationId") REFERENCES "InterestCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentScheduleEntry" ADD CONSTRAINT "RepaymentScheduleEntry_repaymentScheduleId_fkey" FOREIGN KEY ("repaymentScheduleId") REFERENCES "RepaymentSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
