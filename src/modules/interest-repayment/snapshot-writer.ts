import { createHash } from "node:crypto";
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
 * The caller supplies an idempotency key. The same key and financial payload
 * return the original snapshot. The same key with a different payload is a
 * conflict. Do not expose these functions through an HTTP route.
 *
 * This module does not make snapshot rows immutable. Database grants and
 * application code can still update or delete them until a later safeguard.
 *
 * It does not resolve principal, derive repayment dates, post loan transactions,
 * or replace the facility's bound ProductVersion with a newer one.
 */

const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 15_000 } as const;
const POLICY_SECTIONS = ["interestPolicy", "repaymentPolicy"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

function requireIdempotencyKey(value: string): string {
  if (typeof value !== "string") {
    throw validationError("idempotencyKey must be a UUID");
  }
  const normalized = value.toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw validationError("idempotencyKey must be a UUID");
  }
  return normalized;
}

function replayError(field: string): AppError {
  return new AppError(500, `Stored ${field} cannot be replayed`, "INTERNAL_SERVER_ERROR");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw validationError("financial payload must contain only JSON values");
    }
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "string" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw validationError("financial payload must not contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  throw validationError("financial payload must contain only JSON values");
}

/**
 * The digest covers the caller payload. Decimal strings are hashed as text.
 * historySequence and an embedded idempotency key are not financial content.
 */
function fingerprintPayload(payload: Record<string, unknown>): string {
  const financial: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    if (key === "historySequence" || key === "idempotencyKey") {
      continue;
    }
    financial[key] = payload[key];
  }
  return createHash("sha256").update(canonicalJson(financial), "utf8").digest("hex");
}

function storedRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw replayError(field);
  }
  return value;
}

function storedString(record: Record<string, unknown>, key: string, field: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw replayError(field);
  }
  return value;
}

function storedNullableString(record: Record<string, unknown>, key: string, field: string): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw replayError(field);
  }
  return value;
}

function storedInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw replayError(field);
  }
  return value;
}

function storedLiteral<T extends string>(value: string, expected: T, field: string): T {
  if (value !== expected) {
    throw replayError(field);
  }
  return expected;
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

function conflictError(): AppError {
  return new AppError(409, "idempotency key was already used for a different snapshot", "CONFLICT");
}

async function replayInterestCalculation(
  tx: Prisma.TransactionClient,
  interestCalculationId: string,
): Promise<PersistedInterestCalculation> {
  const stored = await tx.interestCalculation.findUnique({
    where: { id: interestCalculationId },
    include: { allocations: { orderBy: { sequence: "asc" } } },
  });
  if (!stored) {
    throw replayError("interest calculation");
  }
  const result = storedRecord(stored.resultSnapshot, "interest result snapshot");
  const input = storedRecord(stored.inputSnapshot, "interest input snapshot");
  const resultAllocations = result.allocations;
  if (!Array.isArray(resultAllocations)) {
    throw replayError("interest allocations");
  }
  const amounts = new Map<number, string>();
  for (const allocation of resultAllocations) {
    const row = storedRecord(allocation, "interest allocation");
    amounts.set(
      storedInteger(row.sequence, "interest allocation sequence"),
      storedString(row, "interestAmount", "interest allocation amount"),
    );
  }
  if (amounts.size !== stored.allocations.length || amounts.size !== resultAllocations.length) {
    throw replayError("interest allocations");
  }
  return {
    id: stored.id,
    loanFacilityId: stored.loanFacilityId,
    productVersionId: stored.productVersionId,
    historySequence: stored.historySequence,
    calculationStrategy: storedLiteral(
      storedString(result, "calculationStrategy", "calculation strategy"),
      "ANNUAL_INTEREST_ALLOCATION",
      "calculation strategy",
    ),
    principalAmount: storedString(result, "principalAmount", "principal amount"),
    annualRate: storedString(result, "annualRate", "annual rate"),
    annualInterestAmount: storedString(result, "annualInterestAmount", "annual interest amount"),
    allocationFrequency: storedLiteral(
      storedString(result, "allocationFrequency", "allocation frequency"),
      "MONTHLY",
      "allocation frequency",
    ),
    recalculationFrequency: storedLiteral(
      storedString(result, "recalculationFrequency", "recalculation frequency"),
      "ANNUAL",
      "recalculation frequency",
    ),
    periodStart: storedNullableString(input, "periodStart", "period start"),
    periodEnd: storedNullableString(input, "periodEnd", "period end"),
    allocations: stored.allocations.map((allocation) => {
      const interestAmount = amounts.get(allocation.sequence);
      if (interestAmount === undefined) {
        throw replayError("interest allocation");
      }
      return {
        id: allocation.id,
        sequence: allocation.sequence,
        interestAmount,
      };
    }),
  };
}

async function replayRepaymentSchedule(
  tx: Prisma.TransactionClient,
  repaymentScheduleId: string,
): Promise<PersistedRepaymentSchedule> {
  const stored = await tx.repaymentSchedule.findUnique({
    where: { id: repaymentScheduleId },
    include: { entries: { orderBy: { sequence: "asc" } } },
  });
  if (!stored) {
    throw replayError("repayment schedule");
  }
  const result = storedRecord(stored.resultSnapshot, "schedule result snapshot");
  const resultEntries = result.entries;
  if (!Array.isArray(resultEntries)) {
    throw replayError("schedule entries");
  }
  const entriesBySequence = new Map<number, Record<string, unknown>>();
  for (const entry of resultEntries) {
    const row = storedRecord(entry, "schedule entry");
    entriesBySequence.set(storedInteger(row.sequence, "schedule entry sequence"), row);
  }
  if (entriesBySequence.size !== stored.entries.length || entriesBySequence.size !== resultEntries.length) {
    throw replayError("schedule entries");
  }
  return {
    id: stored.id,
    loanFacilityId: stored.loanFacilityId,
    productVersionId: stored.productVersionId,
    historySequence: stored.historySequence,
    interestCalculationId: stored.interestCalculationId,
    principalAmount: storedString(result, "principalAmount", "principal amount"),
    totalScheduledPrincipal: storedString(result, "totalScheduledPrincipal", "scheduled principal"),
    totalScheduledInterest: storedString(result, "totalScheduledInterest", "scheduled interest"),
    totalScheduledAmount: storedString(result, "totalScheduledAmount", "scheduled amount"),
    remainingPrincipal: storedString(result, "remainingPrincipal", "remaining principal"),
    numberOfInstalments: storedInteger(result.numberOfInstalments, "number of instalments"),
    entries: stored.entries.map((entry) => {
      const row = entriesBySequence.get(entry.sequence);
      if (!row) {
        throw replayError("schedule entry");
      }
      return {
        id: entry.id,
        sequence: entry.sequence,
        dueDate: storedString(row, "dueDate", "due date"),
        openingPrincipal: storedString(row, "openingPrincipal", "opening principal"),
        scheduledPrincipal: storedString(row, "scheduledPrincipal", "scheduled principal"),
        scheduledInterest: storedString(row, "scheduledInterest", "scheduled interest"),
        totalScheduledAmount: storedString(row, "totalScheduledAmount", "scheduled amount"),
        closingPrincipal: storedString(row, "closingPrincipal", "closing principal"),
      };
    }),
  };
}

export async function persistInterestCalculationSnapshot(
  input: unknown,
  idempotencyKey: string,
): Promise<PersistedInterestCalculation> {
  const payload = requirePayload(input, "interestCalculation");
  requireIdentifier(payload.loanFacilityId, "loanFacilityId");
  const key = requireIdempotencyKey(idempotencyKey);
  const requestFingerprint = fingerprintPayload(payload);

  return prisma.$transaction(async (tx) => {
    const facility = await lockFacility(tx, payload.loanFacilityId as string);
    const existing = await tx.financialSnapshotRequest.findUnique({
      where: {
        loanFacilityId_snapshotType_idempotencyKey: {
          loanFacilityId: facility.id,
          snapshotType: "INTEREST_CALCULATION",
          idempotencyKey: key,
        },
      },
    });
    if (existing) {
      if (existing.interestCalculationId === null) {
        throw replayError("interest calculation request");
      }
      if (existing.requestFingerprint !== requestFingerprint) {
        throw conflictError();
      }
      return replayInterestCalculation(tx, existing.interestCalculationId);
    }
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
    await tx.financialSnapshotRequest.create({
      data: {
        loanFacilityId: facility.id,
        snapshotType: "INTEREST_CALCULATION",
        idempotencyKey: key,
        requestFingerprint,
        interestCalculationId: stored.id,
      },
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

export async function persistRepaymentScheduleSnapshot(
  input: unknown,
  idempotencyKey: string,
): Promise<PersistedRepaymentSchedule> {
  const payload = requirePayload(input, "repaymentSchedule");
  requireIdentifier(payload.loanFacilityId, "loanFacilityId");
  const key = requireIdempotencyKey(idempotencyKey);
  const requestFingerprint = fingerprintPayload(payload);

  return prisma.$transaction(async (tx) => {
    const facility = await lockFacility(tx, payload.loanFacilityId as string);
    const existing = await tx.financialSnapshotRequest.findUnique({
      where: {
        loanFacilityId_snapshotType_idempotencyKey: {
          loanFacilityId: facility.id,
          snapshotType: "REPAYMENT_SCHEDULE",
          idempotencyKey: key,
        },
      },
    });
    if (existing) {
      if (existing.repaymentScheduleId === null) {
        throw replayError("repayment schedule request");
      }
      if (existing.requestFingerprint !== requestFingerprint) {
        throw conflictError();
      }
      return replayRepaymentSchedule(tx, existing.repaymentScheduleId);
    }
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
    await tx.financialSnapshotRequest.create({
      data: {
        loanFacilityId: facility.id,
        snapshotType: "REPAYMENT_SCHEDULE",
        idempotencyKey: key,
        requestFingerprint,
        repaymentScheduleId: stored.id,
      },
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
