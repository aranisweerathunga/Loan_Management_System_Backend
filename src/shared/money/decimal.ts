import { Decimal } from "decimal.js";
import { AppError } from "../errors/app-error.js";

/**
 * Financial invariant:
 * - Persist money/rates with Prisma Decimal / PostgreSQL NUMERIC.
 * - Calculate with decimal.js (or Prisma Decimal-safe operations).
 * - Never use native JavaScript number arithmetic for interest or money.
 */
export { Decimal };

const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

/** PostgreSQL DECIMAL(18, 2): 16 digits before the decimal point and 2 after. */
export const MAX_MONEY = new Decimal("9999999999999999.99");

export const MONEY_DECIMAL_PATTERN = DECIMAL_STRING;

export function parseNonNegativeMoneyString(value: string): Decimal {
  const normalized = value.trim();
  if (!DECIMAL_STRING.test(normalized)) {
    throw new AppError(400, "balance must be a non-negative decimal string with up to 2 decimal places", "VALIDATION_ERROR");
  }

  return new Decimal(normalized);
}

export function parsePositiveMoneyString(value: unknown, field = "amount"): Decimal {
  if (typeof value !== "string") {
    const message =
      typeof value === "number"
        ? `${field} must be a decimal string, not a number`
        : value === undefined
          ? `${field} is required`
          : `${field} must be a decimal string`;
    throw new AppError(400, message, "VALIDATION_ERROR");
  }

  const normalized = value.trim();
  if (normalized.startsWith("-")) {
    throw new AppError(400, `${field} must be greater than zero`, "VALIDATION_ERROR");
  }
  if (!DECIMAL_STRING.test(normalized)) {
    throw new AppError(
      400,
      `${field} must be a decimal string with up to 2 decimal places`,
      "VALIDATION_ERROR",
    );
  }

  const amount = new Decimal(normalized);
  if (!amount.greaterThan(0)) {
    throw new AppError(400, `${field} must be greater than zero`, "VALIDATION_ERROR");
  }
  if (amount.greaterThan(MAX_MONEY)) {
    throw new AppError(400, `${field} exceeds the supported monetary precision`, "VALIDATION_ERROR");
  }

  return amount;
}

export function formatMoney(value: Decimal | { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}
