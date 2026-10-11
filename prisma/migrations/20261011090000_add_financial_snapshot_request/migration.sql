-- CreateEnum
CREATE TYPE "FinancialSnapshotType" AS ENUM ('INTEREST_CALCULATION', 'REPAYMENT_SCHEDULE');

-- CreateTable
CREATE TABLE "FinancialSnapshotRequest" (
    "id" TEXT NOT NULL,
    "loanFacilityId" TEXT NOT NULL,
    "snapshotType" "FinancialSnapshotType" NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestFingerprint" VARCHAR(64) NOT NULL,
    "interestCalculationId" TEXT,
    "repaymentScheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialSnapshotRequest_pkey" PRIMARY KEY ("id")
);

-- The caller supplies idempotencyKey. Exactly one snapshot target must match snapshotType.
ALTER TABLE "FinancialSnapshotRequest" ADD CONSTRAINT "FinancialSnapshotRequest_snapshot_target_check" CHECK (
    (
        "snapshotType" = 'INTEREST_CALCULATION'
        AND "interestCalculationId" IS NOT NULL
        AND "repaymentScheduleId" IS NULL
    )
    OR
    (
        "snapshotType" = 'REPAYMENT_SCHEDULE'
        AND "repaymentScheduleId" IS NOT NULL
        AND "interestCalculationId" IS NULL
    )
);

-- SHA-256 hex digest. Prisma does not model this CHECK.
ALTER TABLE "FinancialSnapshotRequest" ADD CONSTRAINT "FinancialSnapshotRequest_requestFingerprint_check" CHECK (
    "requestFingerprint" ~ '^[0-9a-f]{64}$'
);

-- CreateIndex
CREATE INDEX "FinancialSnapshotRequest_interestCalculationId_idx" ON "FinancialSnapshotRequest"("interestCalculationId");

-- CreateIndex
CREATE INDEX "FinancialSnapshotRequest_repaymentScheduleId_idx" ON "FinancialSnapshotRequest"("repaymentScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSnapshotRequest_loanFacilityId_snapshotType_idempo_key" ON "FinancialSnapshotRequest"("loanFacilityId", "snapshotType", "idempotencyKey");

-- Existing schedule ids are already unique. This index is the composite foreign-key target.
CREATE UNIQUE INDEX "RepaymentSchedule_id_loanFacilityId_key" ON "RepaymentSchedule"("id", "loanFacilityId");

-- AddForeignKey
ALTER TABLE "FinancialSnapshotRequest" ADD CONSTRAINT "FinancialSnapshotRequest_loanFacilityId_fkey" FOREIGN KEY ("loanFacilityId") REFERENCES "LoanFacility"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialSnapshotRequest" ADD CONSTRAINT "FinancialSnapshotRequest_interestCalculationId_loanFacilit_fkey" FOREIGN KEY ("interestCalculationId", "loanFacilityId") REFERENCES "InterestCalculation"("id", "loanFacilityId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialSnapshotRequest" ADD CONSTRAINT "FinancialSnapshotRequest_repaymentScheduleId_loanFacilityI_fkey" FOREIGN KEY ("repaymentScheduleId", "loanFacilityId") REFERENCES "RepaymentSchedule"("id", "loanFacilityId") ON DELETE RESTRICT ON UPDATE RESTRICT;
