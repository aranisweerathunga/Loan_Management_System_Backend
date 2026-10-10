import { Decimal } from "../../shared/money/decimal.js";

/**
 * Phase 8A configuration identifiers.
 *
 * Recognized identifiers are accepted in ProductVersion JSON.
 * Executable identifiers are the only ones an engine may run.
 * An empty executable list means the strategy is not implemented.
 * Empty recognized lists mean the MSPS choice is unconfirmed and must not be defaulted.
 */

/**
 * Decimal places for annualRate. Matches eligibility percentage strings, not money (2 dp).
 * MAX_ANNUAL_RATE is the technical DECIMAL(18, 4) column maximum, not an MSPS business cap.
 */
export const ANNUAL_RATE_DECIMAL_PLACES = 4;
export const MAX_ANNUAL_RATE = new Decimal("99999999999999.9999");

/** Confirmed calculation model. Daily accrual is intentionally absent. */
export const calculationStrategies = ["ANNUAL_INTEREST_ALLOCATION"] as const;

/** Allocation frequencies the annual-allocation model can be configured with. */
export const allocationFrequencies = ["MONTHLY"] as const;

/** Recalculation frequencies required by the current MSPS direction. */
export const recalculationFrequencies = ["ANNUAL"] as const;

/** No confirmed principal-basis identifiers. */
export const principalBasisStrategies = [] as const;

/** No confirmed annual reset anchors. */
export const recalculationAnchors = [] as const;

/**
 * Recognized balance-change treatments.
 * Selecting one does not make it executable.
 */
export const balanceChangeTreatments = [
  "SUPPLEMENTARY_CALCULATION",
  "IMMEDIATE_RECALCULATION",
  "NEXT_SCHEDULED_RECALCULATION",
] as const;

/**
 * Mathematical strategies the interest engine can run when the caller supplies an already-resolved principal.
 * These do not make the facility-level MSPS workflow executable.
 */
export const executableCalculationStrategies: readonly string[] = ["ANNUAL_INTEREST_ALLOCATION"];
export const executableAllocationFrequencies: readonly string[] = ["MONTHLY"];
export const executableRecalculationFrequencies: readonly string[] = ["ANNUAL"];
export const executablePrincipalBasisStrategies: readonly string[] = [];
export const executableRecalculationAnchors: readonly string[] = [];
export const executableBalanceChangeTreatments: readonly string[] = [];

/** Components an officer cannot reorder per repayment. Fees and penalties are absent. */
export const paymentAllocationComponents = ["INTEREST", "PRINCIPAL"] as const;

/** No confirmed repayment-structure identifiers. */
export const repaymentStructures = [] as const;

/** No confirmed repayment frequencies. Interest allocation frequency does not imply one. */
export const repaymentFrequencies = [] as const;

/** No confirmed principal-repayment methods. */
export const principalRepaymentMethods = [] as const;

/** No confirmed schedule-commencement identifiers. */
export const scheduleCommencementBases = [] as const;

/** No confirmed first-repayment rule identifiers. */
export const firstRepaymentRuleStrategies = [] as const;

/** No confirmed grace-period rule identifiers. */
export const gracePeriodStrategies = [] as const;

/** No confirmed term / maturity identifiers. */
export const termStrategies = [] as const;

export const executableRepaymentStructures: readonly string[] = [];
export const executableRepaymentFrequencies: readonly string[] = [];
export const executablePrincipalRepaymentMethods: readonly string[] = [];
export const executableScheduleCommencementBases: readonly string[] = [];
export const executableFirstRepaymentRuleStrategies: readonly string[] = [];
export const executableGracePeriodStrategies: readonly string[] = [];
export const executableTermStrategies: readonly string[] = [];

/** No confirmed underpayment treatments. Arrears and penalties are not represented. */
export const underpaymentTreatments = [] as const;

/** No confirmed overpayment treatments. The field stays reserved until MSPS confirms identifiers. */
export const overpaymentTreatments = [] as const;

export const executableUnderpaymentTreatments: readonly string[] = [];
export const executableOverpaymentTreatments: readonly string[] = [];
