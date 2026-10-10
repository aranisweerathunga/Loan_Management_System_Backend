import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Decimal, formatMoney, MONETARY_ROUNDING } from "../src/shared/money/decimal.js";
import { calculateInterest } from "../src/modules/interest-repayment/interest-engine.js";
import type { AnnualInterestAllocationResult } from "../src/modules/interest-repayment/annual-interest-allocation.js";
import { AppError } from "../src/shared/errors/app-error.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
    principalAmount: "1000000.00",
    annualRate: "10.0000",
    allocationFrequency: "MONTHLY",
    recalculationFrequency: "ANNUAL",
    ...overrides,
  };
}

function allocationTotal(result: AnnualInterestAllocationResult): Decimal {
  return result.allocations.reduce(
    (total, allocation) => total.plus(allocation.interestAmount),
    new Decimal("0"),
  );
}

const MONEY_AMOUNT = /^(?:0|[1-9]\d*)\.\d{2}$/;

function assertDistribution(result: AnnualInterestAllocationResult): void {
  assert.equal(result.allocations.length, 12);
  assert.equal(allocationTotal(result).toFixed(2), result.annualInterestAmount);
  const amounts = result.allocations.map((allocation) => new Decimal(allocation.interestAmount));
  assert.ok(amounts.every((amount) => amount.greaterThanOrEqualTo(0)));
  assert.ok(result.allocations.every((allocation) => MONEY_AMOUNT.test(allocation.interestAmount)));
  const smallest = amounts.reduce((current, amount) => Decimal.min(current, amount));
  const largest = amounts.reduce((current, amount) => Decimal.max(current, amount));
  assert.equal(largest.minus(smallest).lessThanOrEqualTo("0.01"), true);
}

function rejection(overrides: Record<string, unknown>, expected: RegExp): void {
  assert.throws(
    () => calculateInterest(input(overrides)),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, expected);
      return true;
    },
  );
}

describe("ANNUAL_INTEREST_ALLOCATION", () => {
  it("calculates 1,000,000.00 at 10% as annual interest 100,000.00", () => {
    const result = calculateInterest(input());
    assert.equal(result.principalAmount, "1000000.00");
    assert.equal(result.annualRate, "10.0000");
    assert.equal(result.annualInterestAmount, "100000.00");
    assert.equal(result.calculationStrategy, "ANNUAL_INTEREST_ALLOCATION");
    assert.equal(result.allocationFrequency, "MONTHLY");
    assert.equal(result.recalculationFrequency, "ANNUAL");
    assert.equal(result.numberOfAllocations, 12);
    assert.equal(result.allocations.length, 12);
  });

  it("reconciles twelve monthly allocations to 100,000.00", () => {
    const result = calculateInterest(input());
    assert.deepEqual(
      result.allocations.map((allocation) => allocation.interestAmount),
      [
        "8333.34",
        "8333.34",
        "8333.34",
        "8333.34",
        "8333.33",
        "8333.33",
        "8333.33",
        "8333.33",
        "8333.33",
        "8333.33",
        "8333.33",
        "8333.33",
      ],
    );
    assert.deepEqual(
      result.allocations.map((allocation) => allocation.sequence),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    assert.equal(allocationTotal(result).toFixed(2), "100000.00");
    assert.equal(allocationTotal(result).equals(result.annualInterestAmount), true);
    assertDistribution(result);
  });

  it("distributes 0.78 with extra minor units on the earliest periods", () => {
    const result = calculateInterest(
      input({ principalAmount: "7.80", annualRate: "10.0000" }),
    );
    assert.equal(result.annualInterestAmount, "0.78");
    assert.deepEqual(
      result.allocations.map((allocation) => allocation.interestAmount),
      ["0.07", "0.07", "0.07", "0.07", "0.07", "0.07", "0.06", "0.06", "0.06", "0.06", "0.06", "0.06"],
    );
    assertDistribution(result);
  });

  it("distributes 0.10 with no negative allocation", () => {
    const result = calculateInterest(
      input({ principalAmount: "1.00", annualRate: "10.0000" }),
    );
    assert.equal(result.annualInterestAmount, "0.10");
    assert.deepEqual(
      result.allocations.map((allocation) => allocation.interestAmount),
      ["0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.00", "0.00"],
    );
    assertDistribution(result);
  });

  it("distributes 0.01 across 12 periods", () => {
    const result = calculateInterest(
      input({ principalAmount: "0.10", annualRate: "10.0000" }),
    );
    assert.equal(result.annualInterestAmount, "0.01");
    assert.equal(result.allocations[0]?.interestAmount, "0.01");
    assert.ok(result.allocations.slice(1).every((allocation) => allocation.interestAmount === "0.00"));
    assertDistribution(result);
  });

  it("allocates an evenly divisible annual interest amount", () => {
    const result = calculateInterest(
      input({ principalAmount: "1200.00", annualRate: "10.0000" }),
    );
    assert.equal(result.annualInterestAmount, "120.00");
    assert.ok(result.allocations.every((allocation) => allocation.interestAmount === "10.00"));
    assert.equal(allocationTotal(result).toFixed(2), "120.00");
  });

  it("produces zero interest for zero principal", () => {
    const result = calculateInterest(input({ principalAmount: "0.00" }));
    assert.equal(result.annualInterestAmount, "0.00");
    assert.ok(result.allocations.every((allocation) => allocation.interestAmount === "0.00"));
    assert.equal(allocationTotal(result).toFixed(2), "0.00");
  });

  it("produces zero interest for a zero annual rate", () => {
    const result = calculateInterest(
      input({ principalAmount: "1000000.00", annualRate: "0" }),
    );
    assert.equal(result.annualRate, "0");
    assert.equal(result.annualInterestAmount, "0.00");
    assert.ok(result.allocations.every((allocation) => allocation.interestAmount === "0.00"));
  });

  it("keeps DECIMAL(18, 2) principal precision", () => {
    const result = calculateInterest(
      input({ principalAmount: "9999999999999999.99", annualRate: "1.0000" }),
    );
    assert.equal(result.principalAmount, "9999999999999999.99");
    assert.equal(result.annualInterestAmount, "100000000000000.00");
    assert.equal(result.allocations[0]?.interestAmount, "8333333333333.34");
    assert.equal(result.allocations[3]?.interestAmount, "8333333333333.34");
    assert.equal(result.allocations[4]?.interestAmount, "8333333333333.33");
    assert.equal(result.allocations[11]?.interestAmount, "8333333333333.33");
    assert.equal(allocationTotal(result).toFixed(2), "100000000000000.00");
    assertDistribution(result);
  });

  it("rejects a negative principal", () => {
    rejection({ principalAmount: "-1.00" }, /principalAmount must not be negative/);
  });

  it("rejects a negative annual rate", () => {
    rejection({ annualRate: "-1.0000" }, /annualRate must not be negative/);
  });

  it("rejects malformed decimal input and JSON numbers", () => {
    rejection({ principalAmount: "1000000.001" }, /principalAmount must be a non-negative decimal string/);
    rejection({ principalAmount: "abc" }, /principalAmount must be a non-negative decimal string/);
    rejection({ principalAmount: 1000000 }, /principalAmount must be a decimal string, not a number/);
    rejection({ annualRate: "10.12345" }, /annualRate must be a non-negative decimal string/);
    rejection({ annualRate: 10 }, /annualRate must be a decimal string, not a number/);
    rejection({ annualRate: "1e2" }, /annualRate must be a non-negative decimal string/);
  });

  it("rejects an unsupported allocation frequency", () => {
    rejection({ allocationFrequency: "DAILY" }, /allocationFrequency: unrecognized strategy "DAILY"/);
  });

  it("rejects an unsupported calculation strategy", () => {
    rejection(
      { calculationStrategy: "DAILY_ACCRUAL" },
      /calculationStrategy: unrecognized strategy "DAILY_ACCRUAL"/,
    );
  });

  it("rejects an unsupported recalculation frequency", () => {
    rejection(
      { recalculationFrequency: "MONTHLY" },
      /recalculationFrequency: unrecognized strategy "MONTHLY"/,
    );
  });

  it("does not accept an unresolved principal basis, anchor, or balance-change treatment", () => {
    rejection(
      { principalBasis: "OUTSTANDING_PRINCIPAL" },
      /principalBasis is not resolved by the interest calculation strategy/,
    );
    rejection(
      { recalculationAnchor: "CALENDAR_YEAR" },
      /recalculationAnchor is not resolved by the interest calculation strategy/,
    );
    rejection(
      { balanceChangeTreatment: "IMMEDIATE_RECALCULATION" },
      /balanceChangeTreatment is not resolved by the interest calculation strategy/,
    );
  });

  it("accepts the storage-maximum annual rate and still limits calculated interest", () => {
    const maximum = "99999999999999.9999";
    const zeroPrincipal = calculateInterest(input({ principalAmount: "0.00", annualRate: maximum }));
    assert.equal(zeroPrincipal.annualRate, maximum);
    assert.equal(zeroPrincipal.annualInterestAmount, "0.00");
    rejection(
      { annualRate: "100000000000000.0000" },
      /annualRate exceeds the supported decimal precision/,
    );
    rejection(
      { principalAmount: "9999999999999999.99", annualRate: maximum },
      /annualInterestAmount exceeds the supported monetary precision/,
    );
  });

  it("formats money with the shared half-up rounding mode", () => {
    assert.equal(MONETARY_ROUNDING, Decimal.ROUND_HALF_UP);
    assert.equal(formatMoney(new Decimal("1.005")), "1.01");
    assert.equal(formatMoney(new Decimal("1.004")), "1.00");
    assert.equal(formatMoney(new Decimal("-1.005")), "-1.01");
  });

  it("keeps JavaScript floating-point arithmetic out of the calculation modules", () => {
    const files = [
      "src/modules/interest-repayment/annual-interest-allocation.ts",
      "src/modules/interest-repayment/interest-engine.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.equal(source.includes("parseFloat"), false, file);
      assert.equal(source.includes("parseInt"), false, file);
      assert.equal(source.includes("Math."), false, file);
      assert.equal(source.includes(" * "), false, file);
      assert.equal(source.includes(" / "), false, file);
      assert.equal(source.includes("prisma"), false, file);
      assert.equal(source.includes("loan-facility"), false, file);
    }
  });
});
