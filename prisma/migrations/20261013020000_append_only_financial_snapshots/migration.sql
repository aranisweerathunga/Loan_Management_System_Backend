-- Child snapshot links must not follow a parent key change.
ALTER TABLE "InterestAllocation" DROP CONSTRAINT "InterestAllocation_interestCalculationId_fkey";

ALTER TABLE "InterestAllocation" ADD CONSTRAINT "InterestAllocation_interestCalculationId_fkey" FOREIGN KEY ("interestCalculationId") REFERENCES "InterestCalculation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "RepaymentScheduleEntry" DROP CONSTRAINT "RepaymentScheduleEntry_repaymentScheduleId_fkey";

ALTER TABLE "RepaymentScheduleEntry" ADD CONSTRAINT "RepaymentScheduleEntry_repaymentScheduleId_fkey" FOREIGN KEY ("repaymentScheduleId") REFERENCES "RepaymentSchedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- No session setting or role check can skip this function. INSERT is unaffected.
CREATE FUNCTION "reject_financial_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'financial snapshot rows are append-only'
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$;

CREATE TRIGGER "InterestCalculation_append_only"
BEFORE UPDATE OR DELETE ON "InterestCalculation"
FOR EACH ROW
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "InterestCalculation_append_only_truncate"
BEFORE TRUNCATE ON "InterestCalculation"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "InterestAllocation_append_only"
BEFORE UPDATE OR DELETE ON "InterestAllocation"
FOR EACH ROW
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "InterestAllocation_append_only_truncate"
BEFORE TRUNCATE ON "InterestAllocation"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "RepaymentSchedule_append_only"
BEFORE UPDATE OR DELETE ON "RepaymentSchedule"
FOR EACH ROW
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "RepaymentSchedule_append_only_truncate"
BEFORE TRUNCATE ON "RepaymentSchedule"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "RepaymentScheduleEntry_append_only"
BEFORE UPDATE OR DELETE ON "RepaymentScheduleEntry"
FOR EACH ROW
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "RepaymentScheduleEntry_append_only_truncate"
BEFORE TRUNCATE ON "RepaymentScheduleEntry"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "FinancialSnapshotRequest_append_only"
BEFORE UPDATE OR DELETE ON "FinancialSnapshotRequest"
FOR EACH ROW
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

CREATE TRIGGER "FinancialSnapshotRequest_append_only_truncate"
BEFORE TRUNCATE ON "FinancialSnapshotRequest"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_financial_snapshot_mutation"();

ALTER TABLE "InterestCalculation" ENABLE ALWAYS TRIGGER "InterestCalculation_append_only";
ALTER TABLE "InterestCalculation" ENABLE ALWAYS TRIGGER "InterestCalculation_append_only_truncate";
ALTER TABLE "InterestAllocation" ENABLE ALWAYS TRIGGER "InterestAllocation_append_only";
ALTER TABLE "InterestAllocation" ENABLE ALWAYS TRIGGER "InterestAllocation_append_only_truncate";
ALTER TABLE "RepaymentSchedule" ENABLE ALWAYS TRIGGER "RepaymentSchedule_append_only";
ALTER TABLE "RepaymentSchedule" ENABLE ALWAYS TRIGGER "RepaymentSchedule_append_only_truncate";
ALTER TABLE "RepaymentScheduleEntry" ENABLE ALWAYS TRIGGER "RepaymentScheduleEntry_append_only";
ALTER TABLE "RepaymentScheduleEntry" ENABLE ALWAYS TRIGGER "RepaymentScheduleEntry_append_only_truncate";
ALTER TABLE "FinancialSnapshotRequest" ENABLE ALWAYS TRIGGER "FinancialSnapshotRequest_append_only";
ALTER TABLE "FinancialSnapshotRequest" ENABLE ALWAYS TRIGGER "FinancialSnapshotRequest_append_only_truncate";
