import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Decimal } from "../src/shared/money/decimal.js";
import { calculateInterest } from "../src/modules/interest-repayment/interest-engine.js";
import {
  assembleRepaymentSchedule,
  type RepaymentScheduleResult,
} from "../src/modules/interest-repayment/repayment-schedule-engine.js";
import { AppError } from "../src/shared/errors/app-error.js";

const MONEY_AMOUNT = /^(?:0|[1-9]\d*)\.\d{2}$/;

function rejection(body: unknown, expected: RegExp): void {
  assert.throws(
    () => assembleRepaymentSchedule(body),
    (error: unknown) => {
      if (!(error instanceof AppError)) {
        return false;
      }
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, expected);
      return true;
    },
  );
}

function assertChain(result: RepaymentScheduleResult): void {
  let totalPrincipal = new Decimal("0");
  let totalInterest = new Decimal("0");
  let previousClosing: Decimal | undefined;

  for (const entry of result.entries) {
    assert.match(entry.openingPrincipal, MONEY_AMOUNT);
    assert.match(entry.scheduledPrincipal, MONEY_AMOUNT);
    assert.match(entry.scheduledInterest, MONEY_AMOUNT);
    assert.match(entry.totalScheduledAmount, MONEY_AMOUNT);
    assert.match(entry.closingPrincipal, MONEY_AMOUNT);

    const opening = new Decimal(entry.openingPrincipal);
    const scheduledPrincipal = new Decimal(entry.scheduledPrincipal);
    const scheduledInterest = new Decimal(entry.scheduledInterest);
    const periodTotal = new Decimal(entry.totalScheduledAmount);
    const closing = new Decimal(entry.closingPrincipal);

    assert.equal(opening.greaterThanOrEqualTo(0), true);
    assert.equal(scheduledPrincipal.greaterThanOrEqualTo(0), true);
    assert.equal(scheduledInterest.greaterThanOrEqualTo(0), true);
    assert.equal(closing.greaterThanOrEqualTo(0), true);
    assert.equal(scheduledPrincipal.plus(scheduledInterest).equals(periodTotal), true);
    assert.equal(opening.minus(scheduledPrincipal).equals(closing), true);
    if (previousClosing !== undefined) {
      assert.equal(opening.equals(previousClosing), true);
    }
    previousClosing = closing;
    totalPrincipal = totalPrincipal.plus(scheduledPrincipal);
    totalInterest = totalInterest.plus(scheduledInterest);
  }

  const suppliedPrincipal = new Decimal(result.principalAmount);
  const remaining = suppliedPrincipal.minus(totalPrincipal);
  const finalEntry = result.entries[result.entries.length - 1];
  assert.ok(finalEntry);
  assert.equal(totalPrincipal.lessThanOrEqualTo(suppliedPrincipal), true);
  assert.equal(remaining.greaterThanOrEqualTo(0), true);
  assert.equal(totalPrincipal.equals(result.totalScheduledPrincipal), true);
  assert.equal(remaining.equals(result.remainingPrincipal), true);
  assert.equal(remaining.equals(finalEntry.closingPrincipal), true);
  assert.equal(totalInterest.equals(result.totalScheduledInterest), true);
  assert.equal(totalPrincipal.plus(totalInterest).equals(result.totalScheduledAmount), true);
  assert.equal(result.numberOfInstalments, result.entries.length);
}

describe("repayment schedule assembly", () => {
  it("assembles explicit dates and allocations without choosing a repayment method", () => {
    const interest = calculateInterest({
      calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
      principalAmount: "1000000.00",
      annualRate: "10.0000",
      allocationFrequency: "MONTHLY",
      recalculationFrequency: "ANNUAL",
    });
    const dueDates = [
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
      "2026-09-15",
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
    ];
    const principalAllocations = [
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "1000000.00",
    ];
    const result = assembleRepaymentSchedule({
      principalAmount: "1000000.00",
      dueDates,
      principalAllocations,
      interestAllocations: interest.allocations.map((allocation) => allocation.interestAmount),
    });

    assert.equal(result.numberOfInstalments, 12);
    assert.equal(result.totalScheduledPrincipal, "1000000.00");
    assert.equal(result.remainingPrincipal, "0.00");
    assert.equal(result.totalScheduledInterest, "100000.00");
    assert.equal(result.totalScheduledAmount, "1100000.00");
    assert.equal(result.entries[0]?.scheduledPrincipal, "0.00");
    assert.equal(result.entries[0]?.scheduledInterest, "8333.34");
    assert.equal(result.entries[0]?.totalScheduledAmount, "8333.34");
    assert.equal(result.entries[0]?.openingPrincipal, "1000000.00");
    assert.equal(result.entries[0]?.closingPrincipal, "1000000.00");
    assert.equal(result.entries[11]?.scheduledPrincipal, "1000000.00");
    assert.equal(result.entries[11]?.closingPrincipal, "0.00");
    assert.deepEqual(
      result.entries.map((entry) => entry.dueDate),
      dueDates,
    );
    assertChain(result);
  });

  it("represents an explicitly supplied zero principal period and zero interest", () => {
    const zeroPrincipalPeriod = assembleRepaymentSchedule({
      principalAmount: "150.00",
      dueDates: ["2026-01-31", "2026-02-28", "2026-03-31"],
      principalAllocations: ["100.00", "0.00", "50.00"],
      interestAllocations: ["1.25", "1.25", "0.50"],
    });
    assert.equal(zeroPrincipalPeriod.entries[1]?.scheduledPrincipal, "0.00");
    assert.equal(zeroPrincipalPeriod.entries[1]?.openingPrincipal, "50.00");
    assert.equal(zeroPrincipalPeriod.entries[1]?.closingPrincipal, "50.00");
    assert.equal(zeroPrincipalPeriod.totalScheduledInterest, "3.00");
    assert.equal(zeroPrincipalPeriod.totalScheduledAmount, "153.00");
    assertChain(zeroPrincipalPeriod);

    const zeroInterest = assembleRepaymentSchedule({
      principalAmount: "80.00",
      dueDates: ["2026-04-01"],
      principalAllocations: ["80.00"],
      interestAllocations: ["0.00"],
    });
    assert.equal(zeroInterest.entries[0]?.scheduledInterest, "0.00");
    assert.equal(zeroInterest.entries[0]?.totalScheduledAmount, "80.00");
    assert.equal(zeroInterest.totalScheduledInterest, "0.00");
    assertChain(zeroInterest);
  });

  it("keeps DECIMAL(18, 2) schedule totals exact", () => {
    const result = assembleRepaymentSchedule({
      principalAmount: "9999999999999999.00",
      dueDates: ["2026-06-01", "2026-07-01"],
      principalAllocations: ["1.00", "9999999999999998.00"],
      interestAllocations: ["0.50", "0.49"],
    });
    assert.equal(result.entries[0]?.closingPrincipal, "9999999999999998.00");
    assert.equal(result.entries[1]?.openingPrincipal, "9999999999999998.00");
    assert.equal(result.entries[1]?.closingPrincipal, "0.00");
    assert.equal(result.totalScheduledPrincipal, "9999999999999999.00");
    assert.equal(result.totalScheduledInterest, "0.99");
    assert.equal(result.totalScheduledAmount, "9999999999999999.99");
    assertChain(result);
  });

  it("rejects a negative principal allocation", () => {
    rejection(
      {
        principalAmount: "10.00",
        dueDates: ["2026-01-01"],
        principalAllocations: ["-10.00"],
        interestAllocations: ["0.00"],
      },
      /principalAllocations\.0 must not be negative/,
    );
  });

  it("rejects a negative interest allocation", () => {
    rejection(
      {
        principalAmount: "10.00",
        dueDates: ["2026-01-01"],
        principalAllocations: ["10.00"],
        interestAllocations: ["-0.01"],
      },
      /interestAllocations\.0 must not be negative/,
    );
  });

  it("rejects principal that exceeds the current opening or the supplied principal in total", () => {
    rejection(
      {
        principalAmount: "100.00",
        dueDates: ["2026-01-01", "2026-02-01"],
        principalAllocations: ["60.00", "50.00"],
        interestAllocations: ["0.00", "0.00"],
      },
      /principalAllocations\.1 exceeds opening principal/,
    );
  });

  it("rejects malformed money and JSON numbers", () => {
    rejection(
      {
        principalAmount: 100,
        dueDates: ["2026-01-01"],
        principalAllocations: ["100.00"],
        interestAllocations: ["0.00"],
      },
      /principalAmount must be a decimal string, not a number/,
    );
    rejection(
      {
        principalAmount: "100.00",
        dueDates: ["2026-01-01"],
        principalAllocations: ["100.001"],
        interestAllocations: ["0.00"],
      },
      /principalAllocations\.0 must be a non-negative decimal string/,
    );
  });

  it("rejects mismatched period counts", () => {
    rejection(
      {
        principalAmount: "10.00",
        dueDates: ["2026-01-01", "2026-02-01"],
        principalAllocations: ["10.00"],
        interestAllocations: ["0.00", "0.00"],
      },
      /must contain the same number of periods/,
    );
  });

  it("rejects an invalid ISO due date", () => {
    rejection(
      {
        principalAmount: "10.00",
        dueDates: ["2026-02-31"],
        principalAllocations: ["10.00"],
        interestAllocations: ["0.00"],
      },
      /dueDates\.0 must be a valid YYYY-MM-DD date/,
    );
  });

  it("rejects a duplicate due date", () => {
    rejection(
      {
        principalAmount: "10.00",
        dueDates: ["2026-01-01", "2026-01-01"],
        principalAllocations: ["5.00", "5.00"],
        interestAllocations: ["0.00", "0.00"],
      },
      /dueDates\.1 duplicates an earlier due date/,
    );
  });

  it("rejects due dates that are not strictly chronological", () => {
    rejection(
      {
        principalAmount: "10.00",
        dueDates: ["2026-03-01", "2026-01-15"],
        principalAllocations: ["4.00", "6.00"],
        interestAllocations: ["0.00", "0.00"],
      },
      /dueDates\.1 must be later than the previous due date/,
    );
  });

  it("rejects unresolved schedule policy fields", () => {
    rejection(
      {
        principalAmount: "10.00",
        dueDates: ["2026-01-01"],
        principalAllocations: ["10.00"],
        interestAllocations: ["0.00"],
        principalRepaymentMethod: "BULLET",
      },
      /principalRepaymentMethod is not resolved by the repayment schedule engine/,
    );
  });

  it("accepts a partial principal schedule and reports the remaining principal", () => {
    const result = assembleRepaymentSchedule({
      principalAmount: "1000000.00",
      dueDates: ["2026-01-15", "2026-02-15", "2026-03-15"],
      principalAllocations: ["20000.00", "20000.00", "20000.00"],
      interestAllocations: ["0.00", "0.00", "0.00"],
    });
    assert.equal(result.totalScheduledPrincipal, "60000.00");
    assert.equal(result.remainingPrincipal, "940000.00");
    assert.equal(result.entries[2]?.closingPrincipal, "940000.00");
    assert.equal(result.totalScheduledAmount, "60000.00");
    assertChain(result);
  });

  it("keeps JavaScript floating-point financial arithmetic out of the schedule engine", () => {
    const source = readFileSync(
      "src/modules/interest-repayment/repayment-schedule-engine.ts",
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.equal(source.includes("parseFloat"), false);
    assert.equal(source.includes("parseInt"), false);
    assert.equal(source.includes("Math."), false);
    assert.equal(source.includes(" * "), false);
    assert.equal(source.includes(" / "), false);
    assert.equal(source.includes("prisma"), false);
    assert.equal(source.includes("new Date"), false);
    assert.equal(source.includes("calculateInterest"), false);
  });
});
