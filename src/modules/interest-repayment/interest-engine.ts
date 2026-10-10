import { AppError } from "../../shared/errors/app-error.js";
import {
  calculateAnnualInterestAllocation,
  type AnnualInterestAllocationResult,
} from "./annual-interest-allocation.js";
import {
  calculationStrategies,
  executableCalculationStrategies,
} from "./policy.constants.js";

/**
 * Interest calculation entry point.
 * It does not read facilities, disbursements, balances, or ProductVersion rows.
 * The caller must already have resolved the principal amount.
 */

const unresolvedWorkflowFields = [
  "principalBasis",
  "recalculationAnchor",
  "balanceChangeTreatment",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(message: string): AppError {
  return new AppError(400, message, "VALIDATION_ERROR");
}

export function calculateInterest(input: unknown): AnnualInterestAllocationResult {
  if (!isRecord(input)) {
    throw validationError("interest calculation input must be an object");
  }

  for (const field of unresolvedWorkflowFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw validationError(
        `${field} is not resolved by the interest calculation strategy`,
      );
    }
  }

  const strategy = input.calculationStrategy;
  if (typeof strategy !== "string" || strategy.trim().length === 0) {
    throw validationError(
      typeof strategy === "number"
        ? "calculationStrategy must be a strategy identifier, not a number"
        : "calculationStrategy is required",
    );
  }

  const calculationStrategy = strategy.trim();
  if (!(calculationStrategies as readonly string[]).includes(calculationStrategy)) {
    throw validationError(
      `calculationStrategy: unrecognized strategy "${calculationStrategy}"; recognized strategies: ${calculationStrategies.join(", ")}`,
    );
  }
  if (!executableCalculationStrategies.includes(calculationStrategy)) {
    throw new AppError(
      409,
      `${calculationStrategy} is recognized but cannot be executed because the interest engine is not implemented`,
      "POLICY_NOT_EXECUTABLE",
    );
  }

  return calculateAnnualInterestAllocation({
    principalAmount: input.principalAmount,
    annualRate: input.annualRate,
    allocationFrequency: input.allocationFrequency,
    recalculationFrequency: input.recalculationFrequency,
  });
}
