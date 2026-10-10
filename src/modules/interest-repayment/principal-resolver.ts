import { AppError } from "../../shared/errors/app-error.js";
import {
  executablePrincipalBasisStrategies,
  principalBasisStrategies,
} from "./policy.constants.js";
import type { PrincipalBasisStrategy } from "./policy.types.js";

/**
 * Future facility interest calculations must obtain principal through this resolver.
 * MSPS has not confirmed a principal basis, so the registry is empty.
 * This module does not read facilities, disbursements, or ledger rows, and it does not
 * treat an authorized, disbursed, or outstanding amount as an interest basis.
 */

export const principalBasisRegistry: readonly PrincipalBasisStrategy[] = principalBasisStrategies;

/**
 * Reserved for a confirmed strategy. No field is interpreted while the registry is empty.
 */
export type PrincipalCalculationContext = Record<string, never>;

export type ResolvedPrincipal = {
  loanFacilityId: string;
  principalBasis: PrincipalBasisStrategy;
  principalAmount: string;
};

function validationError(message: string): AppError {
  return new AppError(400, message, "VALIDATION_ERROR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFacilityId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    throw validationError("loanFacilityId must be a non-empty string");
  }
  return value;
}

function requirePrincipalBasis(value: unknown): string {
  if (value === undefined || value === null) {
    throw validationError("principalBasis is required");
  }
  if (typeof value !== "string") {
    throw validationError(
      typeof value === "number"
        ? "principalBasis must be a strategy identifier, not a number"
        : "principalBasis must be a string",
    );
  }
  if (value.trim().length === 0 || value.trim() !== value) {
    throw validationError("principalBasis is required");
  }
  return value;
}

export function resolvePrincipal(input: unknown): ResolvedPrincipal {
  if (!isRecord(input)) {
    throw validationError("principal resolution input must be an object");
  }

  requireFacilityId(input.loanFacilityId);
  const principalBasis = requirePrincipalBasis(input.principalBasis);
  if (input.calculationContext !== undefined && !isRecord(input.calculationContext)) {
    throw validationError("calculationContext must be an object");
  }

  const recognized = principalBasisRegistry as readonly string[];
  if (!recognized.includes(principalBasis)) {
    throw validationError(
      `principalBasis: unrecognized strategy "${principalBasis}"; no principal basis strategies are confirmed`,
    );
  }

  if (!(executablePrincipalBasisStrategies as readonly string[]).includes(principalBasis)) {
    throw new AppError(
      409,
      `${principalBasis} is recognized but cannot be executed because no principal basis strategy is implemented`,
      "POLICY_NOT_EXECUTABLE",
    );
  }

  // A confirmed identifier still needs an explicit strategy implementation.
  // There is no zero or other fallback amount.
  throw new AppError(
    409,
    "MSPS principal basis is unconfirmed and no principal basis strategy is configured.",
    "POLICY_NOT_EXECUTABLE",
  );
}
