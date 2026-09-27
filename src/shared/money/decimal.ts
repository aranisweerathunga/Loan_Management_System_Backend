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

export function parseNonNegativeMoneyString(value: string): Decimal {
  const normalized = value.trim();
  if (!DECIMAL_STRING.test(normalized)) {
    throw new AppError(400, "balance must be a non-negative decimal string with up to 2 decimal places", "VALIDATION_ERROR");
  }

  return new Decimal(normalized);
}

export function formatMoney(value: Decimal | { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}
