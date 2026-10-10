import { AppError } from "../../shared/errors/app-error.js";
import {
  executableAllocationFrequencies,
  executableBalanceChangeTreatments,
  executableCalculationStrategies,
  executableFirstRepaymentRuleStrategies,
  executableGracePeriodStrategies,
  executableOverpaymentTreatments,
  executablePrincipalBasisStrategies,
  executablePrincipalRepaymentMethods,
  executableRecalculationAnchors,
  executableRecalculationFrequencies,
  executableRepaymentFrequencies,
  executableRepaymentStructures,
  executableScheduleCommencementBases,
  executableTermStrategies,
  executableUnderpaymentTreatments,
} from "./policy.constants.js";
import type {
  FinancialPolicies,
  InterestPolicy,
  PaymentVariancePolicy,
  PolicyBlocker,
  InterestPolicyReadiness,
  PolicyReadiness,
  RepaymentPolicy,
  RepaymentPolicyReadiness,
} from "./policy.types.js";

/**
 * Readiness is separate from configuration validity.
 * ProductVersion create/update must not call these asserts.
 * Future engines call them and reject strategies they do not implement.
 */

function notConfigured(field: string, message: string): PolicyReadiness {
  return {
    executable: false,
    blockers: [{ code: "POLICY_NOT_CONFIGURED", field, message }],
  };
}

function readiness(blockers: PolicyBlocker[]): PolicyReadiness {
  return { executable: blockers.length === 0, blockers };
}

function unresolved(field: string, message: string): PolicyBlocker {
  return { code: "POLICY_UNRESOLVED", field, message };
}

function notExecutable(field: string, strategy: string, engine: string): PolicyBlocker {
  return {
    code: "STRATEGY_NOT_EXECUTABLE",
    field,
    message: `${strategy} is recognized but cannot be executed because ${engine} is not implemented`,
  };
}

function considerStrategy(
  blockers: PolicyBlocker[],
  field: string,
  value: string | undefined,
  executable: readonly string[],
  missingMessage: string,
  engine: string,
): void {
  if (value === undefined) {
    blockers.push(unresolved(field, missingMessage));
    return;
  }
  if (!executable.includes(value)) {
    blockers.push(notExecutable(field, value, engine));
  }
}

const calculationFields = new Set([
  "calculationStrategy",
  "allocationFrequency",
  "recalculationFrequency",
]);

function interestReadiness(blockers: PolicyBlocker[], policyConfigured: boolean): InterestPolicyReadiness {
  const calculationBlockers = blockers.filter((blocker) => calculationFields.has(blocker.field));
  const calculationExecutable = policyConfigured && calculationBlockers.length === 0;
  const facilityWorkflowExecutable = policyConfigured && blockers.length === 0;
  return {
    executable: facilityWorkflowExecutable,
    calculationExecutable,
    facilityWorkflowExecutable,
    blockers,
  };
}

export function assessInterestPolicyReadiness(policy: InterestPolicy | null): InterestPolicyReadiness {
  if (!policy) {
    return {
      ...notConfigured("interestPolicy", "No interest policy is configured."),
      calculationExecutable: false,
      facilityWorkflowExecutable: false,
    };
  }

  const blockers: PolicyBlocker[] = [];
  considerStrategy(
    blockers,
    "calculationStrategy",
    policy.calculationStrategy,
    executableCalculationStrategies,
    "calculationStrategy is not configured.",
    "the interest engine",
  );
  considerStrategy(
    blockers,
    "allocationFrequency",
    policy.allocationFrequency,
    executableAllocationFrequencies,
    "allocationFrequency is not configured.",
    "the interest engine",
  );
  considerStrategy(
    blockers,
    "recalculationFrequency",
    policy.recalculationFrequency,
    executableRecalculationFrequencies,
    "recalculationFrequency is not configured.",
    "the interest engine",
  );
  considerStrategy(
    blockers,
    "principalBasis",
    policy.principalBasis,
    executablePrincipalBasisStrategies,
    "MSPS principal basis is unconfirmed and no principal basis strategy is configured.",
    "the interest engine",
  );
  considerStrategy(
    blockers,
    "recalculationAnchor",
    policy.recalculationAnchor,
    executableRecalculationAnchors,
    "MSPS annual reset anchor is unconfirmed and no recalculation anchor is configured.",
    "the interest engine",
  );
  considerStrategy(
    blockers,
    "balanceChangeTreatment",
    policy.balanceChangeTreatment,
    executableBalanceChangeTreatments,
    "MSPS balance change treatment is unconfirmed and no treatment is configured.",
    "the interest engine",
  );

  return interestReadiness(blockers, true);
}

function repaymentReadiness(
  blockers: PolicyBlocker[],
  policyConfigured: boolean,
): RepaymentPolicyReadiness {
  const facilityWorkflowExecutable = policyConfigured && blockers.length === 0;
  return {
    executable: facilityWorkflowExecutable,
    scheduleAssemblyAvailable: true,
    facilityWorkflowExecutable,
    blockers,
  };
}

export function assessRepaymentPolicyReadiness(policy: RepaymentPolicy | null): RepaymentPolicyReadiness {
  if (!policy) {
    return {
      ...notConfigured("repaymentPolicy", "No repayment policy is configured."),
      scheduleAssemblyAvailable: true,
      facilityWorkflowExecutable: false,
    };
  }

  const blockers: PolicyBlocker[] = [];
  considerStrategy(
    blockers,
    "repaymentStructure",
    policy.repaymentStructure,
    executableRepaymentStructures,
    "MSPS repayment structure is unconfirmed and no repayment structure is configured.",
    "the repayment schedule engine",
  );
  considerStrategy(
    blockers,
    "repaymentFrequency",
    policy.repaymentFrequency,
    executableRepaymentFrequencies,
    "MSPS repayment frequency is unconfirmed and no repayment frequency is configured.",
    "the repayment schedule engine",
  );
  considerStrategy(
    blockers,
    "principalRepaymentMethod",
    policy.principalRepaymentMethod,
    executablePrincipalRepaymentMethods,
    "MSPS principal repayment method is unconfirmed and no method is configured.",
    "the repayment schedule engine",
  );
  considerStrategy(
    blockers,
    "scheduleCommencementBasis",
    policy.scheduleCommencementBasis,
    executableScheduleCommencementBases,
    "MSPS schedule commencement is unconfirmed and no commencement strategy is configured.",
    "the repayment schedule engine",
  );
  considerStrategy(
    blockers,
    "firstRepaymentRule",
    policy.firstRepaymentRule?.strategy,
    executableFirstRepaymentRuleStrategies,
    "MSPS first repayment rule is unconfirmed and no first repayment rule is configured.",
    "the repayment schedule engine",
  );
  considerStrategy(
    blockers,
    "term",
    policy.term?.strategy,
    executableTermStrategies,
    "MSPS maturity treatment is unconfirmed and no term strategy is configured.",
    "the repayment schedule engine",
  );

  if (policy.paymentAllocationPriority === undefined) {
    blockers.push(
      unresolved(
        "paymentAllocationPriority",
        "No payment allocation order is configured. INTEREST then PRINCIPAL is not assumed.",
      ),
    );
  } else {
    blockers.push(
      notExecutable(
        "paymentAllocationPriority",
        policy.paymentAllocationPriority.join(" -> "),
        "the payment allocation engine",
      ),
    );
  }

  considerStrategy(
    blockers,
    "gracePeriod",
    policy.gracePeriod?.strategy,
    executableGracePeriodStrategies,
    "MSPS grace period is unconfirmed and no grace period strategy is configured.",
    "the repayment schedule engine",
  );

  return repaymentReadiness(blockers, true);
}

export function assessPaymentVariancePolicyReadiness(
  policy: PaymentVariancePolicy | null,
): PolicyReadiness {
  if (!policy) {
    return notConfigured("paymentVariancePolicy", "No payment variance policy is configured.");
  }

  const blockers: PolicyBlocker[] = [];
  considerStrategy(
    blockers,
    "underpaymentTreatment",
    policy.underpaymentTreatment,
    executableUnderpaymentTreatments,
    "MSPS underpayment treatment is unconfirmed and no underpayment treatment is configured.",
    "the payment allocation engine",
  );
  considerStrategy(
    blockers,
    "overpaymentTreatment",
    policy.overpaymentTreatment,
    executableOverpaymentTreatments,
    "MSPS overpayment treatment is unconfirmed and no overpayment treatment is configured.",
    "the payment allocation engine",
  );

  return readiness(blockers);
}

export function assessFinancialPolicyReadiness(policies: FinancialPolicies): {
  interestPolicy: PolicyReadiness;
  repaymentPolicy: PolicyReadiness;
  paymentVariancePolicy: PolicyReadiness;
} {
  return {
    interestPolicy: assessInterestPolicyReadiness(policies.interestPolicy),
    repaymentPolicy: assessRepaymentPolicyReadiness(policies.repaymentPolicy),
    paymentVariancePolicy: assessPaymentVariancePolicyReadiness(policies.paymentVariancePolicy),
  };
}

function assertExecutable(readinessResult: PolicyReadiness): void {
  if (readinessResult.executable) {
    return;
  }

  throw new AppError(
    409,
    readinessResult.blockers.map((blocker) => blocker.message).join("; "),
    "POLICY_NOT_EXECUTABLE",
  );
}

export function assertInterestPolicyExecutable(policy: InterestPolicy | null): void {
  assertExecutable(assessInterestPolicyReadiness(policy));
}

export function assertRepaymentPolicyExecutable(policy: RepaymentPolicy | null): void {
  assertExecutable(assessRepaymentPolicyReadiness(policy));
}

export function assertPaymentVariancePolicyExecutable(policy: PaymentVariancePolicy | null): void {
  assertExecutable(assessPaymentVariancePolicyReadiness(policy));
}
