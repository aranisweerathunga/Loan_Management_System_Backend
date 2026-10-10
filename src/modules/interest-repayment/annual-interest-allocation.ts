import { AppError } from "../../shared/errors/app-error.js";
import {
  Decimal,
  MAX_MONEY,
  MONEY_DECIMAL_PLACES,
  formatMoney,
  parseNonNegativeMoneyAmount,
  roundMoney,
} from "../../shared/money/decimal.js";
import {
  ANNUAL_RATE_DECIMAL_PLACES,
  MAX_ANNUAL_RATE,
  allocationFrequencies,
  executableAllocationFrequencies,
  executableRecalculationFrequencies,
  recalculationFrequencies,
} from "./policy.constants.js";

/**
 * Pure ANNUAL_INTEREST_ALLOCATION calculation.
 * annualInterest = principalAmount multiplied by annualRate divided by 100.
 * The caller supplies an already-resolved principal. This module does not select a principal basis.
 * The rounded annual amount is then split across 12 periods in minor units.
 * Extra minor units are placed on the earliest periods.
 */

const ANNUAL_RATE_PATTERN = new RegExp(
  `^(?:0|[1-9]\\d*)(?:\\.\\d{1,${ANNUAL_RATE_DECIMAL_PLACES}})?$`,
);

const ONE_HUNDRED = new Decimal("100");
const ONE_MINOR_UNIT = new Decimal("1");
const MINOR_UNIT_FACTOR = new Decimal(10).pow(MONEY_DECIMAL_PLACES);
const ALLOCATION_PERIODS = new Decimal("12");
const ALLOCATION_SEQUENCES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type InterestAllocation = {
  sequence: number;
  interestAmount: string;
};

export type AnnualInterestAllocationResult = {
  calculationStrategy: "ANNUAL_INTEREST_ALLOCATION";
  principalAmount: string;
  annualRate: string;
  annualInterestAmount: string;
  allocationFrequency: "MONTHLY";
  recalculationFrequency: "ANNUAL";
  numberOfAllocations: number;
  allocations: InterestAllocation[];
};

export type AnnualInterestAllocationInput = {
  principalAmount: unknown;
  annualRate: unknown;
  allocationFrequency: unknown;
  recalculationFrequency: unknown;
};

function validationError(message: string): AppError {
  return new AppError(400, message, "VALIDATION_ERROR");
}

function parseAnnualRate(value: unknown): { rate: Decimal; canonical: string } {
  if (typeof value !== "string") {
    const message =
      typeof value === "number"
        ? "annualRate must be a decimal string, not a number"
        : value === undefined
          ? "annualRate is required"
          : "annualRate must be a decimal string";
    throw validationError(message);
  }

  const canonical = value.trim();
  if (canonical.startsWith("-")) {
    throw validationError("annualRate must not be negative");
  }
  if (!ANNUAL_RATE_PATTERN.test(canonical)) {
    throw validationError(
      `annualRate must be a non-negative decimal string with up to ${ANNUAL_RATE_DECIMAL_PLACES} decimal places`,
    );
  }

  const rate = new Decimal(canonical);
  if (!rate.isFinite() || rate.isNeg()) {
    throw validationError("annualRate must not be negative");
  }
  if (rate.greaterThan(MAX_ANNUAL_RATE)) {
    throw validationError("annualRate exceeds the supported decimal precision");
  }
  return { rate, canonical };
}

function requireExecutable(
  field: string,
  value: unknown,
  recognized: readonly string[],
  executable: readonly string[],
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(
      typeof value === "number"
        ? `${field} must be a strategy identifier, not a number`
        : `${field} is required`,
    );
  }

  const canonical = value.trim();
  if (!recognized.includes(canonical)) {
    throw validationError(
      `${field}: unrecognized strategy "${canonical}"; recognized strategies: ${recognized.join(", ")}`,
    );
  }
  if (!executable.includes(canonical)) {
    throw new AppError(
      409,
      `${canonical} is recognized but cannot be executed because the interest engine is not implemented`,
      "POLICY_NOT_EXECUTABLE",
    );
  }
  return canonical;
}

export function calculateAnnualInterestAllocation(
  input: AnnualInterestAllocationInput,
): AnnualInterestAllocationResult {
  const allocationFrequency = requireExecutable(
    "allocationFrequency",
    input.allocationFrequency,
    allocationFrequencies,
    executableAllocationFrequencies,
  );
  const recalculationFrequency = requireExecutable(
    "recalculationFrequency",
    input.recalculationFrequency,
    recalculationFrequencies,
    executableRecalculationFrequencies,
  );
  if (allocationFrequency !== "MONTHLY" || recalculationFrequency !== "ANNUAL") {
    throw new AppError(
      409,
      "The supplied allocation model is recognized but cannot be executed because the interest engine does not implement it",
      "POLICY_NOT_EXECUTABLE",
    );
  }

  const principal = parseNonNegativeMoneyAmount(input.principalAmount, "principalAmount");
  const { rate, canonical: annualRate } = parseAnnualRate(input.annualRate);
  const annualInterest = roundMoney(principal.mul(rate).div(ONE_HUNDRED));
  if (annualInterest.greaterThan(MAX_MONEY)) {
    throw validationError("annualInterestAmount exceeds the supported monetary precision");
  }

  const totalMinorUnits = annualInterest.mul(MINOR_UNIT_FACTOR);
  const baseMinorUnits = totalMinorUnits.dividedToIntegerBy(ALLOCATION_PERIODS);
  const remainderMinorUnits = totalMinorUnits.minus(baseMinorUnits.mul(ALLOCATION_PERIODS));
  const allocations: InterestAllocation[] = ALLOCATION_SEQUENCES.map((sequence) => {
    const receivesRemainder = new Decimal(sequence).lessThanOrEqualTo(remainderMinorUnits);
    const minorUnits = receivesRemainder ? baseMinorUnits.plus(ONE_MINOR_UNIT) : baseMinorUnits;
    if (minorUnits.isNeg()) {
      throw new AppError(500, "Monthly interest allocation is negative", "INTERNAL_SERVER_ERROR");
    }
    return {
      sequence,
      interestAmount: formatMoney(minorUnits.div(MINOR_UNIT_FACTOR)),
    };
  });

  const allocatedTotal = allocations.reduce(
    (total, allocation) => total.plus(allocation.interestAmount),
    new Decimal("0"),
  );
  if (!allocatedTotal.equals(annualInterest)) {
    throw new AppError(
      500,
      "Monthly interest allocations do not reconcile to annual interest",
      "INTERNAL_SERVER_ERROR",
    );
  }

  return {
    calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
    principalAmount: formatMoney(principal),
    annualRate,
    annualInterestAmount: formatMoney(annualInterest),
    allocationFrequency,
    recalculationFrequency,
    numberOfAllocations: allocations.length,
    allocations,
  };
}
