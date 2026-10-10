import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { EPF_PERCENTAGE_LIMIT } from "../src/modules/eligibility/epf-percentage-limit.js";
import { buildEligibilitySnapshots } from "../src/modules/eligibility/eligibility.engine.js";
import type { AssessmentSubject } from "../src/modules/eligibility/eligibility.types.js";
import {
  parseProductVersionConfiguration,
  readFinancialPolicies,
} from "../src/modules/interest-repayment/configuration.js";
import {
  calculationStrategies,
  executableAllocationFrequencies,
  executableBalanceChangeTreatments,
  executableCalculationStrategies,
  executableGracePeriodStrategies,
  executableOverpaymentTreatments,
  executablePrincipalBasisStrategies,
  executableRecalculationAnchors,
  executableRecalculationFrequencies,
  overpaymentTreatments,
  principalBasisStrategies,
  recalculationAnchors,
} from "../src/modules/interest-repayment/policy.constants.js";
import {
  assertInterestPolicyExecutable,
  assertPaymentVariancePolicyExecutable,
  assertRepaymentPolicyExecutable,
  assessInterestPolicyReadiness,
  assessPaymentVariancePolicyReadiness,
  assessRepaymentPolicyReadiness,
} from "../src/modules/interest-repayment/policy.readiness.js";
import {
  createVersionSchema,
  updateDraftVersionSchema,
} from "../src/modules/products/product.schemas.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { errorHandler } from "../src/shared/middleware/error-handler.js";
import { validateBody } from "../src/shared/middleware/validate.js";

const validInterestPolicy = {
  annualRate: "12.3456",
  calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
  allocationFrequency: "MONTHLY",
  recalculationFrequency: "ANNUAL",
  balanceChangeTreatment: "SUPPLEMENTARY_CALCULATION",
};

const validConfiguration = {
  eligibility: { rules: [] },
  interestPolicy: validInterestPolicy,
  repaymentPolicy: {
    paymentAllocationPriority: ["PRINCIPAL", "INTEREST"],
  },
  notes: "existing-key",
};

function versionBody(configuration: unknown) {
  return {
    versionNumber: 1,
    effectiveFrom: "2026-01-01",
    configuration,
  };
}

function submit(body: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = { body } as Request;
    let statusCode = 200;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
    } as unknown as Response;

    const next: NextFunction = (error?: unknown) => {
      if (error) {
        errorHandler(error, req, res, (() => undefined) as NextFunction);
        return;
      }
      resolve({ status: 200, body: req.body });
    };

    try {
      validateBody(createVersionSchema)(req, res, next);
    } catch (error) {
      reject(error);
    }
  });
}

function errorMessage(response: { status: number; body: unknown }): string {
  const body = response.body as { error?: { message?: string; code?: string } };
  assert.equal(response.status, 400);
  assert.equal(body.error?.code, "VALIDATION_ERROR");
  return body.error?.message ?? "";
}

const subject: AssessmentSubject = {
  application: {
    id: "00000000-0000-4000-8000-000000000001",
    applicationNumber: "APP-1",
    status: "UNDER_REVIEW",
    borrowerId: "00000000-0000-4000-8000-000000000002",
    loanProductId: "00000000-0000-4000-8000-000000000003",
    productVersionId: "00000000-0000-4000-8000-000000000004",
    productPurposeId: null,
  },
  borrower: {
    id: "00000000-0000-4000-8000-000000000002",
    firstName: "Asha",
    middleName: null,
    lastName: "Perera",
  },
  loanProduct: {
    id: "00000000-0000-4000-8000-000000000003",
    code: "MSPS",
    name: "MSPS",
  },
  productVersion: {
    id: "00000000-0000-4000-8000-000000000004",
    versionNumber: 1,
    status: "ACTIVE",
  },
  productPurpose: null,
};

describe("ProductVersion configuration without Phase 8 policy", () => {
  it("accepts an empty configuration", async () => {
    const response = await submit(versionBody({}));
    assert.equal(response.status, 200);
    const policies = readFinancialPolicies({});
    assert.equal(policies.interestPolicy, null);
    assert.equal(policies.repaymentPolicy, null);
    assert.equal(policies.paymentVariancePolicy, null);
  });

  it("preserves eligibility configuration and other keys", async () => {
    const configuration = {
      eligibility: {
        rules: [
          {
            type: EPF_PERCENTAGE_LIMIT,
            percentage: "40.0000",
            balanceReference: { type: "PREVIOUS_YEAR_END", relativeTo: "assessment" },
          },
        ],
      },
      customFlag: true,
    };
    const response = await submit(versionBody(configuration));
    assert.equal(response.status, 200);
    const saved = (response.body as { configuration: typeof configuration }).configuration;
    assert.deepEqual(saved, configuration);
    assert.equal(readFinancialPolicies(saved).interestPolicy, null);
  });

  it("still accepts a malformed eligibility section at save time", async () => {
    const response = await submit(versionBody({ eligibility: "unchanged-save-behaviour" }));
    assert.equal(response.status, 200);
  });
});

describe("valid Phase 8 configuration", () => {
  it("accepts explicit policies and does not fill omitted fields", async () => {
    const response = await submit(
      versionBody({
        ...validConfiguration,
        interestPolicy: { ...validInterestPolicy, annualRate: "  12.3456  " },
      }),
    );
    assert.equal(response.status, 200);
    const saved = (response.body as { configuration: Record<string, unknown> }).configuration;
    assert.deepEqual(saved.interestPolicy, validInterestPolicy);
    assert.deepEqual(saved.repaymentPolicy, validConfiguration.repaymentPolicy);
    assert.equal("paymentVariancePolicy" in saved, false);
    assert.deepEqual(saved.eligibility, validConfiguration.eligibility);
    assert.equal(saved.notes, "existing-key");
    assert.equal("principalBasis" in (saved.interestPolicy as object), false);
    assert.equal("recalculationAnchor" in (saved.interestPolicy as object), false);

    const policies = readFinancialPolicies(saved);
    assert.equal(policies.interestPolicy?.annualRate, "12.3456");
    assert.equal(typeof policies.interestPolicy?.annualRate, "string");
    assert.deepEqual(policies.repaymentPolicy?.paymentAllocationPriority, ["PRINCIPAL", "INTEREST"]);
    assert.equal(policies.interestPolicy?.principalBasis, undefined);
    assert.equal(policies.repaymentPolicy?.repaymentStructure, undefined);
    assert.equal(policies.paymentVariancePolicy, null);
  });

  it("accepts zero and both recognized allocation orders", async () => {
    const response = await submit(
      versionBody({
        interestPolicy: {
          annualRate: "0",
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
        },
        repaymentPolicy: { paymentAllocationPriority: ["INTEREST", "PRINCIPAL"] },
      }),
    );
    assert.equal(response.status, 200);
  });

  it("accepts every recognized balance-change treatment", async () => {
    for (const balanceChangeTreatment of [
      "SUPPLEMENTARY_CALCULATION",
      "IMMEDIATE_RECALCULATION",
      "NEXT_SCHEDULED_RECALCULATION",
    ]) {
      const response = await submit(
        versionBody({
          interestPolicy: { ...validInterestPolicy, balanceChangeTreatment },
        }),
      );
      assert.equal(response.status, 200, balanceChangeTreatment);
    }
  });

});

describe("Phase 8 validation rejections", () => {
  async function rejected(configuration: unknown, expected: string): Promise<void> {
    const response = await submit(versionBody(configuration));
    const message = errorMessage(response);
    assert.match(message, new RegExp(expected));
  }

  it("rejects a JSON numeric annualRate", async () => {
    await rejected(
      { interestPolicy: { ...validInterestPolicy, annualRate: 12.5 } },
      "annualRate must be a decimal string, not a number",
    );
  });

  it("rejects an invalid decimal string", async () => {
    for (const annualRate of ["12.34567", "-1.00", "abc", "", "1e2", "12.", ".5", "00.50"]) {
      await rejected(
        { interestPolicy: { ...validInterestPolicy, annualRate } },
        "non-negative decimal string",
      );
    }
  });

  it("accepts the DECIMAL(18, 4) maximum annual rate and rejects a wider rate", async () => {
    const maximum = "99999999999999.9999";
    const accepted = await submit(
      versionBody({
        interestPolicy: { ...validInterestPolicy, annualRate: maximum },
      }),
    );
    assert.equal(accepted.status, 200);
    const policies = readFinancialPolicies({
      interestPolicy: { ...validInterestPolicy, annualRate: maximum },
    });
    assert.equal(policies.interestPolicy?.annualRate, maximum);
    const zeroRate = await submit(
      versionBody({
        interestPolicy: { ...validInterestPolicy, annualRate: "0" },
      }),
    );
    assert.equal(zeroRate.status, 200);
    const tenRate = await submit(
      versionBody({
        interestPolicy: { ...validInterestPolicy, annualRate: "10.0000" },
      }),
    );
    assert.equal(tenRate.status, 200);
    await rejected(
      { interestPolicy: { ...validInterestPolicy, annualRate: "100000000000000.0000" } },
      "annualRate exceeds the supported decimal precision",
    );
    await rejected(
      { interestPolicy: { ...validInterestPolicy, annualRate: "10.00000" } },
      "up to 4 decimal places",
    );
    await rejected(
      { interestPolicy: { ...validInterestPolicy, annualRate: "-0.0001" } },
      "non-negative decimal string",
    );
    await rejected(
      { interestPolicy: { ...validInterestPolicy, annualRate: 10 } },
      "annualRate must be a decimal string, not a number",
    );
    await rejected(
      { interestPolicy: { ...validInterestPolicy, annualRate: "10.00.00" } },
      "non-negative decimal string",
    );
  });

  it("rejects an unknown calculation strategy", async () => {
    await rejected(
      { interestPolicy: { ...validInterestPolicy, calculationStrategy: "DAILY_ACCRUAL" } },
      "unrecognized strategy",
    );
    assert.equal(calculationStrategies.includes("ANNUAL_INTEREST_ALLOCATION"), true);
    assert.equal(
      (calculationStrategies as readonly string[]).includes("DAILY_ACCRUAL"),
      false,
    );
  });

  it("rejects an unknown principal basis", async () => {
    await rejected(
      { interestPolicy: { ...validInterestPolicy, principalBasis: "OUTSTANDING_PRINCIPAL" } },
      "no principal basis strategies are confirmed",
    );
    assert.equal(principalBasisStrategies.length, 0);
  });

  it("rejects duplicate payment allocation components", async () => {
    await rejected(
      { repaymentPolicy: { paymentAllocationPriority: ["INTEREST", "INTEREST"] } },
      "duplicate payment allocation component",
    );
  });

  it("rejects an unknown payment allocation component", async () => {
    await rejected(
      { repaymentPolicy: { paymentAllocationPriority: ["INTEREST", "PENALTY"] } },
      "unrecognized payment allocation component",
    );
    await rejected(
      { repaymentPolicy: { paymentAllocationPriority: ["FEE"] } },
      "unrecognized payment allocation component",
    );
  });

  it("rejects malformed policy objects", async () => {
    await rejected({ interestPolicy: [] }, "interestPolicy must be an object");
    await rejected({ interestPolicy: null }, "interestPolicy must be an object");
    await rejected({ repaymentPolicy: "monthly" }, "repaymentPolicy must be an object");
    await rejected({ paymentVariancePolicy: {} }, "at least one field is required");
    await rejected({ repaymentPolicy: {} }, "at least one field is required");
    await rejected(
      {
        interestPolicy: {
          ...validInterestPolicy,
          dailyAccrual: true,
        },
      },
      "Unrecognized key",
    );
  });

  it("does not default omitted confirmed fields", async () => {
    const { annualRate: _annualRate, ...withoutRate } = validInterestPolicy;
    await rejected({ interestPolicy: withoutRate }, "annualRate is required");
    const { calculationStrategy: _strategy, ...withoutStrategy } = validInterestPolicy;
    await rejected({ interestPolicy: withoutStrategy }, "calculationStrategy is required");
    const { allocationFrequency: _allocation, ...withoutAllocation } = validInterestPolicy;
    await rejected({ interestPolicy: withoutAllocation }, "allocationFrequency is required");
    const { recalculationFrequency: _recalculation, ...withoutRecalculation } = validInterestPolicy;
    await rejected({ interestPolicy: withoutRecalculation }, "recalculationFrequency is required");
  });

  it("rejects unconfirmed repayment, anchor, and underpayment choices", async () => {
    await rejected(
      { interestPolicy: { ...validInterestPolicy, recalculationAnchor: "CALENDAR_YEAR" } },
      "no recalculation anchors are confirmed",
    );
    await rejected(
      {
        interestPolicy: { ...validInterestPolicy, recalculationAnchor: "FACILITY_ANNIVERSARY" },
      },
      "no recalculation anchors are confirmed",
    );
    assert.equal(recalculationAnchors.length, 0);

    await rejected(
      { repaymentPolicy: { repaymentStructure: "INTEREST_ONLY" } },
      "no repayment structures are confirmed",
    );
    await rejected(
      { repaymentPolicy: { repaymentFrequency: "MONTHLY" } },
      "no repayment frequencies are confirmed",
    );
    await rejected(
      { repaymentPolicy: { scheduleCommencementBasis: "FIRST_DISBURSEMENT" } },
      "no schedule commencement strategies are confirmed",
    );
    await rejected(
      { repaymentPolicy: { firstRepaymentRule: { strategy: "DISBURSEMENT_PLUS_30_DAYS" } } },
      "no first repayment rules are confirmed",
    );
    await rejected(
      { repaymentPolicy: { firstRepaymentRule: { days: 30 } } },
      "Unrecognized key",
    );
    await rejected(
      { repaymentPolicy: { gracePeriod: { strategy: "NONE" } } },
      "no grace period rules are confirmed",
    );
    await rejected(
      { repaymentPolicy: { term: { strategy: "FIXED_MONTHS", months: 12 } } },
      "Unrecognized key",
    );
    await rejected(
      { paymentVariancePolicy: { underpaymentTreatment: "ARREARS" } },
      "no underpayment treatments are confirmed",
    );
    for (const overpaymentTreatment of [
      "APPLY_TO_PRINCIPAL",
      "CARRY_FORWARD_AS_CREDIT",
      "REJECT_EXCESS_PAYMENT",
      "REFUND",
    ]) {
      await rejected(
        { paymentVariancePolicy: { overpaymentTreatment } },
        "no overpayment treatments are confirmed",
      );
    }
    assert.equal(overpaymentTreatments.length, 0);
    await rejected(
      { interestPolicy: { ...validInterestPolicy, balanceChangeTreatment: "REGENERATE_SCHEDULE" } },
      "unrecognized strategy",
    );
  });
});

describe("engine readiness is separate from configuration validity", () => {
  it("reports recognized strategies as not executable and leaves MSPS choices unresolved", () => {
    const policies = readFinancialPolicies(validConfiguration);
    const interestReadiness = assessInterestPolicyReadiness(policies.interestPolicy);
    assert.equal(interestReadiness.calculationExecutable, true);
    assert.equal(interestReadiness.facilityWorkflowExecutable, false);
    assert.equal(interestReadiness.executable, false);
    assert.throws(
      () => assertInterestPolicyExecutable(policies.interestPolicy),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "POLICY_NOT_EXECUTABLE");
        assert.doesNotMatch(error.message, /ANNUAL_INTEREST_ALLOCATION is recognized/);
        assert.match(error.message, /principal basis is unconfirmed/);
        assert.match(error.message, /annual reset anchor is unconfirmed/);
        assert.match(error.message, /SUPPLEMENTARY_CALCULATION is recognized/);
        return true;
      },
    );
    const repaymentReadiness = assessRepaymentPolicyReadiness(policies.repaymentPolicy);
    assert.equal(repaymentReadiness.scheduleAssemblyAvailable, true);
    assert.equal(repaymentReadiness.facilityWorkflowExecutable, false);
    assert.equal(repaymentReadiness.executable, false);
    const graceBlocker = repaymentReadiness.blockers.find((blocker) => blocker.field === "gracePeriod");
    assert.equal(graceBlocker?.code, "POLICY_UNRESOLVED");
    assert.match(graceBlocker?.message ?? "", /grace period is unconfirmed/);
    assert.deepEqual(executableGracePeriodStrategies, []);
    assert.throws(
      () => assertRepaymentPolicyExecutable(policies.repaymentPolicy),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "POLICY_NOT_EXECUTABLE");
        assert.match(error.message, /repayment structure is unconfirmed/);
        assert.match(error.message, /PRINCIPAL -> INTEREST is recognized/);
        assert.match(error.message, /maturity treatment is unconfirmed/);
        return true;
      },
    );
    assert.throws(
      () => assertPaymentVariancePolicyExecutable(policies.paymentVariancePolicy),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "POLICY_NOT_EXECUTABLE");
        assert.match(error.message, /No payment variance policy is configured/);
        return true;
      },
    );
    const varianceReadiness = assessPaymentVariancePolicyReadiness({});
    assert.equal(varianceReadiness.executable, false);
    assert.match(
      varianceReadiness.blockers.map((blocker) => blocker.message).join(" "),
      /underpayment treatment is unconfirmed/,
    );
    assert.match(
      varianceReadiness.blockers.map((blocker) => blocker.message).join(" "),
      /overpayment treatment is unconfirmed/,
    );
    assert.deepEqual(executableCalculationStrategies, ["ANNUAL_INTEREST_ALLOCATION"]);
    assert.deepEqual(executableAllocationFrequencies, ["MONTHLY"]);
    assert.deepEqual(executableRecalculationFrequencies, ["ANNUAL"]);
    assert.deepEqual(executablePrincipalBasisStrategies, []);
    assert.deepEqual(executableRecalculationAnchors, []);
    assert.deepEqual(executableBalanceChangeTreatments, []);
    assert.deepEqual(executableOverpaymentTreatments, []);
  });

  it("rejects invalid configuration from the engine reader with a validation error", () => {
    assert.throws(
      () => parseProductVersionConfiguration({ interestPolicy: { annualRate: 10 } }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "VALIDATION_ERROR");
        return true;
      },
    );
  });
});

describe("eligibility behaviour is unchanged", () => {
  it("still treats a version with no eligibility rules as inconclusive", () => {
    const snapshots = buildEligibilitySnapshots(validConfiguration, subject);
    const result = snapshots.resultSnapshot as { outcome: string; reasonCodes: string[] };
    assert.equal(result.outcome, "REVIEW_REQUIRED");
    assert.deepEqual(result.reasonCodes, ["NO_ELIGIBILITY_RULES_CONFIGURED"]);
  });

  it("still recognizes EPF_PERCENTAGE_LIMIT without executing it", () => {
    assert.throws(
      () =>
        buildEligibilitySnapshots(
          {
            ...validConfiguration,
            eligibility: {
              rules: [
                {
                  type: EPF_PERCENTAGE_LIMIT,
                  percentage: "40",
                  balanceReference: { type: "PREVIOUS_YEAR_END", relativeTo: "assessment" },
                },
              ],
            },
          },
          subject,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "RULE_NOT_EXECUTABLE");
        assert.match(error.message, /previous-year reference basis/);
        return true;
      },
    );
  });

  it("still rejects an unknown eligibility rule", () => {
    assert.throws(
      () =>
        buildEligibilitySnapshots(
          { eligibility: { rules: [{ type: "UNKNOWN_RULE" }] } },
          subject,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /unsupported eligibility rule UNKNOWN_RULE/);
        return true;
      },
    );
  });
});

describe("draft update schema", () => {
  it("still allows a draft update that omits configuration", () => {
    const parsed = updateDraftVersionSchema.safeParse({ effectiveFrom: "2026-02-01" });
    assert.equal(parsed.success, true);
  });
});
