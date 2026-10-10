import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { calculateInterest } from "../src/modules/interest-repayment/interest-engine.js";
import {
  executablePrincipalBasisStrategies,
  principalBasisStrategies,
} from "../src/modules/interest-repayment/policy.constants.js";
import {
  assertInterestPolicyExecutable,
  assessInterestPolicyReadiness,
} from "../src/modules/interest-repayment/policy.readiness.js";
import type { InterestPolicy } from "../src/modules/interest-repayment/policy.types.js";
import {
  principalBasisRegistry,
  resolvePrincipal,
} from "../src/modules/interest-repayment/principal-resolver.js";
import { AppError } from "../src/shared/errors/app-error.js";

const facilityId = "facility-1";

function rejection(run: () => unknown, statusCode: number, code: string, expected: RegExp): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    assert.match(error.message, expected);
    return true;
  });
}

const interestPolicy: InterestPolicy = {
  annualRate: "10.0000",
  calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
  allocationFrequency: "MONTHLY",
  recalculationFrequency: "ANNUAL",
};

describe("principal resolver foundation", () => {
  it("keeps the executable principal-basis registry empty", () => {
    assert.deepEqual(principalBasisRegistry, []);
    assert.equal(principalBasisStrategies.length, 0);
    assert.equal(executablePrincipalBasisStrategies.length, 0);
  });

  it("rejects a missing facility identity", () => {
    rejection(
      () => resolvePrincipal({ principalBasis: "AUTHORIZED_PRINCIPAL" }),
      400,
      "VALIDATION_ERROR",
      /loanFacilityId must be a non-empty string/,
    );
    rejection(
      () => resolvePrincipal({ loanFacilityId: "  ", principalBasis: "AUTHORIZED_PRINCIPAL" }),
      400,
      "VALIDATION_ERROR",
      /loanFacilityId must be a non-empty string/,
    );
  });

  it("rejects a missing principal basis and does not choose a default", () => {
    rejection(
      () => resolvePrincipal({ loanFacilityId: facilityId }),
      400,
      "VALIDATION_ERROR",
      /principalBasis is required/,
    );
    rejection(
      () => resolvePrincipal({ loanFacilityId: facilityId, principalBasis: "   " }),
      400,
      "VALIDATION_ERROR",
      /principalBasis is required/,
    );
  });

  it("rejects an unsupported principal basis without fabricating an amount", () => {
    for (const principalBasis of ["AUTHORIZED_PRINCIPAL", "TOTAL_DISBURSED", "OUTSTANDING_PRINCIPAL"]) {
      rejection(
        () =>
          resolvePrincipal({
            loanFacilityId: facilityId,
            principalBasis,
            calculationContext: { authorizedPrincipalAmount: "1000000.00", totalDisbursed: "0.00" },
          }),
        400,
        "VALIDATION_ERROR",
        new RegExp(`unrecognized strategy "${principalBasis}"`),
      );
    }
  });

  it("leaves facility interest readiness blocked while the calculation engine stays explicit", () => {
    const readiness = assessInterestPolicyReadiness(interestPolicy);
    assert.equal(readiness.calculationExecutable, true);
    assert.equal(readiness.facilityWorkflowExecutable, false);
    assert.equal(readiness.executable, false);
    assert.equal(
      readiness.blockers.some((blocker) => blocker.field === "principalBasis" && blocker.code === "POLICY_UNRESOLVED"),
      true,
    );
    rejection(
      () => assertInterestPolicyExecutable(interestPolicy),
      409,
      "POLICY_NOT_EXECUTABLE",
      /MSPS principal basis is unconfirmed/,
    );

    const calculated = calculateInterest({
      calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
      principalAmount: "1000000.00",
      annualRate: "10.0000",
      allocationFrequency: "MONTHLY",
      recalculationFrequency: "ANNUAL",
    });
    assert.equal(calculated.annualInterestAmount, "100000.00");
    assert.equal(calculated.principalAmount, "1000000.00");
  });

  it("does not read the database or call the interest engine", () => {
    const source = readFileSync(new URL("../src/modules/interest-repayment/principal-resolver.ts", import.meta.url), "utf8");
    assert.equal(source.includes("prisma"), false);
    assert.equal(source.includes("calculateInterest"), false);
    assert.equal(source.includes("0.00"), false);
  });
});
