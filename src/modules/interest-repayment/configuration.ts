import { z } from "zod";
import { AppError } from "../../shared/errors/app-error.js";
import {
  interestPolicySchema,
  paymentVariancePolicySchema,
  repaymentPolicySchema,
  toInterestPolicy,
  toPaymentVariancePolicy,
  toRepaymentPolicy,
} from "./policy.schemas.js";
import type { FinancialPolicies } from "./policy.types.js";

const policySchemas = {
  interestPolicy: interestPolicySchema,
  repaymentPolicy: repaymentPolicySchema,
  paymentVariancePolicy: paymentVariancePolicySchema,
} as const;

type PolicyKey = keyof typeof policySchemas;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * ProductVersion.configuration remains a JSON object.
 * Eligibility and any other existing keys are preserved.
 * Phase 8 policy keys are optional and, when present, strictly validated.
 * Invalid policies are rejected. Missing policies are not defaulted.
 */
export const productVersionConfigurationSchema = z
  .record(z.string(), z.unknown())
  .superRefine((configuration, ctx) => {
    for (const key of Object.keys(policySchemas) as PolicyKey[]) {
      if (!Object.prototype.hasOwnProperty.call(configuration, key)) {
        continue;
      }

      const value = configuration[key];
      if (!isPlainObject(value)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must be an object`,
        });
        continue;
      }

      const parsed = policySchemas[key].safeParse(value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            code: "custom",
            path: [key, ...issue.path],
            message: issue.message,
          });
        }
      }
    }
  })
  .transform((configuration) => {
    const next: Record<string, unknown> = { ...configuration };
    for (const key of Object.keys(policySchemas) as PolicyKey[]) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) {
        continue;
      }
      const parsed = policySchemas[key].safeParse(next[key]);
      if (parsed.success) {
        next[key] = parsed.data;
      }
    }
    return next;
  });

export function parseProductVersionConfiguration(configuration: unknown): Record<string, unknown> {
  const parsed = productVersionConfigurationSchema.safeParse(configuration);
  if (!parsed.success) {
    throw new AppError(400, formatIssues(parsed.error), "VALIDATION_ERROR");
  }
  return parsed.data;
}

export function readFinancialPolicies(configuration: unknown): FinancialPolicies {
  const parsed = parseProductVersionConfiguration(configuration);
  return {
    interestPolicy: Object.prototype.hasOwnProperty.call(parsed, "interestPolicy")
      ? toInterestPolicy(interestPolicySchema.parse(parsed.interestPolicy))
      : null,
    repaymentPolicy: Object.prototype.hasOwnProperty.call(parsed, "repaymentPolicy")
      ? toRepaymentPolicy(repaymentPolicySchema.parse(parsed.repaymentPolicy))
      : null,
    paymentVariancePolicy: Object.prototype.hasOwnProperty.call(parsed, "paymentVariancePolicy")
      ? toPaymentVariancePolicy(paymentVariancePolicySchema.parse(parsed.paymentVariancePolicy))
      : null,
  };
}
