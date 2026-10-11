import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { readFinancialPolicies } from "./configuration.js";
import type { InterestPolicy, RepaymentPolicy } from "./policy.types.js";
import {
  validateInterestCalculationSnapshot,
  validateRepaymentScheduleSnapshot,
} from "./snapshot-validation.js";

/**
 * Internal persistence for an already supplied financial snapshot.
 *
 * Successful retries are not idempotent. Calling either function again inserts
 * another history row. Do not expose these functions through an HTTP route.
 *
 * This module does not make snapshot rows immutable. Database grants and
 * application code can still update or delete them until a later safeguard.
 *
 * It does not resolve principal, derive repayment dates, post loan transactions,
 * or replace the facility's bound ProductVersion with a newer one.
 */

const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 15_000 } as const;
const POLICY_SECTIONS = ["interestPolicy", "repaymentPolicy"] as const;

type PolicySection = (typeof POLICY_SECTIONS)[number];

type LockedFacility = {
  id: string;
  productVersionId: string;
};

type StoredPolicies = {
  interestPolicy: InterestPolicy | null;
  repaymentPolicy: RepaymentPolicy | null;
};

export type PersistedInterestAllocation = {
  id: string;
  sequence: number;
  interestAmount: string;
};

export type PersistedInterestCalculation = {
  id: string;
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
  allocations: PersistedInterestAllocation[];
};

export type PersistedScheduleEntry = {
  id: string;
  sequence: number;
  dueDate: string;
  openingPrincipal: string;
  scheduledPrincipal: string;
  scheduledInterest: string;
  totalScheduledAmount: string;
  closingPrincipal: string;
};

export type PersistedRepaymentSchedule = {
  id: string;
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
  entries: PersistedScheduleEntry[];
};

function validationError(message: string): AppError {
  return new AppError(400, message, "VALIDATION_ERROR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePayload(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw validationError(`${field} must be an object`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "historySequence")) {
    throw validationError("historySequence is allocated by the snapshot writer");
  }
  return value;
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    throw validationError(`${field} must be a non-empty string`);
  }
  return value;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
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

/**
 * Sequence counters are not money. The facility row lock serializes allocation.
 */
function nextSequence(value: unknown): number {
  const parsed =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppError(500, "Failed to allocate history sequence", "INTERNAL_SERVER_ERROR");
  }
  const next = parsed + 1;
  if (!Number.isSafeInteger(next)) {
    throw new AppError(500, "Failed to allocate history sequence", "INTERNAL_SERVER_ERROR");
  }
  return next;
}

async function lockFacility(tx: Prisma.TransactionClient, loanFacilityId: string): Promise<LockedFacility> {
  const rows = await tx.$queryRaw<LockedFacility[]>`
    SELECT "id", "productVersionId"
    FROM "LoanFacility"
    WHERE "id" = ${loanFacilityId}
    FOR UPDATE
  `;
  const facility = rows[0];
  if (!facility) {
    throw new AppError(404, "Loan facility not found", "NOT_FOUND");
  }
  return facility;
}

async function loadBoundPolicies(tx: Prisma.TransactionClient, facility: LockedFacility): Promise<StoredPolicies> {
  const version = await tx.productVersion.findUnique({
    where: { id: facility.productVersionId },
    select: { id: true, configuration: true },
  });
  if (!version) {
    throw new AppError(409, "The facility's product version can no longer be resolved", "INVALID_STATE");
  }
  const policies = readFinancialPolicies(version.configuration);
  return {
    interestPolicy: policies.interestPolicy,
    repaymentPolicy: policies.repaymentPolicy,
  };
}

function assertBoundIdentity(payload: Record<string, unknown>, facility: LockedFacility): void {
  const loanFacilityId = requireIdentifier(payload.loanFacilityId, "loanFacilityId");
  const productVersionId = requireIdentifier(payload.productVersionId, "productVersionId");
  if (loanFacilityId !== facility.id) {
    throw new AppError(409, "loanFacilityId does not match the locked facility", "CONFLICT");
  }
  if (productVersionId !== facility.productVersionId) {
    throw new AppError(409, "productVersionId does not match the facility's bound ProductVersion", "CONFLICT");
  }
}

function assertPolicyProvenance(
  snapshot: unknown,
  stored: StoredPolicies,
  required: readonly PolicySection[],
): Record<string, unknown> {
  if (!isRecord(snapshot)) {
    throw validationError("policySnapshot must be an object");
  }
  for (const key of Object.keys(snapshot)) {
    if (!POLICY_SECTIONS.includes(key as PolicySection)) {
      throw new AppError(409, `policySnapshot.${key} is not part of the bound ProductVersion policy`, "CONFLICT");
    }
  }
  for (const section of required) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, section)) {
      throw new AppError(409, `policySnapshot.${section} must match the bound ProductVersion`, "CONFLICT");
    }
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "interestPolicy")) {
    if (stored.interestPolicy === null || !jsonEqual(snapshot.interestPolicy, stored.interestPolicy)) {
      throw new AppError(409, "policySnapshot.interestPolicy does not match the bound ProductVersion", "CONFLICT");
    }
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "repaymentPolicy")) {
    if (stored.repaymentPolicy === null || !jsonEqual(snapshot.repaymentPolicy, stored.repaymentPolicy)) {
      throw new AppError(409, "policySnapshot.repaymentPolicy does not match the bound ProductVersion", "CONFLICT");
    }
  }
  return snapshot;
}

function storedPolicySections(stored: StoredPolicies): PolicySection[] {
  const sections: PolicySection[] = [];
  if (stored.interestPolicy !== null) {
    sections.push("interestPolicy");
  }
  if (stored.repaymentPolicy !== null) {
    sections.push("repaymentPolicy");
  }
  return sections;
}

async function nextCalculationSequence(tx: Prisma.TransactionClient, loanFacilityId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ maxSequence: unknown }>>`
    SELECT COALESCE(MAX("historySequence"), 0)::int AS "maxSequence"
    FROM "InterestCalculation"
    WHERE "loanFacilityId" = ${loanFacilityId}
  `;
  return nextSequence(rows[0]?.maxSequence);
}

async function nextScheduleSequence(tx: Prisma.TransactionClient, loanFacilityId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ maxSequence: unknown }>>`
    SELECT COALESCE(MAX("historySequence"), 0)::int AS "maxSequence"
    FROM "RepaymentSchedule"
    WHERE "loanFacilityId" = ${loanFacilityId}
  `;
  return nextSequence(rows[0]?.maxSequence);
}

export async function persistInterestCalculationSnapshot(input: unknown): Promise<PersistedInterestCalculation> {
  const payload = requirePayload(input, "interestCalculation");
  requireIdentifier(payload.loanFacilityId, "loanFacilityId");

  return prisma.$transaction(async (tx) => {
    const facility = await lockFacility(tx, payload.loanFacilityId as string);
    assertBoundIdentity(payload, facility);
    const policies = await loadBoundPolicies(tx, facility);
    assertPolicyProvenance(payload.policySnapshot, policies, ["interestPolicy"]);
    const historySequence = await nextCalculationSequence(tx, facility.id);
    const validated = validateInterestCalculationSnapshot(
      { ...payload, historySequence },
      { facilityId: facility.id, productVersionId: facility.productVersionId },
    );
    const stored = await tx.interestCalculation.create({
      data: {
        loanFacilityId: validated.loanFacilityId,
        productVersionId: validated.productVersionId,
        historySequence: validated.historySequence,
        calculationStrategy: validated.calculationStrategy,
        principalAmount: validated.principalAmount,
        annualRate: validated.annualRate,
        annualInterestAmount: validated.annualInterestAmount,
        allocationFrequency: validated.allocationFrequency,
        recalculationFrequency: validated.recalculationFrequency,
        periodStart: validated.periodStart === null ? null : dateOnly(validated.periodStart),
        periodEnd: validated.periodEnd === null ? null : dateOnly(validated.periodEnd),
        inputSnapshot: jsonValue(validated.inputSnapshot),
        policySnapshot: jsonValue(validated.policySnapshot),
        resultSnapshot: jsonValue(validated.resultSnapshot),
        allocations: {
          create: validated.allocations.map((allocation) => ({
            sequence: allocation.sequence,
            interestAmount: allocation.interestAmount,
          })),
        },
      },
      include: { allocations: { orderBy: { sequence: "asc" } } },
    });

    return {
      id: stored.id,
      loanFacilityId: validated.loanFacilityId,
      productVersionId: validated.productVersionId,
      historySequence: validated.historySequence,
      calculationStrategy: validated.calculationStrategy,
      principalAmount: validated.principalAmount,
      annualRate: validated.annualRate,
      annualInterestAmount: validated.annualInterestAmount,
      allocationFrequency: validated.allocationFrequency,
      recalculationFrequency: validated.recalculationFrequency,
      periodStart: validated.periodStart,
      periodEnd: validated.periodEnd,
      allocations: stored.allocations.map((allocation) => {
        const canonical = validated.allocations.find((item) => item.sequence === allocation.sequence);
        if (!canonical) {
          throw new AppError(500, "Persisted interest allocation sequence was not validated", "INTERNAL_SERVER_ERROR");
        }
        return {
          id: allocation.id,
          sequence: canonical.sequence,
          interestAmount: canonical.interestAmount,
        };
      }),
    };
  }, TRANSACTION_OPTIONS);
}

export async function persistRepaymentScheduleSnapshot(input: unknown): Promise<PersistedRepaymentSchedule> {
  const payload = requirePayload(input, "repaymentSchedule");
  requireIdentifier(payload.loanFacilityId, "loanFacilityId");

  return prisma.$transaction(async (tx) => {
    const facility = await lockFacility(tx, payload.loanFacilityId as string);
    assertBoundIdentity(payload, facility);
    const policies = await loadBoundPolicies(tx, facility);
    assertPolicyProvenance(payload.policySnapshot, policies, storedPolicySections(policies));
    const historySequence = await nextScheduleSequence(tx, facility.id);
    const validated = validateRepaymentScheduleSnapshot(
      { ...payload, historySequence },
      { facilityId: facility.id, productVersionId: facility.productVersionId },
    );
    const stored = await tx.repaymentSchedule.create({
      data: {
        loanFacilityId: validated.loanFacilityId,
        productVersionId: validated.productVersionId,
        historySequence: validated.historySequence,
        interestCalculationId: validated.interestCalculationId,
        principalAmount: validated.principalAmount,
        totalScheduledPrincipal: validated.totalScheduledPrincipal,
        totalScheduledInterest: validated.totalScheduledInterest,
        totalScheduledAmount: validated.totalScheduledAmount,
        remainingPrincipal: validated.remainingPrincipal,
        numberOfInstalments: validated.numberOfInstalments,
        inputSnapshot: jsonValue(validated.inputSnapshot),
        policySnapshot: jsonValue(validated.policySnapshot),
        resultSnapshot: jsonValue(validated.resultSnapshot),
        entries: {
          create: validated.entries.map((entry) => ({
            sequence: entry.sequence,
            dueDate: dateOnly(entry.dueDate),
            openingPrincipal: entry.openingPrincipal,
            scheduledPrincipal: entry.scheduledPrincipal,
            scheduledInterest: entry.scheduledInterest,
            totalScheduledAmount: entry.totalScheduledAmount,
            closingPrincipal: entry.closingPrincipal,
          })),
        },
      },
      include: { entries: { orderBy: { sequence: "asc" } } },
    });

    return {
      id: stored.id,
      loanFacilityId: validated.loanFacilityId,
      productVersionId: validated.productVersionId,
      historySequence: validated.historySequence,
      interestCalculationId: validated.interestCalculationId,
      principalAmount: validated.principalAmount,
      totalScheduledPrincipal: validated.totalScheduledPrincipal,
      totalScheduledInterest: validated.totalScheduledInterest,
      totalScheduledAmount: validated.totalScheduledAmount,
      remainingPrincipal: validated.remainingPrincipal,
      numberOfInstalments: validated.numberOfInstalments,
      entries: stored.entries.map((entry) => {
        const canonical = validated.entries.find((item) => item.sequence === entry.sequence);
        if (!canonical) {
          throw new AppError(500, "Persisted schedule entry sequence was not validated", "INTERNAL_SERVER_ERROR");
        }
        return {
          id: entry.id,
          sequence: canonical.sequence,
          dueDate: canonical.dueDate,
          openingPrincipal: canonical.openingPrincipal,
          scheduledPrincipal: canonical.scheduledPrincipal,
          scheduledInterest: canonical.scheduledInterest,
          totalScheduledAmount: canonical.totalScheduledAmount,
          closingPrincipal: canonical.closingPrincipal,
        };
      }),
    };
  }, TRANSACTION_OPTIONS);
}
