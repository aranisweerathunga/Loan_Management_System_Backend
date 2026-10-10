import { z } from "zod";
import { AppError } from "../../shared/errors/app-error.js";
import { Decimal } from "../../shared/money/decimal.js";
import {
  ANNUAL_RATE_DECIMAL_PLACES,
  MAX_ANNUAL_RATE,
  allocationFrequencies,
  balanceChangeTreatments,
  calculationStrategies,
  paymentAllocationComponents,
  recalculationFrequencies,
} from "./policy.constants.js";
import type { InterestPolicy, PaymentVariancePolicy, RepaymentPolicy } from "./policy.types.js";

const ANNUAL_RATE_PATTERN = new RegExp(
  `^(?:0|[1-9]\\d*)(?:\\.\\d{1,${ANNUAL_RATE_DECIMAL_PLACES}})?$`,
);

type StrategyList = readonly [string, ...string[]];

function assertUnconfirmedAbsent(value: unknown, field: string): void {
  if (value !== undefined) {
    throw new AppError(
      400,
      `${field}: unrecognized strategy; no strategies are confirmed for this field`,
      "VALIDATION_ERROR",
    );
  }
}

function strategyTypeMessage(field: string, input: unknown): string {
  if (input === undefined) {
    return `${field} is required`;
  }
  if (typeof input === "number") {
    return `${field} must be a strategy identifier, not a number`;
  }
  return `${field} must be a string`;
}

function requiredStrategy<const T extends StrategyList>(field: string, recognized: T) {
  return z
    .string({
      error: (issue) => strategyTypeMessage(field, issue.input),
    })
    .trim()
    .min(1, `${field} is required`)
    .pipe(
      z.enum(recognized, {
        error: (issue) =>
          `${field}: unrecognized strategy "${String(issue.input)}"; recognized strategies: ${recognized.join(", ")}`,
      }),
    );
}

function optionalStrategy<const T extends StrategyList>(field: string, recognized: T) {
  return requiredStrategy(field, recognized).optional();
}

/**
 * Accepts the key only so a supplied value can be rejected.
 * No identifier is recognized, so a successful parse never contains this field.
 */
function unconfirmedStrategy(field: string, reason: string) {
  return z
    .string({
      error: (issue) => strategyTypeMessage(field, issue.input),
    })
    .trim()
    .superRefine((value, ctx) => {
      ctx.addIssue(`${field}: unrecognized strategy "${value}"; ${reason}`);
    })
    .optional();
}

function unconfirmedRule(field: string, reason: string) {
  return z
    .strictObject({
      strategy: z
        .string({
          error: (issue) => strategyTypeMessage(`${field}.strategy`, issue.input),
        })
        .trim()
        .superRefine((value, ctx) => {
          ctx.addIssue(`${field}.strategy: unrecognized strategy "${value}"; ${reason}`);
        }),
    })
    .optional();
}

const annualRateSchema = z
  .string({
    error: (issue) => {
      if (issue.input === undefined) {
        return "annualRate is required";
      }
      if (typeof issue.input === "number") {
        return "annualRate must be a decimal string, not a number";
      }
      return "annualRate must be a decimal string";
    },
  })
  .trim()
  .superRefine((value, ctx) => {
    if (!ANNUAL_RATE_PATTERN.test(value)) {
      ctx.addIssue(
        `annualRate must be a non-negative decimal string with up to ${ANNUAL_RATE_DECIMAL_PLACES} decimal places`,
      );
      return;
    }

    const rate = new Decimal(value);
    if (!rate.isFinite() || rate.isNeg()) {
      ctx.addIssue(
        `annualRate must be a non-negative decimal string with up to ${ANNUAL_RATE_DECIMAL_PLACES} decimal places`,
      );
      return;
    }
    if (rate.greaterThan(MAX_ANNUAL_RATE)) {
      ctx.addIssue("annualRate exceeds the supported decimal precision");
    }
  });

const paymentAllocationPrioritySchema = z
  .array(
    z.enum(paymentAllocationComponents, {
      error: (issue) => {
        if (typeof issue.input === "number") {
          return "payment allocation component must be a string, not a number";
        }
        if (typeof issue.input !== "string") {
          return "payment allocation component must be a string";
        }
        return `unrecognized payment allocation component "${issue.input}"`;
      },
    }),
    {
      error: (issue) =>
        Array.isArray(issue.input)
          ? "paymentAllocationPriority is invalid"
          : "paymentAllocationPriority must be an array",
    },
  )
  .superRefine((components, ctx) => {
    if (components.length === 0) {
      ctx.addIssue("paymentAllocationPriority must contain at least one component");
      return;
    }

    const seen = new Set<string>();
    components.forEach((component, index) => {
      if (seen.has(component)) {
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: `duplicate payment allocation component "${component}"`,
        });
      }
      seen.add(component);
    });
  });

function atLeastOneField<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });
}

export const interestPolicySchema = z.strictObject({
  annualRate: annualRateSchema,
  principalBasis: unconfirmedStrategy(
    "principalBasis",
    "no principal basis strategies are confirmed",
  ),
  calculationStrategy: requiredStrategy("calculationStrategy", calculationStrategies),
  allocationFrequency: requiredStrategy("allocationFrequency", allocationFrequencies),
  recalculationFrequency: requiredStrategy("recalculationFrequency", recalculationFrequencies),
  recalculationAnchor: unconfirmedStrategy(
    "recalculationAnchor",
    "no recalculation anchors are confirmed",
  ),
  balanceChangeTreatment: optionalStrategy("balanceChangeTreatment", balanceChangeTreatments),
});

export const repaymentPolicySchema = atLeastOneField(
  z.strictObject({
    repaymentStructure: unconfirmedStrategy(
      "repaymentStructure",
      "no repayment structures are confirmed",
    ),
    repaymentFrequency: unconfirmedStrategy(
      "repaymentFrequency",
      "no repayment frequencies are confirmed",
    ),
    principalRepaymentMethod: unconfirmedStrategy(
      "principalRepaymentMethod",
      "no principal repayment methods are confirmed",
    ),
    scheduleCommencementBasis: unconfirmedStrategy(
      "scheduleCommencementBasis",
      "no schedule commencement strategies are confirmed",
    ),
    firstRepaymentRule: unconfirmedRule(
      "firstRepaymentRule",
      "no first repayment rules are confirmed",
    ),
    gracePeriod: unconfirmedRule("gracePeriod", "no grace period rules are confirmed"),
    paymentAllocationPriority: paymentAllocationPrioritySchema.optional(),
    term: unconfirmedRule("term", "no term or maturity strategies are confirmed"),
  }),
);

export const paymentVariancePolicySchema = atLeastOneField(
  z.strictObject({
    underpaymentTreatment: unconfirmedStrategy(
      "underpaymentTreatment",
      "no underpayment treatments are confirmed",
    ),
    overpaymentTreatment: unconfirmedStrategy(
      "overpaymentTreatment",
      "no overpayment treatments are confirmed",
    ),
  }),
);

export function toInterestPolicy(value: z.infer<typeof interestPolicySchema>): InterestPolicy {
  assertUnconfirmedAbsent(value.principalBasis, "principalBasis");
  assertUnconfirmedAbsent(value.recalculationAnchor, "recalculationAnchor");

  return {
    annualRate: value.annualRate,
    calculationStrategy: value.calculationStrategy,
    allocationFrequency: value.allocationFrequency,
    recalculationFrequency: value.recalculationFrequency,
    ...(value.balanceChangeTreatment !== undefined
      ? { balanceChangeTreatment: value.balanceChangeTreatment }
      : {}),
  };
}

export function toRepaymentPolicy(value: z.infer<typeof repaymentPolicySchema>): RepaymentPolicy {
  assertUnconfirmedAbsent(value.repaymentStructure, "repaymentStructure");
  assertUnconfirmedAbsent(value.repaymentFrequency, "repaymentFrequency");
  assertUnconfirmedAbsent(value.principalRepaymentMethod, "principalRepaymentMethod");
  assertUnconfirmedAbsent(value.scheduleCommencementBasis, "scheduleCommencementBasis");
  assertUnconfirmedAbsent(value.firstRepaymentRule, "firstRepaymentRule");
  assertUnconfirmedAbsent(value.gracePeriod, "gracePeriod");
  assertUnconfirmedAbsent(value.term, "term");

  return {
    ...(value.paymentAllocationPriority !== undefined
      ? { paymentAllocationPriority: [...value.paymentAllocationPriority] }
      : {}),
  };
}

export function toPaymentVariancePolicy(
  value: z.infer<typeof paymentVariancePolicySchema>,
): PaymentVariancePolicy {
  assertUnconfirmedAbsent(value.underpaymentTreatment, "underpaymentTreatment");
  assertUnconfirmedAbsent(value.overpaymentTreatment, "overpaymentTreatment");

  return {};
}
