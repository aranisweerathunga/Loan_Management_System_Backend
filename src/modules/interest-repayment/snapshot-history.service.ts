import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { Decimal, formatMoney } from "../../shared/money/decimal.js";
import {
  encodeSnapshotHistoryCursor,
  interestCalculationIdSchema,
  repaymentScheduleIdSchema,
  snapshotFacilityIdSchema,
  snapshotHistoryQuerySchema,
  type SnapshotHistoryQuery,
  type SnapshotHistoryType,
} from "./snapshot-history.schemas.js";

/**
 * Internal read-only access to persisted financial snapshot history.
 *
 * These functions are not mounted on HTTP until authentication exists.
 * Every lookup is scoped to one facility. That prevents cross-facility
 * disclosure. It is not user authorization.
 *
 * A list cursor is valid only for the facility and history type that issued it.
 *
 * historySequence is append order. The highest value is not an active,
 * approved, or authoritative snapshot. Stored JSON is returned unchanged.
 * Interest and repayment amounts are not recalculated.
 */

const ANNUAL_RATE_DECIMAL_PLACES = 4;

const historyOrder = [{ historySequence: "asc" as const }, { id: "asc" as const }];

type StoredDecimal = { toString(): string };

type CalculationHeaderRow = {
  id: string;
  loanFacilityId: string;
  productVersionId: string;
  historySequence: number;
  calculationStrategy: string;
  principalAmount: StoredDecimal;
  annualRate: StoredDecimal;
  annualInterestAmount: StoredDecimal;
  allocationFrequency: string;
  recalculationFrequency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
};

type AllocationRow = {
  id: string;
  sequence: number;
  interestAmount: StoredDecimal;
  createdAt: Date;
};

type ScheduleHeaderRow = {
  id: string;
  loanFacilityId: string;
  productVersionId: string;
  historySequence: number;
  interestCalculationId: string | null;
  principalAmount: StoredDecimal;
  totalScheduledPrincipal: StoredDecimal;
  totalScheduledInterest: StoredDecimal;
  totalScheduledAmount: StoredDecimal;
  remainingPrincipal: StoredDecimal;
  numberOfInstalments: number;
  createdAt: Date;
};

type ScheduleEntryRow = {
  id: string;
  sequence: number;
  dueDate: Date;
  openingPrincipal: StoredDecimal;
  scheduledPrincipal: StoredDecimal;
  scheduledInterest: StoredDecimal;
  totalScheduledAmount: StoredDecimal;
  closingPrincipal: StoredDecimal;
  createdAt: Date;
};

export type InterestAllocationHistoryItem = {
  id: string;
  sequence: number;
  interestAmount: string;
  createdAt: Date;
};

export type InterestCalculationHistoryItem = {
  id: string;
  loanFacilityId: string;
  productVersionId: string;
  historySequence: number;
  calculationStrategy: string;
  principalAmount: string;
  annualRate: string;
  annualInterestAmount: string;
  allocationFrequency: string;
  recalculationFrequency: string;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: Date;
};

export type InterestCalculationHistoryDetail = InterestCalculationHistoryItem & {
  inputSnapshot: Prisma.JsonValue;
  policySnapshot: Prisma.JsonValue;
  resultSnapshot: Prisma.JsonValue;
  allocations: InterestAllocationHistoryItem[];
};

export type RepaymentScheduleEntryHistoryItem = {
  id: string;
  sequence: number;
  dueDate: string;
  openingPrincipal: string;
  scheduledPrincipal: string;
  scheduledInterest: string;
  totalScheduledAmount: string;
  closingPrincipal: string;
  createdAt: Date;
};

export type RepaymentScheduleHistoryItem = {
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
  createdAt: Date;
};

export type RepaymentScheduleHistoryDetail = RepaymentScheduleHistoryItem & {
  inputSnapshot: Prisma.JsonValue;
  policySnapshot: Prisma.JsonValue;
  resultSnapshot: Prisma.JsonValue;
  entries: RepaymentScheduleEntryHistoryItem[];
};

export type SnapshotHistoryPage<T> = {
  items: T[];
  page: {
    nextCursor: string | null;
  };
};

function validationError(message: string): AppError {
  return new AppError(400, message, "VALIDATION_ERROR");
}

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function requireUuid(value: string, schema: { safeParse(data: unknown): { success: boolean } }, field: string): string {
  if (!schema.safeParse(value).success) {
    throw validationError(`${field} must be a UUID`);
  }
  return value;
}

function parseQuery(
  query: unknown,
  facilityId: string,
  historyType: SnapshotHistoryType,
): SnapshotHistoryQuery {
  const parsed = snapshotHistoryQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw validationError(formatIssues(parsed.error));
  }

  const cursor = parsed.data.cursor;
  if (cursor === null) {
    return parsed.data;
  }

  const mismatches: string[] = [];
  if (cursor.facilityId !== facilityId.toLowerCase()) {
    mismatches.push("cursor: does not belong to this facility");
  }
  if (cursor.historyType !== historyType) {
    mismatches.push("cursor: does not belong to this history");
  }
  if (mismatches.length > 0) {
    throw validationError(mismatches.join("; "));
  }

  return parsed.data;
}

function formatStoredMoney(value: StoredDecimal): string {
  return formatMoney(new Decimal(value.toString()));
}

function formatStoredAnnualRate(value: StoredDecimal): string {
  return new Decimal(value.toString()).toFixed(ANNUAL_RATE_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
}

function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function historyFilter(facilityId: string, cursor: SnapshotHistoryQuery["cursor"]) {
  if (cursor === null) {
    return { loanFacilityId: facilityId };
  }

  return {
    loanFacilityId: facilityId,
    OR: [
      { historySequence: { gt: cursor.historySequence } },
      { historySequence: cursor.historySequence, id: { gt: cursor.id } },
    ],
  };
}

function takePage<T extends { historySequence: number; id: string }>(
  rows: T[],
  limit: number,
  scope: { facilityId: string; historyType: SnapshotHistoryType },
): { rows: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  if (!hasMore || last === undefined) {
    return { rows: pageRows, nextCursor: null };
  }

  const nextCursor = encodeSnapshotHistoryCursor({
    version: 1,
    historyType: scope.historyType,
    facilityId: scope.facilityId,
    historySequence: last.historySequence,
    id: last.id,
  });
  if (nextCursor === undefined) {
    throw new AppError(500, "Stored snapshot history cannot be paged", "INTERNAL_SERVER_ERROR");
  }

  return { rows: pageRows, nextCursor };
}

async function requireFacility(facilityId: string): Promise<void> {
  const facility = await prisma.loanFacility.findUnique({
    where: { id: facilityId },
    select: { id: true },
  });
  if (!facility) {
    throw new AppError(404, "Loan facility not found", "NOT_FOUND");
  }
}

function serializeCalculation(row: CalculationHeaderRow): InterestCalculationHistoryItem {
  return {
    id: row.id,
    loanFacilityId: row.loanFacilityId,
    productVersionId: row.productVersionId,
    historySequence: row.historySequence,
    calculationStrategy: row.calculationStrategy,
    principalAmount: formatStoredMoney(row.principalAmount),
    annualRate: formatStoredAnnualRate(row.annualRate),
    annualInterestAmount: formatStoredMoney(row.annualInterestAmount),
    allocationFrequency: row.allocationFrequency,
    recalculationFrequency: row.recalculationFrequency,
    periodStart: row.periodStart === null ? null : toDateOnlyString(row.periodStart),
    periodEnd: row.periodEnd === null ? null : toDateOnlyString(row.periodEnd),
    createdAt: row.createdAt,
  };
}

function serializeAllocation(row: AllocationRow): InterestAllocationHistoryItem {
  return {
    id: row.id,
    sequence: row.sequence,
    interestAmount: formatStoredMoney(row.interestAmount),
    createdAt: row.createdAt,
  };
}

function serializeSchedule(row: ScheduleHeaderRow): RepaymentScheduleHistoryItem {
  return {
    id: row.id,
    loanFacilityId: row.loanFacilityId,
    productVersionId: row.productVersionId,
    historySequence: row.historySequence,
    interestCalculationId: row.interestCalculationId,
    principalAmount: formatStoredMoney(row.principalAmount),
    totalScheduledPrincipal: formatStoredMoney(row.totalScheduledPrincipal),
    totalScheduledInterest: formatStoredMoney(row.totalScheduledInterest),
    totalScheduledAmount: formatStoredMoney(row.totalScheduledAmount),
    remainingPrincipal: formatStoredMoney(row.remainingPrincipal),
    numberOfInstalments: row.numberOfInstalments,
    createdAt: row.createdAt,
  };
}

function serializeEntry(row: ScheduleEntryRow): RepaymentScheduleEntryHistoryItem {
  return {
    id: row.id,
    sequence: row.sequence,
    dueDate: toDateOnlyString(row.dueDate),
    openingPrincipal: formatStoredMoney(row.openingPrincipal),
    scheduledPrincipal: formatStoredMoney(row.scheduledPrincipal),
    scheduledInterest: formatStoredMoney(row.scheduledInterest),
    totalScheduledAmount: formatStoredMoney(row.totalScheduledAmount),
    closingPrincipal: formatStoredMoney(row.closingPrincipal),
    createdAt: row.createdAt,
  };
}

export async function listInterestCalculations(
  facilityId: string,
  query: unknown = {},
): Promise<SnapshotHistoryPage<InterestCalculationHistoryItem>> {
  const id = requireUuid(facilityId, snapshotFacilityIdSchema, "facilityId");
  const historyType = "interest-calculation" satisfies SnapshotHistoryType;
  const parsed = parseQuery(query, id, historyType);
  await requireFacility(id);

  const rows = await prisma.interestCalculation.findMany({
    where: historyFilter(id, parsed.cursor),
    orderBy: historyOrder,
    take: parsed.limit + 1,
    select: {
      id: true,
      loanFacilityId: true,
      productVersionId: true,
      historySequence: true,
      calculationStrategy: true,
      principalAmount: true,
      annualRate: true,
      annualInterestAmount: true,
      allocationFrequency: true,
      recalculationFrequency: true,
      periodStart: true,
      periodEnd: true,
      createdAt: true,
    },
  });

  const page = takePage(rows, parsed.limit, { facilityId: id, historyType });
  return {
    items: page.rows.map(serializeCalculation),
    page: { nextCursor: page.nextCursor },
  };
}

export async function getInterestCalculation(
  facilityId: string,
  calculationId: string,
): Promise<InterestCalculationHistoryDetail> {
  const id = requireUuid(facilityId, snapshotFacilityIdSchema, "facilityId");
  const childId = requireUuid(calculationId, interestCalculationIdSchema, "calculationId");
  await requireFacility(id);

  const calculation = await prisma.interestCalculation.findFirst({
    where: { id: childId, loanFacilityId: id },
    include: {
      allocations: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          interestAmount: true,
          createdAt: true,
        },
      },
    },
  });
  if (!calculation) {
    throw new AppError(404, "Interest calculation not found", "NOT_FOUND");
  }

  return {
    ...serializeCalculation(calculation),
    inputSnapshot: calculation.inputSnapshot,
    policySnapshot: calculation.policySnapshot,
    resultSnapshot: calculation.resultSnapshot,
    allocations: calculation.allocations.map(serializeAllocation),
  };
}

export async function listRepaymentSchedules(
  facilityId: string,
  query: unknown = {},
): Promise<SnapshotHistoryPage<RepaymentScheduleHistoryItem>> {
  const id = requireUuid(facilityId, snapshotFacilityIdSchema, "facilityId");
  const historyType = "repayment-schedule" satisfies SnapshotHistoryType;
  const parsed = parseQuery(query, id, historyType);
  await requireFacility(id);

  const rows = await prisma.repaymentSchedule.findMany({
    where: historyFilter(id, parsed.cursor),
    orderBy: historyOrder,
    take: parsed.limit + 1,
    select: {
      id: true,
      loanFacilityId: true,
      productVersionId: true,
      historySequence: true,
      interestCalculationId: true,
      principalAmount: true,
      totalScheduledPrincipal: true,
      totalScheduledInterest: true,
      totalScheduledAmount: true,
      remainingPrincipal: true,
      numberOfInstalments: true,
      createdAt: true,
    },
  });

  const page = takePage(rows, parsed.limit, { facilityId: id, historyType });
  return {
    items: page.rows.map(serializeSchedule),
    page: { nextCursor: page.nextCursor },
  };
}

export async function getRepaymentSchedule(
  facilityId: string,
  scheduleId: string,
): Promise<RepaymentScheduleHistoryDetail> {
  const id = requireUuid(facilityId, snapshotFacilityIdSchema, "facilityId");
  const childId = requireUuid(scheduleId, repaymentScheduleIdSchema, "scheduleId");
  await requireFacility(id);

  const schedule = await prisma.repaymentSchedule.findFirst({
    where: { id: childId, loanFacilityId: id },
    include: {
      entries: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          dueDate: true,
          openingPrincipal: true,
          scheduledPrincipal: true,
          scheduledInterest: true,
          totalScheduledAmount: true,
          closingPrincipal: true,
          createdAt: true,
        },
      },
    },
  });
  if (!schedule) {
    throw new AppError(404, "Repayment schedule not found", "NOT_FOUND");
  }

  return {
    ...serializeSchedule(schedule),
    inputSnapshot: schedule.inputSnapshot,
    policySnapshot: schedule.policySnapshot,
    resultSnapshot: schedule.resultSnapshot,
    entries: schedule.entries.map(serializeEntry),
  };
}
