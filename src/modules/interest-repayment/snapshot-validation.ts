import { AppError } from "../../shared/errors/app-error.js";
import { Decimal, MAX_MONEY } from "../../shared/money/decimal.js";
import { isIsoCalendarDate } from "../loan-facilities/loan-facility.schemas.js";
import { calculateInterest } from "./interest-engine.js";
import {
  ANNUAL_RATE_DECIMAL_PLACES,
  MAX_ANNUAL_RATE,
  balanceChangeTreatments,
} from "./policy.constants.js";
import { interestPolicySchema, repaymentPolicySchema } from "./policy.schemas.js";
import { assembleRepaymentSchedule } from "./repayment-schedule-engine.js";
import type { AnnualInterestAllocationResult } from "./annual-interest-allocation.js";
import type { RepaymentScheduleResult } from "./repayment-schedule-engine.js";

/**
 * Pure consistency checks for a proposed calculation or schedule insert.
 * The caller supplies the facility context. This module does not read a facility,
 * a ProductVersion, or a database, and it does not choose MSPS policy.
 * Financial strings are accepted or rejected unchanged.
 */

const ANNUAL_RATE_PATTERN = new RegExp(
  `^(?:0|[1-9]\\d*)(?:\\.\\d{1,${ANNUAL_RATE_DECIMAL_PLACES}})?$`,
);
const CANONICAL_MONEY = /^(?:0|[1-9]\d*)\.\d{2}$/;
const FINANCIAL_KEYS = new Set([
  "principalAmount",
  "annualRate",
  "annualInterestAmount",
  "interestAmount",
  "openingPrincipal",
  "scheduledPrincipal",
  "scheduledInterest",
  "totalScheduledAmount",
  "closingPrincipal",
  "totalScheduledPrincipal",
  "totalScheduledInterest",
  "remainingPrincipal",
]);
const INTEREST_POLICY_ROOT_KEYS = ["interestPolicy"] as const;
const SCHEDULE_POLICY_ROOT_KEYS = ["interestPolicy", "repaymentPolicy"] as const;
const ALLOCATION_FIELDS = ["sequence", "interestAmount"] as const;
const ENTRY_FIELDS = [
  "sequence",
  "dueDate",
  "openingPrincipal",
  "scheduledPrincipal",
  "scheduledInterest",
  "totalScheduledAmount",
  "closingPrincipal",
] as const;
const UNRESOLVED_FIELDS = [
  "principalBasis",
  "recalculationAnchor",
  "repaymentStructure",
  "repaymentFrequency",
  "principalRepaymentMethod",
  "scheduleCommencementBasis",
  "firstRepaymentRule",
  "gracePeriod",
  "term",
  "facilityDate",
  "disbursementDate",
  "maturityDate",
] as const;

export type FacilitySnapshotContext = {
  facilityId: string;
  productVersionId: string;
};

export type ValidatedInterestAllocation = {
  sequence: number;
  interestAmount: string;
};

export type ValidatedInterestCalculationSnapshot = {
  loanFacilityId: string;
  productVersionId: string;
  historySequence: number;
  calculationStrategy: "ANNUAL_INTEREST_ALLOCATION";
  principalAmount: string;
  annualRate: string;
  annualInterestAmount: string;
  allocationFrequency: "MONTHLY";
  recalculationFrequency: "ANNUAL";
  periodStart: string | null;
  periodEnd: string | null;
  allocations: ValidatedInterestAllocation[];
  inputSnapshot: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  resultSnapshot: AnnualInterestAllocationResult;
};

export type ValidatedRepaymentScheduleSnapshot = {
  loanFacilityId: string;
  productVersionId: string;
  historySequence: number;
  interestCalculationId: string | null;
  principalAmount: string;
  totalScheduledPrincipal: string;
  totalScheduledInterest: string;
  totalScheduledAmount: string;
  remainingPrincipal: string;
  numberOfInstalments: number;
  entries: RepaymentScheduleResult["entries"];
  inputSnapshot: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  resultSnapshot: RepaymentScheduleResult;
};

function validationError(message: string): AppError {
  return new AppError(400, message, "VALIDATION_ERROR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw validationError(`${field} must be an object`);
  }
  return value;
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    throw validationError(`${field} must be a non-empty string`);
  }
  return value;
}

function requirePositiveSequence(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw validationError(`${field} must be a positive integer`);
  }
  return value;
}

function requireCanonicalMoney(value: unknown, field: string): string {
  if (typeof value === "number") {
    throw validationError(`${field} must be a decimal string, not a number`);
  }
  if (typeof value !== "string") {
    throw validationError(`${field} must be a decimal string`);
  }
  if (value.startsWith("-")) {
    throw validationError(`${field} must not be negative`);
  }
  if (!CANONICAL_MONEY.test(value)) {
    throw validationError(`${field} must be a non-negative decimal string with 2 decimal places`);
  }
  const amount = new Decimal(value);
  if (amount.greaterThan(MAX_MONEY)) {
    throw validationError(`${field} exceeds the supported monetary precision`);
  }
  return value;
}

function requireAnnualRate(value: unknown, field: string): string {
  if (typeof value === "number") {
    throw validationError(`${field} must be a decimal string, not a number`);
  }
  if (typeof value !== "string") {
    throw validationError(`${field} must be a decimal string`);
  }
  if (value.startsWith("-")) {
    throw validationError(`${field} must not be negative`);
  }
  if (!ANNUAL_RATE_PATTERN.test(value)) {
    throw validationError(
      `${field} must be a non-negative decimal string with up to ${ANNUAL_RATE_DECIMAL_PLACES} decimal places`,
    );
  }
  const rate = new Decimal(value);
  if (rate.greaterThan(MAX_ANNUAL_RATE)) {
    throw validationError(`${field} exceeds the supported decimal precision`);
  }
  return value;
}

function requireContext(value: unknown): FacilitySnapshotContext {
  const context = requireRecord(value, "facilityContext");
  return {
    facilityId: requireIdentifier(context.facilityId, "facilityContext.facilityId"),
    productVersionId: requireIdentifier(context.productVersionId, "facilityContext.productVersionId"),
  };
}

function assertSameFacility(loanFacilityId: string, productVersionId: string, context: FacilitySnapshotContext): void {
  if (loanFacilityId !== context.facilityId) {
    throw validationError("loanFacilityId does not match the facility context");
  }
  if (productVersionId !== context.productVersionId) {
    throw validationError("productVersionId does not match the facility context");
  }
}

function rejectUnresolved(record: Record<string, unknown>, path: string): void {
  for (const field of UNRESOLVED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw validationError(`${path}.${field} is not resolved by snapshot validation`);
    }
  }
}

function rejectFinancialNumbers(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectFinancialNumbers(item, `${path}.${index}`));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FINANCIAL_KEYS.has(key) && typeof child === "number") {
      throw validationError(`${path}.${key} must be a decimal string, not a number`);
    }
    rejectFinancialNumbers(child, `${path}.${key}`);
  }
}

function requireOptionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || !isIsoCalendarDate(value)) {
    throw validationError(`${field} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw validationError(`${path}.${key} is not part of the snapshot`);
    }
  }
}

function formatSchemaIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.map(String).join(".");
      return issuePath ? `${issuePath}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function assertParsedPolicy(
  value: unknown,
  schema: {
    safeParse: (input: unknown) =>
      | { success: true; data: unknown }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  field: string,
): void {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw validationError(`${field}: ${formatSchemaIssues(parsed.error)}`);
  }
  if (!jsonEqual(value, parsed.data)) {
    throw validationError(`${field} does not match its validated representation`);
  }
}

function assertConsecutive(sequences: number[], field: string): void {
  for (let index = 0; index < sequences.length; index += 1) {
    if (sequences[index] !== index + 1) {
      throw validationError(`${field} must use consecutive sequences starting at 1`);
    }
  }
}

function assertJsonEqual(actual: unknown, expected: unknown, field: string): void {
  if (!jsonEqual(actual, expected)) {
    throw validationError(`${field} does not match the proposed relational values`);
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) {
      return false;
    }
    return leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && jsonEqual(left[key], right[key]),
    );
  }
  return false;
}

function assertInterestPolicySnapshot(
  snapshot: Record<string, unknown>,
  expected: {
    annualRate: string;
    calculationStrategy: string;
    allocationFrequency: string;
    recalculationFrequency: string;
  },
): void {
  if (Object.keys(snapshot).length === 0) {
    throw validationError("policySnapshot must record the ProductVersion policy applied to this calculation");
  }
  rejectUnknownFields(snapshot, INTEREST_POLICY_ROOT_KEYS, "policySnapshot");
  rejectUnresolved(snapshot, "policySnapshot");
  const policy = snapshot.interestPolicy;
  if (!isRecord(policy)) {
    throw validationError("policySnapshot.interestPolicy must record the applied interest policy");
  }
  rejectUnresolved(policy, "policySnapshot.interestPolicy");
  const allowed = new Set([
    "annualRate",
    "calculationStrategy",
    "allocationFrequency",
    "recalculationFrequency",
    "balanceChangeTreatment",
  ]);
  for (const key of Object.keys(policy)) {
    if (!allowed.has(key)) {
      throw validationError(`policySnapshot.interestPolicy.${key} is not part of the calculation snapshot`);
    }
  }
  if (policy.annualRate !== expected.annualRate) {
    throw validationError("policySnapshot.interestPolicy.annualRate must match annualRate");
  }
  if (policy.calculationStrategy !== expected.calculationStrategy) {
    throw validationError("policySnapshot.interestPolicy.calculationStrategy must match calculationStrategy");
  }
  if (policy.allocationFrequency !== expected.allocationFrequency) {
    throw validationError("policySnapshot.interestPolicy.allocationFrequency must match allocationFrequency");
  }
  if (policy.recalculationFrequency !== expected.recalculationFrequency) {
    throw validationError(
      "policySnapshot.interestPolicy.recalculationFrequency must match recalculationFrequency",
    );
  }
  if (policy.balanceChangeTreatment !== undefined) {
    if (
      typeof policy.balanceChangeTreatment !== "string" ||
      !(balanceChangeTreatments as readonly string[]).includes(policy.balanceChangeTreatment)
    ) {
      throw validationError("policySnapshot.interestPolicy.balanceChangeTreatment is unrecognized");
    }
  }
}

function assertSchedulePolicySnapshot(snapshot: Record<string, unknown>): void {
  if (Object.keys(snapshot).length === 0) {
    throw validationError("policySnapshot must record the ProductVersion policy applied to this schedule");
  }
  rejectUnknownFields(snapshot, SCHEDULE_POLICY_ROOT_KEYS, "policySnapshot");
  const interestPolicy = snapshot.interestPolicy;
  const repaymentPolicy = snapshot.repaymentPolicy;
  if (interestPolicy === undefined && repaymentPolicy === undefined) {
    throw validationError("policySnapshot must record the ProductVersion policy applied to this schedule");
  }
  if (interestPolicy !== undefined) {
    assertParsedPolicy(interestPolicy, interestPolicySchema, "policySnapshot.interestPolicy");
  }
  if (repaymentPolicy !== undefined) {
    assertParsedPolicy(repaymentPolicy, repaymentPolicySchema, "policySnapshot.repaymentPolicy");
  }
}

export function validateInterestCalculationSnapshot(
  input: unknown,
  contextInput: unknown,
): ValidatedInterestCalculationSnapshot {
  const context = requireContext(contextInput);
  const payload = requireRecord(input, "interestCalculation");
  rejectUnresolved(payload, "interestCalculation");

  const loanFacilityId = requireIdentifier(payload.loanFacilityId, "loanFacilityId");
  const productVersionId = requireIdentifier(payload.productVersionId, "productVersionId");
  assertSameFacility(loanFacilityId, productVersionId, context);
  const historySequence = requirePositiveSequence(payload.historySequence, "historySequence");
  const calculationStrategy = requireIdentifier(payload.calculationStrategy, "calculationStrategy");
  if (calculationStrategy !== "ANNUAL_INTEREST_ALLOCATION") {
    throw validationError(
      `calculationStrategy: unrecognized strategy "${calculationStrategy}"; recognized strategies: ANNUAL_INTEREST_ALLOCATION`,
    );
  }
  const allocationFrequency = requireIdentifier(payload.allocationFrequency, "allocationFrequency");
  if (allocationFrequency !== "MONTHLY") {
    throw validationError(
      `allocationFrequency: unrecognized strategy "${allocationFrequency}"; recognized strategies: MONTHLY`,
    );
  }
  const recalculationFrequency = requireIdentifier(payload.recalculationFrequency, "recalculationFrequency");
  if (recalculationFrequency !== "ANNUAL") {
    throw validationError(
      `recalculationFrequency: unrecognized strategy "${recalculationFrequency}"; recognized strategies: ANNUAL`,
    );
  }

  const principalAmount = requireCanonicalMoney(payload.principalAmount, "principalAmount");
  const annualRate = requireAnnualRate(payload.annualRate, "annualRate");
  const annualInterestAmount = requireCanonicalMoney(payload.annualInterestAmount, "annualInterestAmount");
  const periodStart = requireOptionalDate(payload.periodStart, "periodStart");
  const periodEnd = requireOptionalDate(payload.periodEnd, "periodEnd");
  if (periodStart !== null && periodEnd !== null && periodEnd < periodStart) {
    throw validationError("periodEnd must not precede periodStart");
  }

  if (!Array.isArray(payload.allocations) || payload.allocations.length === 0) {
    throw validationError("allocations must contain at least one allocation");
  }
  const allocations = payload.allocations.map((allocation, index) => {
    const row = requireRecord(allocation, `allocations.${index}`);
    rejectUnknownFields(row, ALLOCATION_FIELDS, `allocations.${index}`);
    return {
      sequence: requirePositiveSequence(row.sequence, `allocations.${index}.sequence`),
      interestAmount: requireCanonicalMoney(row.interestAmount, `allocations.${index}.interestAmount`),
    };
  });
  assertConsecutive(
    allocations.map((allocation) => allocation.sequence),
    "allocations",
  );
  if (allocations.length !== 12) {
    throw validationError("allocations must contain the 12 monthly interest allocations");
  }

  const allocatedTotal = allocations.reduce(
    (total, allocation) => total.plus(allocation.interestAmount),
    new Decimal("0"),
  );
  if (!allocatedTotal.equals(annualInterestAmount)) {
    throw validationError("interest allocations must sum exactly to annualInterestAmount");
  }

  const engineResult = calculateInterest({
    calculationStrategy,
    principalAmount,
    annualRate,
    allocationFrequency,
    recalculationFrequency,
  });
  if (
    engineResult.annualInterestAmount !== annualInterestAmount ||
    !jsonEqual(engineResult.allocations, allocations)
  ) {
    throw validationError("interest calculation does not match the annual interest allocation result");
  }

  const inputSnapshot = requireRecord(payload.inputSnapshot, "inputSnapshot");
  const policySnapshot = requireRecord(payload.policySnapshot, "policySnapshot");
  const resultSnapshot = requireRecord(payload.resultSnapshot, "resultSnapshot");
  rejectFinancialNumbers(inputSnapshot, "inputSnapshot");
  rejectFinancialNumbers(policySnapshot, "policySnapshot");
  rejectFinancialNumbers(resultSnapshot, "resultSnapshot");
  rejectUnresolved(inputSnapshot, "inputSnapshot");
  assertJsonEqual(
    inputSnapshot,
    {
      principalAmount,
      annualRate,
      calculationStrategy,
      allocationFrequency,
      recalculationFrequency,
      periodStart,
      periodEnd,
    },
    "inputSnapshot",
  );
  assertInterestPolicySnapshot(policySnapshot, {
    annualRate,
    calculationStrategy,
    allocationFrequency,
    recalculationFrequency,
  });
  assertJsonEqual(resultSnapshot, engineResult, "resultSnapshot");

  return {
    loanFacilityId,
    productVersionId,
    historySequence,
    calculationStrategy,
    principalAmount,
    annualRate,
    annualInterestAmount,
    allocationFrequency,
    recalculationFrequency,
    periodStart,
    periodEnd,
    allocations,
    inputSnapshot,
    policySnapshot,
    resultSnapshot: engineResult,
  };
}

export function validateRepaymentScheduleSnapshot(
  input: unknown,
  contextInput: unknown,
): ValidatedRepaymentScheduleSnapshot {
  const context = requireContext(contextInput);
  const payload = requireRecord(input, "repaymentSchedule");
  rejectUnresolved(payload, "repaymentSchedule");

  const loanFacilityId = requireIdentifier(payload.loanFacilityId, "loanFacilityId");
  const productVersionId = requireIdentifier(payload.productVersionId, "productVersionId");
  assertSameFacility(loanFacilityId, productVersionId, context);
  const historySequence = requirePositiveSequence(payload.historySequence, "historySequence");
  const interestCalculationId =
    payload.interestCalculationId === undefined || payload.interestCalculationId === null
      ? null
      : requireIdentifier(payload.interestCalculationId, "interestCalculationId");

  const principalAmount = requireCanonicalMoney(payload.principalAmount, "principalAmount");
  const totalScheduledPrincipal = requireCanonicalMoney(payload.totalScheduledPrincipal, "totalScheduledPrincipal");
  const totalScheduledInterest = requireCanonicalMoney(payload.totalScheduledInterest, "totalScheduledInterest");
  const totalScheduledAmount = requireCanonicalMoney(payload.totalScheduledAmount, "totalScheduledAmount");
  const remainingPrincipal = requireCanonicalMoney(payload.remainingPrincipal, "remainingPrincipal");
  const numberOfInstalments = requirePositiveSequence(payload.numberOfInstalments, "numberOfInstalments");

  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    throw validationError("entries must contain at least one schedule entry");
  }
  const entries = payload.entries.map((entry, index) => {
    const row = requireRecord(entry, `entries.${index}`);
    rejectUnknownFields(row, ENTRY_FIELDS, `entries.${index}`);
    const dueDate = requireOptionalDate(row.dueDate, `entries.${index}.dueDate`);
    if (dueDate === null) {
      throw validationError(`entries.${index}.dueDate must be a valid YYYY-MM-DD date`);
    }
    return {
      sequence: requirePositiveSequence(row.sequence, `entries.${index}.sequence`),
      dueDate,
      openingPrincipal: requireCanonicalMoney(row.openingPrincipal, `entries.${index}.openingPrincipal`),
      scheduledPrincipal: requireCanonicalMoney(row.scheduledPrincipal, `entries.${index}.scheduledPrincipal`),
      scheduledInterest: requireCanonicalMoney(row.scheduledInterest, `entries.${index}.scheduledInterest`),
      totalScheduledAmount: requireCanonicalMoney(row.totalScheduledAmount, `entries.${index}.totalScheduledAmount`),
      closingPrincipal: requireCanonicalMoney(row.closingPrincipal, `entries.${index}.closingPrincipal`),
    };
  });
  assertConsecutive(
    entries.map((entry) => entry.sequence),
    "entries",
  );
  if (numberOfInstalments !== entries.length) {
    throw validationError("numberOfInstalments must equal the number of schedule entries");
  }

  const assembled = assembleRepaymentSchedule({
    principalAmount,
    dueDates: entries.map((entry) => entry.dueDate),
    principalAllocations: entries.map((entry) => entry.scheduledPrincipal),
    interestAllocations: entries.map((entry) => entry.scheduledInterest),
  });
  if (
    assembled.totalScheduledPrincipal !== totalScheduledPrincipal ||
    assembled.totalScheduledInterest !== totalScheduledInterest ||
    assembled.totalScheduledAmount !== totalScheduledAmount ||
    assembled.remainingPrincipal !== remainingPrincipal ||
    assembled.numberOfInstalments !== numberOfInstalments ||
    !jsonEqual(assembled.entries, entries)
  ) {
    throw validationError("repayment schedule does not match the assembled schedule entries");
  }

  const inputSnapshot = requireRecord(payload.inputSnapshot, "inputSnapshot");
  const policySnapshot = requireRecord(payload.policySnapshot, "policySnapshot");
  const resultSnapshot = requireRecord(payload.resultSnapshot, "resultSnapshot");
  rejectFinancialNumbers(inputSnapshot, "inputSnapshot");
  rejectFinancialNumbers(policySnapshot, "policySnapshot");
  rejectFinancialNumbers(resultSnapshot, "resultSnapshot");
  rejectUnresolved(inputSnapshot, "inputSnapshot");
  assertJsonEqual(
    inputSnapshot,
    {
      principalAmount,
      dueDates: entries.map((entry) => entry.dueDate),
      principalAllocations: entries.map((entry) => entry.scheduledPrincipal),
      interestAllocations: entries.map((entry) => entry.scheduledInterest),
    },
    "inputSnapshot",
  );
  assertSchedulePolicySnapshot(policySnapshot);
  assertJsonEqual(resultSnapshot, assembled, "resultSnapshot");

  return {
    loanFacilityId,
    productVersionId,
    historySequence,
    interestCalculationId,
    principalAmount,
    totalScheduledPrincipal,
    totalScheduledInterest,
    totalScheduledAmount,
    remainingPrincipal,
    numberOfInstalments,
    entries,
    inputSnapshot,
    policySnapshot,
    resultSnapshot: assembled,
  };
}
