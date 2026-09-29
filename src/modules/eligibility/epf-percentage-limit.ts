import { z } from "zod";
import { Decimal } from "../../shared/money/decimal.js";
import { AppError } from "../../shared/errors/app-error.js";

export const EPF_PERCENTAGE_LIMIT = "EPF_PERCENTAGE_LIMIT";

const percentageString = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/, "percentage must be a non-negative decimal string")
  .refine((value) => {
    const percentage = new Decimal(value);
    return percentage.isFinite() && !percentage.isNeg();
  }, "percentage must be a non-negative decimal string");

const epfPercentageLimitRuleSchema = z.strictObject({
  type: z.literal(EPF_PERCENTAGE_LIMIT),
  percentage: percentageString,
  balanceReference: z.strictObject({
    type: z.literal("PREVIOUS_YEAR_END"),
    relativeTo: z.string().trim().min(1, "relativeTo is required"),
  }),
});

function formatIssues(error: z.ZodError, prefix: string): string {
  return error.issues
    .map((issue) => {
      const path = [prefix, ...issue.path.map(String)].filter((segment) => segment.length > 0).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * Recognizes the EPF percentage contract.
 * The rule is not executable: the previous-year reference basis and the
 * rounding policy for balance × percentage / 100 are not confirmed.
 * This function never calculates an amount and never reads assessedAt.
 */
export function assertEpfPercentageLimitNotExecutable(rule: unknown, index: number): never {
  const parsed = epfPercentageLimitRuleSchema.safeParse(rule);
  if (!parsed.success) {
    throw new AppError(
      400,
      formatIssues(parsed.error, `eligibility.rules.${index}`),
      "VALIDATION_ERROR",
    );
  }

  throw new AppError(
    409,
    "EPF_PERCENTAGE_LIMIT is recognized but cannot be executed until its previous-year reference basis and rounding policy are confirmed",
    "RULE_NOT_EXECUTABLE",
  );
}
