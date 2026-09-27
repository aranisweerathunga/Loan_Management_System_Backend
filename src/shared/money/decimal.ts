import { Decimal } from "decimal.js";

/**
 * Financial invariant:
 * - Persist money/rates with Prisma Decimal / PostgreSQL NUMERIC.
 * - Calculate with decimal.js (or Prisma Decimal-safe operations).
 * - Never use native JavaScript number arithmetic for interest or money.
 */
export { Decimal };
