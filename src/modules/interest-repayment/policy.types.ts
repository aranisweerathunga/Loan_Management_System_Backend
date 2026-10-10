import type {
  allocationFrequencies,
  balanceChangeTreatments,
  calculationStrategies,
  firstRepaymentRuleStrategies,
  gracePeriodStrategies,
  overpaymentTreatments,
  paymentAllocationComponents,
  principalBasisStrategies,
  principalRepaymentMethods,
  recalculationAnchors,
  recalculationFrequencies,
  repaymentFrequencies,
  repaymentStructures,
  scheduleCommencementBases,
  termStrategies,
  underpaymentTreatments,
} from "./policy.constants.js";

export type CalculationStrategy = (typeof calculationStrategies)[number];
export type AllocationFrequency = (typeof allocationFrequencies)[number];
export type RecalculationFrequency = (typeof recalculationFrequencies)[number];
export type PrincipalBasisStrategy = (typeof principalBasisStrategies)[number];
export type RecalculationAnchorStrategy = (typeof recalculationAnchors)[number];
export type BalanceChangeTreatment = (typeof balanceChangeTreatments)[number];

export type PaymentAllocationComponent = (typeof paymentAllocationComponents)[number];
export type RepaymentStructure = (typeof repaymentStructures)[number];
export type RepaymentFrequency = (typeof repaymentFrequencies)[number];
export type PrincipalRepaymentMethod = (typeof principalRepaymentMethods)[number];
export type ScheduleCommencementBasis = (typeof scheduleCommencementBases)[number];
export type FirstRepaymentRuleStrategy = (typeof firstRepaymentRuleStrategies)[number];
export type GracePeriodStrategy = (typeof gracePeriodStrategies)[number];
export type TermStrategy = (typeof termStrategies)[number];
export type UnderpaymentTreatment = (typeof underpaymentTreatments)[number];
export type OverpaymentTreatment = (typeof overpaymentTreatments)[number];

/**
 * Structurally valid interest policy.
 * principalBasis and recalculationAnchor stay unset until MSPS confirms identifiers.
 */
export type InterestPolicy = {
  annualRate: string;
  calculationStrategy: CalculationStrategy;
  allocationFrequency: AllocationFrequency;
  recalculationFrequency: RecalculationFrequency;
  principalBasis?: PrincipalBasisStrategy;
  recalculationAnchor?: RecalculationAnchorStrategy;
  balanceChangeTreatment?: BalanceChangeTreatment;
};

export type ControlledStrategyRule<TStrategy extends string> = {
  strategy: TStrategy;
};

export type FirstRepaymentRule = ControlledStrategyRule<FirstRepaymentRuleStrategy>;
export type GracePeriodRule = ControlledStrategyRule<GracePeriodStrategy>;
export type TermConfiguration = ControlledStrategyRule<TermStrategy>;

/**
 * Structurally valid repayment policy.
 * Unconfirmed strategy fields cannot be populated yet.
 * paymentAllocationPriority is explicit; it is never filled in by the server.
 */
export type RepaymentPolicy = {
  repaymentStructure?: RepaymentStructure;
  repaymentFrequency?: RepaymentFrequency;
  principalRepaymentMethod?: PrincipalRepaymentMethod;
  scheduleCommencementBasis?: ScheduleCommencementBasis;
  firstRepaymentRule?: FirstRepaymentRule;
  gracePeriod?: GracePeriodRule;
  paymentAllocationPriority?: PaymentAllocationComponent[];
  term?: TermConfiguration;
};

export type PaymentVariancePolicy = {
  underpaymentTreatment?: UnderpaymentTreatment;
  overpaymentTreatment?: OverpaymentTreatment;
};

export type FinancialPolicies = {
  interestPolicy: InterestPolicy | null;
  repaymentPolicy: RepaymentPolicy | null;
  paymentVariancePolicy: PaymentVariancePolicy | null;
};

export const policyBlockerCodes = [
  "POLICY_NOT_CONFIGURED",
  "POLICY_UNRESOLVED",
  "STRATEGY_NOT_EXECUTABLE",
] as const;

export type PolicyBlockerCode = (typeof policyBlockerCodes)[number];

export type PolicyBlocker = {
  code: PolicyBlockerCode;
  field: string;
  message: string;
};

/** Engine readiness. A valid configuration can still be non-executable. */
export type PolicyReadiness = {
  /**
   * For interest policy, this is facility-workflow readiness.
   * It stays false while principal basis, reset anchor, or balance-change treatment is unresolved.
   */
  executable: boolean;
  blockers: PolicyBlocker[];
};

/**
 * Separates the pure annual-allocation calculation from the facility interest workflow.
 * calculationExecutable means a caller-supplied principal can be allocated.
 * facilityWorkflowExecutable means the system can also resolve MSPS principal basis, anchor, and balance-change treatment.
 */
export type InterestPolicyReadiness = PolicyReadiness & {
  calculationExecutable: boolean;
  facilityWorkflowExecutable: boolean;
};

/**
 * Separates deterministic schedule assembly from MSPS repayment-policy readiness.
 * scheduleAssemblyAvailable means already-resolved dates and allocations can be assembled.
 * facilityWorkflowExecutable means the ProductVersion policy can generate a facility schedule.
 */
export type RepaymentPolicyReadiness = PolicyReadiness & {
  scheduleAssemblyAvailable: boolean;
  facilityWorkflowExecutable: boolean;
};
