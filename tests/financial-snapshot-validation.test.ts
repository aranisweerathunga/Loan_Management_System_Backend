import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateInterest } from "../src/modules/interest-repayment/interest-engine.js";
import { assembleRepaymentSchedule } from "../src/modules/interest-repayment/repayment-schedule-engine.js";
import {
  validateInterestCalculationSnapshot,
  validateRepaymentScheduleSnapshot,
} from "../src/modules/interest-repayment/snapshot-validation.js";
import { AppError } from "../src/shared/errors/app-error.js";

const context = { facilityId: "facility-1", productVersionId: "version-1" };

function rejection(run: () => unknown, expected: RegExp): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.match(error.message, expected);
    return true;
  });
}

function interestPayload(overrides: Record<string, unknown> = {}) {
  const result = calculateInterest({
    calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
    principalAmount: "1000000.00",
    annualRate: "10.0000",
    allocationFrequency: "MONTHLY",
    recalculationFrequency: "ANNUAL",
  });
  return {
    loanFacilityId: context.facilityId,
    productVersionId: context.productVersionId,
    historySequence: 1,
    calculationStrategy: result.calculationStrategy,
    principalAmount: result.principalAmount,
    annualRate: result.annualRate,
    annualInterestAmount: result.annualInterestAmount,
    allocationFrequency: result.allocationFrequency,
    recalculationFrequency: result.recalculationFrequency,
    periodStart: null,
    periodEnd: null,
    allocations: result.allocations,
    inputSnapshot: {
      principalAmount: result.principalAmount,
      annualRate: result.annualRate,
      calculationStrategy: result.calculationStrategy,
      allocationFrequency: result.allocationFrequency,
      recalculationFrequency: result.recalculationFrequency,
      periodStart: null,
      periodEnd: null,
    },
    policySnapshot: {
      interestPolicy: {
        annualRate: result.annualRate,
        calculationStrategy: result.calculationStrategy,
        allocationFrequency: result.allocationFrequency,
        recalculationFrequency: result.recalculationFrequency,
      },
    },
    resultSnapshot: result,
    ...overrides,
  };
}

function schedulePayload(
  assembledInput: {
    principalAmount: string;
    dueDates: string[];
    principalAllocations: string[];
    interestAllocations: string[];
  },
  overrides: Record<string, unknown> = {},
) {
  const result = assembleRepaymentSchedule(assembledInput);
  return {
    loanFacilityId: context.facilityId,
    productVersionId: context.productVersionId,
    historySequence: 1,
    principalAmount: result.principalAmount,
    totalScheduledPrincipal: result.totalScheduledPrincipal,
    totalScheduledInterest: result.totalScheduledInterest,
    totalScheduledAmount: result.totalScheduledAmount,
    remainingPrincipal: result.remainingPrincipal,
    numberOfInstalments: result.numberOfInstalments,
    entries: result.entries,
    inputSnapshot: assembledInput,
    policySnapshot: {
      interestPolicy: {
        annualRate: "10.0000",
        calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
        allocationFrequency: "MONTHLY",
        recalculationFrequency: "ANNUAL",
      },
    },
    resultSnapshot: result,
    ...overrides,
  };
}

const fullSchedule = {
  principalAmount: "100.00",
  dueDates: ["2026-01-15", "2026-02-15"],
  principalAllocations: ["40.00", "60.00"],
  interestAllocations: ["1.00", "2.00"],
};

const partialSchedule = {
  principalAmount: "1000000.00",
  dueDates: ["2026-03-15", "2026-04-15", "2026-05-15"],
  principalAllocations: ["20000.00", "20000.00", "20000.00"],
  interestAllocations: ["0.00", "0.00", "0.00"],
};

const supportedInterestPolicy = {
  annualRate: "10.0000",
  calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
  allocationFrequency: "MONTHLY",
  recalculationFrequency: "ANNUAL",
};

describe("financial snapshot validation", () => {
  it("accepts an interest calculation snapshot that matches the engine result", () => {
    const validated = validateInterestCalculationSnapshot(interestPayload(), context);
    assert.equal(validated.annualInterestAmount, "100000.00");
    assert.equal(validated.allocations.length, 12);
    assert.equal(validated.allocations[0]?.interestAmount, "8333.34");
    assert.equal(validated.periodStart, null);
    assert.equal(validated.periodEnd, null);
  });

  it("accepts a full schedule and a partial schedule", () => {
    const full = validateRepaymentScheduleSnapshot(schedulePayload(fullSchedule), context);
    assert.equal(full.remainingPrincipal, "0.00");
    assert.equal(full.interestCalculationId, null);
    const partial = validateRepaymentScheduleSnapshot(schedulePayload(partialSchedule), context);
    assert.equal(partial.remainingPrincipal, "940000.00");
    assert.equal(partial.entries[2]?.closingPrincipal, "940000.00");
  });

  it("accepts an optional calculation link and supplied period bounds", () => {
    const linked = validateRepaymentScheduleSnapshot(
      schedulePayload(fullSchedule, { interestCalculationId: "calculation-1" }),
      context,
    );
    assert.equal(linked.interestCalculationId, "calculation-1");

    const bounded = interestPayload();
    bounded.periodStart = "2026-01-01";
    bounded.periodEnd = "2026-12-31";
    bounded.inputSnapshot = {
      ...bounded.inputSnapshot,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    };
    const validated = validateInterestCalculationSnapshot(bounded, context);
    assert.equal(validated.periodStart, "2026-01-01");
    assert.equal(validated.periodEnd, "2026-12-31");
  });

  it("rejects an interest allocation mismatch", () => {
    const payload = interestPayload();
    payload.allocations = payload.allocations.map((allocation, index) =>
      index === 0 ? { ...allocation, interestAmount: "8333.33" } : allocation,
    );
    rejection(
      () => validateInterestCalculationSnapshot(payload, context),
      /interest allocations must sum exactly to annualInterestAmount/,
    );
  });

  it("rejects missing and duplicate sequences", () => {
    const interest = interestPayload();
    interest.allocations = interest.allocations.slice(0, 11);
    rejection(
      () => validateInterestCalculationSnapshot(interest, context),
      /allocations must contain the 12 monthly interest allocations/,
    );

    const schedule = schedulePayload(fullSchedule);
    schedule.entries = [
      { ...schedule.entries[0], sequence: 1 },
      { ...schedule.entries[1], sequence: 1 },
    ];
    rejection(
      () => validateRepaymentScheduleSnapshot(schedule, context),
      /entries must use consecutive sequences starting at 1/,
    );
  });

  it("rejects negative amounts, monetary overflow, and annual-rate overflow", () => {
    rejection(
      () => validateInterestCalculationSnapshot(interestPayload({ principalAmount: "-1.00" }), context),
      /principalAmount must not be negative/,
    );
    rejection(
      () =>
        validateInterestCalculationSnapshot(
          interestPayload({ principalAmount: "10000000000000000.00" }),
          context,
        ),
      /principalAmount exceeds the supported monetary precision/,
    );
    rejection(
      () => validateInterestCalculationSnapshot(interestPayload({ annualRate: "100000000000000.0000" }), context),
      /annualRate exceeds the supported decimal precision/,
    );
  });

  it("rejects JSON numeric financial values", () => {
    const payload = interestPayload();
    payload.resultSnapshot = { ...payload.resultSnapshot, annualInterestAmount: 100000 };
    rejection(
      () => validateInterestCalculationSnapshot(payload, context),
      /resultSnapshot\.annualInterestAmount must be a decimal string, not a number/,
    );
  });

  it("rejects snapshots that disagree with the relational values", () => {
    const payload = interestPayload();
    payload.inputSnapshot = { ...payload.inputSnapshot, principalAmount: "1.00" };
    rejection(
      () => validateInterestCalculationSnapshot(payload, context),
      /inputSnapshot does not match the proposed relational values/,
    );
  });

  it("rejects the wrong facility and the wrong ProductVersion", () => {
    rejection(
      () => validateInterestCalculationSnapshot(interestPayload({ loanFacilityId: "facility-2" }), context),
      /loanFacilityId does not match the facility context/,
    );
    rejection(
      () => validateRepaymentScheduleSnapshot(schedulePayload(fullSchedule, { productVersionId: "version-2" }), context),
      /productVersionId does not match the facility context/,
    );
  });

  it("rejects invalid due dates and an incorrect principal chain", () => {
    const dates = schedulePayload(fullSchedule);
    dates.entries = dates.entries.map((entry, index) =>
      index === 1 ? { ...entry, dueDate: "2026-02-31" } : entry,
    );
    dates.inputSnapshot = {
      ...dates.inputSnapshot,
      dueDates: dates.entries.map((entry) => entry.dueDate),
    };
    rejection(
      () => validateRepaymentScheduleSnapshot(dates, context),
      /dueDate must be a valid YYYY-MM-DD date/,
    );

    const chain = schedulePayload(fullSchedule);
    chain.entries = chain.entries.map((entry, index) =>
      index === 0 ? { ...entry, closingPrincipal: "50.00" } : entry,
    );
    rejection(
      () => validateRepaymentScheduleSnapshot(chain, context),
      /repayment schedule does not match the assembled schedule entries/,
    );
  });

  it("rejects incorrect schedule totals and remaining principal", () => {
    rejection(
      () => validateRepaymentScheduleSnapshot(schedulePayload(fullSchedule, { totalScheduledAmount: "1.00" }), context),
      /repayment schedule does not match the assembled schedule entries/,
    );
    rejection(
      () => validateRepaymentScheduleSnapshot(schedulePayload(partialSchedule, { remainingPrincipal: "0.00" }), context),
      /repayment schedule does not match the assembled schedule entries/,
    );
  });

  it("rejects missing policy provenance and a period that ends before it starts", () => {
    rejection(
      () => validateInterestCalculationSnapshot(interestPayload({ policySnapshot: {} }), context),
      /policySnapshot must record the ProductVersion policy applied to this calculation/,
    );
    const payload = interestPayload();
    payload.periodStart = "2026-12-31";
    payload.periodEnd = "2026-01-01";
    payload.inputSnapshot = {
      ...payload.inputSnapshot,
      periodStart: "2026-12-31",
      periodEnd: "2026-01-01",
    };
    rejection(
      () => validateInterestCalculationSnapshot(payload, context),
      /periodEnd must not precede periodStart/,
    );
  });

  it("accepts supported optional policy fields and engine decimal strings", () => {
    const interest = interestPayload();
    interest.policySnapshot = {
      interestPolicy: {
        ...supportedInterestPolicy,
        annualRate: interest.annualRate,
        balanceChangeTreatment: "SUPPLEMENTARY_CALCULATION",
      },
    };
    const validatedInterest = validateInterestCalculationSnapshot(interest, context);
    assert.equal(validatedInterest.allocations[0]?.interestAmount, "8333.34");
    assert.equal(validatedInterest.allocations[11]?.interestAmount, "8333.33");

    const schedule = validateRepaymentScheduleSnapshot(
      schedulePayload(partialSchedule, {
        policySnapshot: {
          interestPolicy: {
            ...supportedInterestPolicy,
            balanceChangeTreatment: "NEXT_SCHEDULED_RECALCULATION",
          },
          repaymentPolicy: {
            paymentAllocationPriority: ["PRINCIPAL", "INTEREST"],
          },
        },
      }),
      context,
    );
    assert.equal(schedule.remainingPrincipal, "940000.00");
    assert.equal(schedule.entries[0]?.scheduledPrincipal, "20000.00");
  });

  it("rejects an interest policy made of arbitrary, malformed, or unsupported fields", () => {
    rejection(
      () =>
        validateRepaymentScheduleSnapshot(
          schedulePayload(fullSchedule, { policySnapshot: { interestPolicy: { anything: true } } }),
          context,
        ),
      /Unrecognized key/,
    );
    rejection(
      () =>
        validateRepaymentScheduleSnapshot(
          schedulePayload(fullSchedule, {
            policySnapshot: { interestPolicy: { ...supportedInterestPolicy, annualRate: "10.00000" } },
          }),
          context,
        ),
      /annualRate must be a non-negative decimal string/,
    );
    rejection(
      () =>
        validateRepaymentScheduleSnapshot(
          schedulePayload(fullSchedule, {
            policySnapshot: { interestPolicy: { ...supportedInterestPolicy, calculationStrategy: "DAILY_ACCRUAL" } },
          }),
          context,
        ),
      /unrecognized strategy "DAILY_ACCRUAL"/,
    );
  });

  it("rejects unknown policy snapshot keys, malformed repayment policy, and padded policy values", () => {
    rejection(
      () =>
        validateInterestCalculationSnapshot(
          interestPayload({ policySnapshot: { interestPolicy: supportedInterestPolicy, audit: true } }),
          context,
        ),
      /policySnapshot\.audit is not part of the snapshot/,
    );
    rejection(
      () =>
        validateRepaymentScheduleSnapshot(
          schedulePayload(fullSchedule, {
            policySnapshot: { interestPolicy: supportedInterestPolicy, notes: "copied" },
          }),
          context,
        ),
      /policySnapshot\.notes is not part of the snapshot/,
    );
    rejection(
      () =>
        validateRepaymentScheduleSnapshot(
          schedulePayload(fullSchedule, { policySnapshot: { repaymentPolicy: { feeOrder: true } } }),
          context,
        ),
      /Unrecognized key/,
    );
    rejection(
      () =>
        validateRepaymentScheduleSnapshot(
          schedulePayload(fullSchedule, {
            policySnapshot: { interestPolicy: { ...supportedInterestPolicy, annualRate: " 10.0000 " } },
          }),
          context,
        ),
      /policySnapshot\.interestPolicy does not match its validated representation/,
    );
  });

  it("rejects extra allocation and schedule-entry fields", () => {
    const interest = interestPayload();
    interest.allocations = interest.allocations.map((allocation, index) =>
      index === 0 ? { ...allocation, note: "adjusted" } : allocation,
    );
    rejection(
      () => validateInterestCalculationSnapshot(interest, context),
      /allocations\.0\.note is not part of the snapshot/,
    );

    const schedule = schedulePayload(fullSchedule);
    schedule.entries = schedule.entries.map((entry, index) =>
      index === 0 ? { ...entry, comment: "adjusted" } : entry,
    );
    rejection(
      () => validateRepaymentScheduleSnapshot(schedule, context),
      /entries\.0\.comment is not part of the snapshot/,
    );
  });
});
