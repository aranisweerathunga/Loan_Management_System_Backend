import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Prisma } from "../src/generated/prisma/client.js";
import { calculateInterest } from "../src/modules/interest-repayment/interest-engine.js";
import { assembleRepaymentSchedule } from "../src/modules/interest-repayment/repayment-schedule-engine.js";
import {
  persistInterestCalculationSnapshot,
  persistRepaymentScheduleSnapshot,
} from "../src/modules/interest-repayment/snapshot-writer.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { disconnectDatabase, prisma } from "../src/shared/database/prisma.js";

type GraphIds = {
  categoryId?: string;
  productId?: string;
  versionId?: string;
  borrowerId?: string;
  applicationId?: string;
  facilityId?: string;
};

type SequenceRow = { calendarYear: number; lastValue: number };

const interestPolicy = {
  annualRate: "10.0000",
  calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
  allocationFrequency: "MONTHLY",
  recalculationFrequency: "ANNUAL",
  balanceChangeTreatment: "SUPPLEMENTARY_CALCULATION",
};

const repaymentPolicy = {
  paymentAllocationPriority: ["INTEREST", "PRINCIPAL"],
};

let facilitySequencesBefore: SequenceRow[] = [];
let applicationSequencesBefore: SequenceRow[] = [];

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function money(value: Prisma.Decimal | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

async function readSequences(): Promise<{ facilities: SequenceRow[]; applications: SequenceRow[] }> {
  const facilities = await prisma.loanFacilityNumberSequence.findMany({
    orderBy: { calendarYear: "asc" },
    select: { calendarYear: true, lastValue: true },
  });
  const applications = await prisma.loanApplicationNumberSequence.findMany({
    orderBy: { calendarYear: "asc" },
    select: { calendarYear: true, lastValue: true },
  });
  return { facilities, applications };
}

function persistCalculation(input: unknown) {
  return persistInterestCalculationSnapshot(input, randomUUID());
}

function persistSchedule(input: unknown) {
  return persistRepaymentScheduleSnapshot(input, randomUUID());
}

async function destroyGraph(ids: GraphIds): Promise<void> {
  if (ids.facilityId) {
    await prisma.financialSnapshotRequest.deleteMany({ where: { loanFacilityId: ids.facilityId } });
    await prisma.repaymentScheduleEntry.deleteMany({
      where: { repaymentSchedule: { loanFacilityId: ids.facilityId } },
    });
    await prisma.repaymentSchedule.deleteMany({ where: { loanFacilityId: ids.facilityId } });
    await prisma.interestAllocation.deleteMany({
      where: { interestCalculation: { loanFacilityId: ids.facilityId } },
    });
    await prisma.interestCalculation.deleteMany({ where: { loanFacilityId: ids.facilityId } });
    await prisma.loanFacility.delete({ where: { id: ids.facilityId } });
  }
  if (ids.applicationId) {
    await prisma.loanApplication.delete({ where: { id: ids.applicationId } });
  }
  if (ids.versionId) {
    await prisma.productVersion.delete({ where: { id: ids.versionId } });
  }
  if (ids.productId) {
    await prisma.loanProduct.delete({ where: { id: ids.productId } });
  }
  if (ids.categoryId) {
    await prisma.productCategory.delete({ where: { id: ids.categoryId } });
  }
  if (ids.borrowerId) {
    await prisma.borrower.delete({ where: { id: ids.borrowerId } });
  }
}

async function createGraph(): Promise<Required<GraphIds>> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const ids: GraphIds = {};
  try {
    ids.categoryId = (
      await prisma.productCategory.create({
        data: { code: `P8W${suffix}`.slice(0, 32), name: "Phase 8C writer" },
      })
    ).id;
    ids.productId = (
      await prisma.loanProduct.create({
        data: {
          categoryId: ids.categoryId,
          code: `P8Q${suffix}`.slice(0, 32),
          name: "Phase 8C writer product",
        },
      })
    ).id;
    ids.versionId = (
      await prisma.productVersion.create({
        data: {
          loanProductId: ids.productId,
          versionNumber: 1,
          effectiveFrom: utcDate("2026-01-01"),
          configuration: { interestPolicy, repaymentPolicy },
        },
      })
    ).id;
    ids.borrowerId = (
      await prisma.borrower.create({
        data: { firstName: "Phase", lastName: "Writer" },
      })
    ).id;
    ids.applicationId = (
      await prisma.loanApplication.create({
        data: {
          applicationNumber: `P8C-WRT-${suffix}`,
          borrowerId: ids.borrowerId,
          loanProductId: ids.productId,
          productVersionId: ids.versionId,
        },
      })
    ).id;
    ids.facilityId = (
      await prisma.loanFacility.create({
        data: {
          facilityNumber: `P8C-FAC-${suffix}`,
          loanApplicationId: ids.applicationId,
          borrowerId: ids.borrowerId,
          loanProductId: ids.productId,
          productVersionId: ids.versionId,
          authorizedPrincipalAmount: "1000000.00",
          currencyCode: "LKR",
          facilityDate: utcDate("2026-01-01"),
        },
      })
    ).id;
    return ids as Required<GraphIds>;
  } catch (error) {
    await destroyGraph(ids);
    throw error;
  }
}

function calculationPayload(graph: Required<GraphIds>, principalAmount: string) {
  const result = calculateInterest({
    calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
    principalAmount,
    annualRate: interestPolicy.annualRate,
    allocationFrequency: "MONTHLY",
    recalculationFrequency: "ANNUAL",
  });
  return {
    loanFacilityId: graph.facilityId,
    productVersionId: graph.versionId,
    calculationStrategy: result.calculationStrategy,
    principalAmount: result.principalAmount,
    annualRate: result.annualRate,
    annualInterestAmount: result.annualInterestAmount,
    allocationFrequency: result.allocationFrequency,
    recalculationFrequency: result.recalculationFrequency,
    periodStart: null,
    periodEnd: null,
    allocations: result.allocations,
    inputSnapshot: {
      principalAmount: result.principalAmount,
      annualRate: result.annualRate,
      calculationStrategy: result.calculationStrategy,
      allocationFrequency: result.allocationFrequency,
      recalculationFrequency: result.recalculationFrequency,
      periodStart: null,
      periodEnd: null,
    },
    policySnapshot: { interestPolicy },
    resultSnapshot: result,
  };
}

function schedulePayload(
  graph: Required<GraphIds>,
  assembledInput: {
    principalAmount: string;
    dueDates: string[];
    principalAllocations: string[];
    interestAllocations: string[];
  },
  interestCalculationId?: string,
) {
  const result = assembleRepaymentSchedule(assembledInput);
  return {
    loanFacilityId: graph.facilityId,
    productVersionId: graph.versionId,
    ...(interestCalculationId ? { interestCalculationId } : {}),
    principalAmount: result.principalAmount,
    totalScheduledPrincipal: result.totalScheduledPrincipal,
    totalScheduledInterest: result.totalScheduledInterest,
    totalScheduledAmount: result.totalScheduledAmount,
    remainingPrincipal: result.remainingPrincipal,
    numberOfInstalments: result.numberOfInstalments,
    entries: result.entries,
    inputSnapshot: assembledInput,
    policySnapshot: { interestPolicy, repaymentPolicy },
    resultSnapshot: result,
  };
}

const fullSchedule = {
  principalAmount: "100.00",
  dueDates: ["2026-01-15", "2026-02-15"],
  principalAllocations: ["40.00", "60.00"],
  interestAllocations: ["1.00", "2.00"],
};

const partialSchedule = {
  principalAmount: "1000000.00",
  dueDates: ["2026-03-15", "2026-04-15", "2026-05-15"],
  principalAllocations: ["20000.00", "20000.00", "20000.00"],
  interestAllocations: ["0.00", "0.00", "0.00"],
};

function calculationWithPeriod(graph: Required<GraphIds>, principalAmount: string, periodStart: string, periodEnd: string) {
  const payload = calculationPayload(graph, principalAmount);
  return {
    ...payload,
    periodStart,
    periodEnd,
    inputSnapshot: {
      ...payload.inputSnapshot,
      periodStart,
      periodEnd,
    },
  };
}

function isConflict(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === 409 && error.code === "CONFLICT";
}

before(async () => {
  const databases = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(databases[0]?.name, "loan_management_db");
  const sequences = await readSequences();
  facilitySequencesBefore = sequences.facilities;
  applicationSequencesBefore = sequences.applications;
});

after(async () => {
  const sequences = await readSequences();
  assert.deepEqual(sequences.facilities, facilitySequencesBefore);
  assert.deepEqual(sequences.applications, applicationSequencesBefore);
  await disconnectDatabase();
});

describe("internal financial snapshot writer", () => {
  it("persists a validated interest snapshot and allocates the next calculation sequence", async () => {
    const graph = await createGraph();
    const transactionsBefore = await prisma.loanTransaction.count();
    try {
      const first = await persistCalculation(calculationPayload(graph, "1000000.00"));
      assert.equal(first.historySequence, 1);
      assert.equal(first.annualInterestAmount, "100000.00");
      assert.equal(first.allocations[0]?.interestAmount, "8333.34");
      assert.equal(first.allocations.length, 12);

      const stored = await prisma.interestCalculation.findUniqueOrThrow({
        where: { id: first.id },
        include: { allocations: { orderBy: { sequence: "asc" } } },
      });
      assert.equal(money(stored.principalAmount), "1000000.00");
      assert.equal(stored.productVersionId, graph.versionId);
      assert.equal(money(stored.allocations[0]?.interestAmount ?? "0"), "8333.34");

      const second = await persistCalculation(calculationPayload(graph, "250000.00"));
      assert.equal(second.historySequence, 2);
      const original = await prisma.interestCalculation.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(original.historySequence, 1);
      assert.equal(money(original.principalAmount), "1000000.00");
      assert.equal(await prisma.loanTransaction.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(await prisma.loanTransaction.count(), transactionsBefore);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("persists a full schedule and a partial schedule on an independent sequence", async () => {
    const graph = await createGraph();
    try {
      const calculation = await persistCalculation(calculationPayload(graph, "100.00"));
      const full = await persistSchedule(
        schedulePayload(graph, fullSchedule, calculation.id),
      );
      assert.equal(full.historySequence, 1);
      assert.equal(calculation.historySequence, 1);
      assert.equal(full.remainingPrincipal, "0.00");
      assert.equal(full.interestCalculationId, calculation.id);

      const partial = await persistSchedule(schedulePayload(graph, partialSchedule));
      assert.equal(partial.historySequence, 2);
      assert.equal(partial.remainingPrincipal, "940000.00");
      assert.equal(partial.interestCalculationId, null);
      const stored = await prisma.repaymentSchedule.findUniqueOrThrow({
        where: { id: partial.id },
        include: { entries: { orderBy: { sequence: "asc" } } },
      });
      assert.equal(money(stored.entries[2]?.closingPrincipal ?? "0"), "940000.00");
    } finally {
      await destroyGraph(graph);
    }
  });

  it("rejects a schema-valid policy that differs from the bound ProductVersion", async () => {
    const graph = await createGraph();
    try {
      const payload = calculationPayload(graph, "1000000.00");
      payload.policySnapshot = {
        interestPolicy: { ...interestPolicy, annualRate: "12.0000" },
      };
      await assert.rejects(
        () => persistCalculation(payload),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "CONFLICT");
          assert.match(error.message, /does not match the bound ProductVersion/);
          return true;
        },
      );
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 0);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("rejects a ProductVersion that is not bound to the locked facility", async () => {
    const graph = await createGraph();
    let otherVersionId: string | undefined;
    try {
      otherVersionId = (
        await prisma.productVersion.create({
          data: {
            loanProductId: graph.productId,
            versionNumber: 2,
            effectiveFrom: utcDate("2026-02-01"),
            configuration: { interestPolicy, repaymentPolicy },
          },
        })
      ).id;
      const payload = calculationPayload(graph, "1000000.00");
      payload.productVersionId = otherVersionId;
      await assert.rejects(
        () => persistCalculation(payload),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "CONFLICT");
          assert.match(error.message, /bound ProductVersion/);
          return true;
        },
      );
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 0);
    } finally {
      if (otherVersionId) {
        await prisma.productVersion.delete({ where: { id: otherVersionId } });
      }
      await destroyGraph(graph);
    }
  });

  it("rejects a caller-selected history sequence and a cross-facility calculation link without leaving rows", async () => {
    const graph = await createGraph();
    const other = await createGraph();
    try {
      const payload = calculationPayload(graph, "1000000.00");
      await assert.rejects(
        () => persistCalculation({ ...payload, historySequence: 1 }),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /historySequence is allocated by the snapshot writer/);
          return true;
        },
      );

      const foreignCalculation = await persistCalculation(calculationPayload(other, "100.00"));
      const before = await prisma.interestCalculation.findUniqueOrThrow({ where: { id: foreignCalculation.id } });
      await assert.rejects(
        () =>
          persistSchedule(
            schedulePayload(graph, fullSchedule, foreignCalculation.id),
          ),
        (error: unknown) => {
          assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
          assert.equal(error.code, "P2003");
          return true;
        },
      );
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      const afterFailure = await prisma.interestCalculation.findUniqueOrThrow({
        where: { id: foreignCalculation.id },
      });
      assert.equal(afterFailure.historySequence, before.historySequence);
      assert.equal(money(afterFailure.principalAmount), money(before.principalAmount));
    } finally {
      await destroyGraph(graph);
      await destroyGraph(other);
    }
  });

  it("rejects a missing facility and malformed payloads without inserting a snapshot", async () => {
    const missingId = randomUUID();
    await assert.rejects(
      () => persistCalculation({ loanFacilityId: missingId, productVersionId: randomUUID() }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.code, "NOT_FOUND");
        return true;
      },
    );
    assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: missingId } }), 0);

    const graph = await createGraph();
    try {
      await assert.rejects(
        () => persistCalculation(null),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /must be an object/);
          return true;
        },
      );
      await assert.rejects(
        () => persistSchedule({ loanFacilityId: " ", productVersionId: graph.versionId }),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /loanFacilityId must be a non-empty string/);
          return true;
        },
      );
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 0);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("rejects missing, unexpected, and substituted policy sections without inserting rows", async () => {
    const graph = await createGraph();
    try {
      const calculation = calculationPayload(graph, "1000000.00");
      calculation.policySnapshot = { repaymentPolicy };
      await assert.rejects(
        () => persistCalculation(calculation),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.match(error.message, /policySnapshot\.interestPolicy must match the bound ProductVersion/);
          return true;
        },
      );

      const unexpected = calculationPayload(graph, "1000000.00");
      unexpected.policySnapshot = { interestPolicy, paymentVariancePolicy: {} };
      await assert.rejects(
        () => persistCalculation(unexpected),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.match(error.message, /paymentVariancePolicy is not part of the bound ProductVersion policy/);
          return true;
        },
      );

      const substituted = schedulePayload(graph, fullSchedule);
      substituted.policySnapshot = {
        interestPolicy,
        repaymentPolicy: { paymentAllocationPriority: ["PRINCIPAL", "INTEREST"] },
      };
      await assert.rejects(
        () => persistSchedule(substituted),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.match(error.message, /policySnapshot\.repaymentPolicy does not match the bound ProductVersion/);
          return true;
        },
      );

      const incomplete = schedulePayload(graph, fullSchedule);
      incomplete.policySnapshot = { interestPolicy };
      await assert.rejects(
        () => persistSchedule(incomplete),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.match(error.message, /policySnapshot\.repaymentPolicy must match the bound ProductVersion/);
          return true;
        },
      );

      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 0);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("leaves an earlier snapshot unchanged when a later calculation is rejected", async () => {
    const graph = await createGraph();
    try {
      const original = await persistCalculation(calculationPayload(graph, "1000000.00"));
      const invalid = calculationPayload(graph, "1000000.00");
      invalid.allocations = invalid.allocations.map((allocation, index) =>
        index === 0 ? { ...allocation, interestAmount: "0.00" } : allocation,
      );
      await assert.rejects(
        () => persistCalculation(invalid),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /interest allocations must sum exactly to annualInterestAmount/);
          return true;
        },
      );
      const stored = await prisma.interestCalculation.findUniqueOrThrow({
        where: { id: original.id },
        include: { allocations: { orderBy: { sequence: "asc" } } },
      });
      assert.equal(stored.historySequence, 1);
      assert.equal(money(stored.principalAmount), "1000000.00");
      assert.equal(money(stored.allocations[0]?.interestAmount ?? "0"), "8333.34");
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 1);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("allocates distinct calculation and schedule sequences under concurrent writes", async () => {
    const calculations = await createGraph();
    const schedules = await createGraph();
    try {
      const calculationResults = await Promise.all([
        persistCalculation(calculationPayload(calculations, "1000000.00")),
        persistCalculation(calculationPayload(calculations, "250000.00")),
      ]);
      assert.deepEqual(
        calculationResults.map((result) => result.historySequence).sort((left, right) => left - right),
        [1, 2],
      );
      const calculationRows = await prisma.interestCalculation.findMany({
        where: { loanFacilityId: calculations.facilityId },
        orderBy: { historySequence: "asc" },
      });
      assert.deepEqual(
        calculationRows.map((row) => row.historySequence),
        [1, 2],
      );
      assert.deepEqual(
        new Set(calculationRows.map((row) => money(row.principalAmount))),
        new Set(["1000000.00", "250000.00"]),
      );

      const scheduleResults = await Promise.all([
        persistSchedule(schedulePayload(schedules, fullSchedule)),
        persistSchedule(schedulePayload(schedules, partialSchedule)),
      ]);
      assert.deepEqual(
        scheduleResults.map((result) => result.historySequence).sort((left, right) => left - right),
        [1, 2],
      );
      const scheduleRows = await prisma.repaymentSchedule.findMany({
        where: { loanFacilityId: schedules.facilityId },
        orderBy: { historySequence: "asc" },
      });
      assert.deepEqual(
        scheduleRows.map((row) => row.historySequence),
        [1, 2],
      );
      assert.deepEqual(
        new Set(scheduleRows.map((row) => money(row.remainingPrincipal))),
        new Set(["0.00", "940000.00"]),
      );
    } finally {
      await destroyGraph(calculations);
      await destroyGraph(schedules);
    }
  });

  it("replays an identical key and rejects a conflicting payload", async () => {
    const graph = await createGraph();
    const key = randomUUID().toUpperCase();
    try {
      const payload = calculationPayload(graph, "1000000.00");
      const first = await persistInterestCalculationSnapshot(payload, key);
      const replay = await persistInterestCalculationSnapshot(
        { ...payload, policySnapshot: { interestPolicy: { ...interestPolicy } } },
        key.toLowerCase(),
      );
      assert.deepEqual(replay, first);
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 1);
      assert.equal(
        await prisma.financialSnapshotRequest.count({
          where: { loanFacilityId: graph.facilityId, snapshotType: "INTEREST_CALCULATION" },
        }),
        1,
      );

      const scheduleKey = randomUUID();
      const schedule = await persistRepaymentScheduleSnapshot(schedulePayload(graph, fullSchedule, first.id), scheduleKey);
      const scheduleReplay = await persistRepaymentScheduleSnapshot(
        schedulePayload(graph, fullSchedule, first.id),
        scheduleKey,
      );
      assert.deepEqual(scheduleReplay, schedule);
      assert.equal(scheduleReplay.historySequence, 1);

      await assert.rejects(
        () => persistInterestCalculationSnapshot(calculationPayload(graph, "250000.00"), key),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "CONFLICT");
          assert.match(error.message, /different snapshot/);
          return true;
        },
      );
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 1);
      const stored = await prisma.interestCalculation.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(stored.historySequence, 1);
      assert.equal(money(stored.principalAmount), "1000000.00");
    } finally {
      await destroyGraph(graph);
    }
  });

  it("does not consume an idempotency key when validation fails", async () => {
    const graph = await createGraph();
    const key = randomUUID();
    try {
      const invalid = calculationPayload(graph, "1000000.00");
      invalid.allocations = invalid.allocations.map((allocation, index) =>
        index === 0 ? { ...allocation, interestAmount: "0.00" } : allocation,
      );
      await assert.rejects(
        () => persistInterestCalculationSnapshot(invalid, key),
        (error: unknown) => error instanceof AppError && error.statusCode === 400,
      );
      assert.equal(
        await prisma.financialSnapshotRequest.count({ where: { loanFacilityId: graph.facilityId } }),
        0,
      );

      const saved = await persistInterestCalculationSnapshot(calculationPayload(graph, "1000000.00"), key);
      assert.equal(saved.historySequence, 1);
      assert.equal(saved.annualRate, "10.0000");
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 1);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("serializes concurrent identical and conflicting keys", async () => {
    const graph = await createGraph();
    const identicalKey = randomUUID();
    const conflictingKey = randomUUID();
    try {
      const payload = calculationPayload(graph, "1000000.00");
      const identical = await Promise.all([
        persistInterestCalculationSnapshot(payload, identicalKey),
        persistInterestCalculationSnapshot(payload, identicalKey),
      ]);
      assert.deepEqual(identical[0], identical[1]);
      assert.equal(identical[0]?.historySequence, 1);

      const settled = await Promise.allSettled([
        persistInterestCalculationSnapshot(calculationPayload(graph, "1000000.00"), conflictingKey),
        persistInterestCalculationSnapshot(calculationPayload(graph, "250000.00"), conflictingKey),
      ]);
      const fulfilled = settled.filter((result) => result.status === "fulfilled");
      const rejected = settled.filter((result) => result.status === "rejected");
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      const failure = rejected[0];
      assert.ok(failure?.status === "rejected" && failure.reason instanceof AppError);
      assert.equal(failure.reason.statusCode, 409);
      assert.equal(failure.reason.code, "CONFLICT");

      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 2);
      assert.equal(
        await prisma.financialSnapshotRequest.count({ where: { loanFacilityId: graph.facilityId } }),
        2,
      );
    } finally {
      await destroyGraph(graph);
    }
  });

  it("rejects a malformed idempotency key before inserting a snapshot", async () => {
    const graph = await createGraph();
    try {
      await assert.rejects(
        () => persistInterestCalculationSnapshot(calculationPayload(graph, "100.00"), "not-a-uuid"),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /idempotencyKey must be a UUID/);
          return true;
        },
      );
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(
        await prisma.financialSnapshotRequest.count({ where: { loanFacilityId: graph.facilityId } }),
        0,
      );
    } finally {
      await destroyGraph(graph);
    }
  });

  it("creates one snapshot and one request for each snapshot type", async () => {
    const graph = await createGraph();
    const key = randomUUID().toUpperCase();
    try {
      const calculation = await persistInterestCalculationSnapshot(
        calculationWithPeriod(graph, "1000000.00", "2026-01-01", "2026-12-31"),
        key,
      );
      const schedule = await persistRepaymentScheduleSnapshot(
        schedulePayload(graph, fullSchedule, calculation.id),
        key,
      );
      assert.equal(calculation.historySequence, 1);
      assert.equal(schedule.historySequence, 1);
      assert.equal(calculation.periodStart, "2026-01-01");
      assert.equal(calculation.periodEnd, "2026-12-31");
      assert.equal(calculation.annualRate, "10.0000");
      assert.deepEqual(
        calculation.allocations.map((allocation) => allocation.sequence),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      );
      assert.deepEqual(
        schedule.entries.map((entry) => entry.sequence),
        [1, 2],
      );

      const requests = await prisma.financialSnapshotRequest.findMany({
        where: { loanFacilityId: graph.facilityId },
        orderBy: { snapshotType: "asc" },
      });
      assert.equal(requests.length, 2);
      assert.equal(requests[0]?.snapshotType, "INTEREST_CALCULATION");
      assert.equal(requests[0]?.idempotencyKey, key.toLowerCase());
      assert.equal(requests[0]?.interestCalculationId, calculation.id);
      assert.equal(requests[0]?.repaymentScheduleId, null);
      assert.match(requests[0]?.requestFingerprint ?? "", /^[0-9a-f]{64}$/);
      assert.equal(requests[1]?.snapshotType, "REPAYMENT_SCHEDULE");
      assert.equal(requests[1]?.idempotencyKey, key.toLowerCase());
      assert.equal(requests[1]?.repaymentScheduleId, schedule.id);
      assert.equal(requests[1]?.interestCalculationId, null);
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 1);
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 1);
      assert.equal(
        await prisma.interestAllocation.count({
          where: { interestCalculation: { loanFacilityId: graph.facilityId } },
        }),
        12,
      );
      assert.equal(
        await prisma.repaymentScheduleEntry.count({
          where: { repaymentSchedule: { loanFacilityId: graph.facilityId } },
        }),
        2,
      );
    } finally {
      await destroyGraph(graph);
    }
  });

  it("replays the original financial snapshot after the live policy changes", async () => {
    const graph = await createGraph();
    const key = randomUUID();
    try {
      const payload = calculationWithPeriod(graph, "1000000.00", "2026-01-01", "2026-12-31");
      const first = await persistInterestCalculationSnapshot(payload, key);
      const storedBefore = await prisma.interestCalculation.findUniqueOrThrow({ where: { id: first.id } });
      await prisma.productVersion.update({
        where: { id: graph.versionId },
        data: {
          configuration: {
            interestPolicy: { ...interestPolicy, annualRate: "12.0000" },
            repaymentPolicy,
          },
        },
      });

      const replay = await persistInterestCalculationSnapshot(payload, key);
      assert.deepEqual(replay, first);
      assert.equal(replay.annualRate, "10.0000");
      assert.equal(replay.periodStart, "2026-01-01");
      assert.equal(replay.periodEnd, "2026-12-31");
      assert.equal(replay.allocations[0]?.interestAmount, "8333.34");
      const storedAfter = await prisma.interestCalculation.findUniqueOrThrow({ where: { id: first.id } });
      assert.deepEqual(storedAfter.resultSnapshot, storedBefore.resultSnapshot);
      assert.deepEqual(storedAfter.policySnapshot, storedBefore.policySnapshot);
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 1);

      await assert.rejects(
        () => persistInterestCalculationSnapshot(payload, randomUUID()),
        (error: unknown) => isConflict(error),
      );
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 1);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("treats a different key as a new event and a reused schedule key as a conflict", async () => {
    const graph = await createGraph();
    const scheduleKey = randomUUID();
    try {
      const payload = calculationPayload(graph, "1000000.00");
      const first = await persistInterestCalculationSnapshot(payload, randomUUID());
      const second = await persistInterestCalculationSnapshot(payload, randomUUID());
      assert.notEqual(first.id, second.id);
      assert.equal(first.historySequence, 1);
      assert.equal(second.historySequence, 2);
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 2);

      const schedule = await persistRepaymentScheduleSnapshot(schedulePayload(graph, fullSchedule), scheduleKey);
      await assert.rejects(
        () => persistRepaymentScheduleSnapshot(schedulePayload(graph, partialSchedule), scheduleKey),
        (error: unknown) => isConflict(error) && /different snapshot/.test(error.message),
      );
      const stored = await prisma.repaymentSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      assert.equal(stored.historySequence, 1);
      assert.equal(money(stored.remainingPrincipal), "0.00");
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 1);
      assert.equal(
        await prisma.financialSnapshotRequest.count({
          where: { loanFacilityId: graph.facilityId, snapshotType: "REPAYMENT_SCHEDULE" },
        }),
        1,
      );
    } finally {
      await destroyGraph(graph);
    }
  });

  it("keeps the same key independent across facilities", async () => {
    const firstGraph = await createGraph();
    const secondGraph = await createGraph();
    const key = randomUUID();
    try {
      const first = await persistInterestCalculationSnapshot(calculationPayload(firstGraph, "1000000.00"), key);
      const second = await persistInterestCalculationSnapshot(calculationPayload(secondGraph, "1000000.00"), key);
      assert.notEqual(first.id, second.id);
      assert.equal(first.historySequence, 1);
      assert.equal(second.historySequence, 1);
      assert.equal(await prisma.financialSnapshotRequest.count({ where: { idempotencyKey: key } }), 2);
    } finally {
      await destroyGraph(firstGraph);
      await destroyGraph(secondGraph);
    }
  });

  it("rejects a missing idempotency key before persistence", async () => {
    const graph = await createGraph();
    try {
      await assert.rejects(
        () => persistInterestCalculationSnapshot(calculationPayload(graph, "100.00"), undefined as unknown as string),
        (error: unknown) => error instanceof AppError && error.statusCode === 400,
      );
      await assert.rejects(
        () => persistRepaymentScheduleSnapshot(schedulePayload(graph, fullSchedule), ""),
        (error: unknown) => error instanceof AppError && error.statusCode === 400,
      );
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(await prisma.financialSnapshotRequest.count({ where: { loanFacilityId: graph.facilityId } }), 0);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("retries a corrected schedule with the same key after a failed attempt", async () => {
    const graph = await createGraph();
    const key = randomUUID();
    try {
      const invalid = schedulePayload(graph, fullSchedule);
      invalid.entries = invalid.entries.map((entry, index) =>
        index === 0 ? { ...entry, scheduledPrincipal: "0.00" } : entry,
      );
      await assert.rejects(
        () => persistRepaymentScheduleSnapshot(invalid, key),
        (error: unknown) => error instanceof AppError && error.statusCode === 400,
      );
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(
        await prisma.repaymentScheduleEntry.count({
          where: { repaymentSchedule: { loanFacilityId: graph.facilityId } },
        }),
        0,
      );
      assert.equal(await prisma.financialSnapshotRequest.count({ where: { loanFacilityId: graph.facilityId } }), 0);

      const saved = await persistRepaymentScheduleSnapshot(schedulePayload(graph, fullSchedule), key);
      assert.equal(saved.historySequence, 1);
      assert.equal(saved.remainingPrincipal, "0.00");
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 1);
      assert.equal(
        await prisma.repaymentScheduleEntry.count({
          where: { repaymentSchedule: { loanFacilityId: graph.facilityId } },
        }),
        2,
      );
    } finally {
      await destroyGraph(graph);
    }
  });

  it("serializes concurrent schedule writes and mixed snapshot types on one facility", async () => {
    const schedules = await createGraph();
    const mixed = await createGraph();
    const identicalKey = randomUUID();
    const conflictingKey = randomUUID();
    try {
      const identicalPayload = schedulePayload(schedules, fullSchedule);
      const identical = await Promise.all([
        persistRepaymentScheduleSnapshot(identicalPayload, identicalKey),
        persistRepaymentScheduleSnapshot(identicalPayload, identicalKey),
      ]);
      assert.equal(identical[0]?.id, identical[1]?.id);
      assert.deepEqual(identical[0], identical[1]);
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: schedules.facilityId } }), 1);

      const settled = await Promise.allSettled([
        persistRepaymentScheduleSnapshot(schedulePayload(schedules, fullSchedule), conflictingKey),
        persistRepaymentScheduleSnapshot(schedulePayload(schedules, partialSchedule), conflictingKey),
      ]);
      assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
      const rejected = settled.find((result) => result.status === "rejected");
      assert.ok(rejected?.status === "rejected" && isConflict(rejected.reason));
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: schedules.facilityId } }), 2);

      const differentKeys = await Promise.all([
        persistRepaymentScheduleSnapshot(schedulePayload(schedules, fullSchedule), randomUUID()),
        persistRepaymentScheduleSnapshot(schedulePayload(schedules, partialSchedule), randomUUID()),
      ]);
      assert.deepEqual(
        differentKeys.map((result) => result.historySequence).sort((left, right) => left - right),
        [3, 4],
      );

      const [calculation, schedule] = await Promise.all([
        persistInterestCalculationSnapshot(calculationPayload(mixed, "100.00"), randomUUID()),
        persistRepaymentScheduleSnapshot(schedulePayload(mixed, fullSchedule), randomUUID()),
      ]);
      assert.equal(calculation.historySequence, 1);
      assert.equal(schedule.historySequence, 1);
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: mixed.facilityId } }), 1);
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: mixed.facilityId } }), 1);
      assert.equal(await prisma.financialSnapshotRequest.count({ where: { loanFacilityId: mixed.facilityId } }), 2);
    } finally {
      await destroyGraph(schedules);
      await destroyGraph(mixed);
    }
  });

  it("enforces idempotency, target, and history-sequence constraints", async () => {
    const graph = await createGraph();
    const other = await createGraph();
    try {
      const calculation = await persistCalculation(calculationPayload(graph, "100.00"));
      const schedule = await persistSchedule(schedulePayload(graph, fullSchedule, calculation.id));
      const foreign = await persistCalculation(calculationPayload(other, "100.00"));
      const request = await prisma.financialSnapshotRequest.findFirstOrThrow({
        where: { interestCalculationId: calculation.id },
      });

      await assert.rejects(
        () =>
          prisma.financialSnapshotRequest.create({
            data: {
              loanFacilityId: graph.facilityId,
              snapshotType: "INTEREST_CALCULATION",
              idempotencyKey: request.idempotencyKey,
              requestFingerprint: "a".repeat(64),
              interestCalculationId: calculation.id,
            },
          }),
        (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
      );

      await assert.rejects(
        () =>
          prisma.financialSnapshotRequest.create({
            data: {
              loanFacilityId: graph.facilityId,
              snapshotType: "INTEREST_CALCULATION",
              idempotencyKey: randomUUID(),
              requestFingerprint: "ABC".padEnd(64, "a"),
              interestCalculationId: calculation.id,
            },
          }),
        (error: unknown) => error instanceof Error && /requestFingerprint_check/.test(error.message),
      );

      await assert.rejects(
        () =>
          prisma.financialSnapshotRequest.create({
            data: {
              loanFacilityId: graph.facilityId,
              snapshotType: "INTEREST_CALCULATION",
              idempotencyKey: randomUUID(),
              requestFingerprint: "b".repeat(64),
              interestCalculationId: calculation.id,
              repaymentScheduleId: schedule.id,
            },
          }),
        (error: unknown) => error instanceof Error && /snapshot_target_check/.test(error.message),
      );

      await assert.rejects(
        () =>
          prisma.financialSnapshotRequest.create({
            data: {
              loanFacilityId: graph.facilityId,
              snapshotType: "REPAYMENT_SCHEDULE",
              idempotencyKey: randomUUID(),
              requestFingerprint: "c".repeat(64),
              interestCalculationId: calculation.id,
            },
          }),
        (error: unknown) => error instanceof Error && /snapshot_target_check/.test(error.message),
      );

      await assert.rejects(
        () =>
          prisma.financialSnapshotRequest.create({
            data: {
              loanFacilityId: graph.facilityId,
              snapshotType: "INTEREST_CALCULATION",
              idempotencyKey: randomUUID(),
              requestFingerprint: "d".repeat(64),
            },
          }),
        (error: unknown) => error instanceof Error && /snapshot_target_check/.test(error.message),
      );

      await assert.rejects(
        () =>
          prisma.financialSnapshotRequest.create({
            data: {
              loanFacilityId: graph.facilityId,
              snapshotType: "INTEREST_CALCULATION",
              idempotencyKey: randomUUID(),
              requestFingerprint: "e".repeat(64),
              interestCalculationId: foreign.id,
            },
          }),
        (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003",
      );

      const stored = await prisma.interestCalculation.findUniqueOrThrow({ where: { id: calculation.id } });
      await assert.rejects(
        () =>
          prisma.interestCalculation.create({
            data: {
              loanFacilityId: stored.loanFacilityId,
              productVersionId: stored.productVersionId,
              historySequence: stored.historySequence,
              calculationStrategy: stored.calculationStrategy,
              principalAmount: stored.principalAmount,
              annualRate: stored.annualRate,
              annualInterestAmount: stored.annualInterestAmount,
              allocationFrequency: stored.allocationFrequency,
              recalculationFrequency: stored.recalculationFrequency,
              inputSnapshot: stored.inputSnapshot ?? {},
              policySnapshot: stored.policySnapshot ?? {},
              resultSnapshot: stored.resultSnapshot ?? {},
            },
          }),
        (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
      );

      const storedSchedule = await prisma.repaymentSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      await assert.rejects(
        () =>
          prisma.repaymentSchedule.create({
            data: {
              loanFacilityId: storedSchedule.loanFacilityId,
              productVersionId: storedSchedule.productVersionId,
              historySequence: storedSchedule.historySequence,
              principalAmount: storedSchedule.principalAmount,
              totalScheduledPrincipal: storedSchedule.totalScheduledPrincipal,
              totalScheduledInterest: storedSchedule.totalScheduledInterest,
              totalScheduledAmount: storedSchedule.totalScheduledAmount,
              remainingPrincipal: storedSchedule.remainingPrincipal,
              numberOfInstalments: storedSchedule.numberOfInstalments,
              inputSnapshot: storedSchedule.inputSnapshot ?? {},
              policySnapshot: storedSchedule.policySnapshot ?? {},
              resultSnapshot: storedSchedule.resultSnapshot ?? {},
            },
          }),
        (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
      );

      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: graph.facilityId } }), 1);
      assert.equal(await prisma.repaymentSchedule.count({ where: { loanFacilityId: graph.facilityId } }), 1);
      assert.equal(await prisma.financialSnapshotRequest.count({ where: { loanFacilityId: graph.facilityId } }), 2);
      assert.equal(await prisma.interestCalculation.count({ where: { loanFacilityId: other.facilityId } }), 1);
    } finally {
      await destroyGraph(graph);
      await destroyGraph(other);
    }
  });

  it("rejects a product-version mismatch and a facility version change after a snapshot", async () => {
    const graph = await createGraph();
    const suffix = randomUUID().slice(0, 8);
    let sameProductVersionId: string | undefined;
    let otherProductId: string | undefined;
    let otherVersionId: string | undefined;
    try {
      const facility = await prisma.loanFacility.findUniqueOrThrow({ where: { id: graph.facilityId } });
      const application = await prisma.loanApplication.findUniqueOrThrow({ where: { id: graph.applicationId } });
      const version = await prisma.productVersion.findUniqueOrThrow({ where: { id: graph.versionId } });
      assert.equal(facility.productVersionId, version.id);
      assert.equal(facility.loanProductId, version.loanProductId);
      assert.equal(application.productVersionId, version.id);
      assert.equal(application.loanProductId, version.loanProductId);

      otherProductId = (
        await prisma.loanProduct.create({
          data: {
            categoryId: graph.categoryId,
            code: `P8V${suffix}`.slice(0, 32),
            name: "Provenance other product",
          },
        })
      ).id;
      otherVersionId = (
        await prisma.productVersion.create({
          data: {
            loanProductId: otherProductId,
            versionNumber: 1,
            effectiveFrom: utcDate("2026-06-01"),
            configuration: { interestPolicy, repaymentPolicy },
          },
        })
      ).id;

      await assert.rejects(
        () =>
          prisma.$executeRaw`
            UPDATE "LoanFacility"
            SET "productVersionId" = ${otherVersionId}
            WHERE "id" = ${graph.facilityId}
          `,
        (error: unknown) =>
          error instanceof Error && error.message.includes("LoanFacility_productVersionId_loanProductId_fkey"),
      );
      await assert.rejects(
        () =>
          prisma.$executeRaw`
            UPDATE "LoanApplication"
            SET "productVersionId" = ${otherVersionId}
            WHERE "id" = ${graph.applicationId}
          `,
        (error: unknown) =>
          error instanceof Error && error.message.includes("LoanApplication_productVersionId_loanProductId_fkey"),
      );
      assert.equal(
        (await prisma.loanFacility.findUniqueOrThrow({ where: { id: graph.facilityId } })).productVersionId,
        graph.versionId,
      );
      assert.equal(
        (await prisma.loanApplication.findUniqueOrThrow({ where: { id: graph.applicationId } })).productVersionId,
        graph.versionId,
      );

      const calculation = await persistCalculation(calculationPayload(graph, "100.00"));
      sameProductVersionId = (
        await prisma.productVersion.create({
          data: {
            loanProductId: graph.productId,
            versionNumber: 2,
            effectiveFrom: utcDate("2026-07-01"),
            configuration: { interestPolicy, repaymentPolicy },
          },
        })
      ).id;
      await assert.rejects(
        () =>
          prisma.$executeRaw`
            UPDATE "LoanFacility"
            SET "productVersionId" = ${sameProductVersionId}
            WHERE "id" = ${graph.facilityId}
          `,
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("InterestCalculation_loanFacilityId_productVersionId_fkey"),
      );
      assert.equal(
        (await prisma.interestCalculation.findUniqueOrThrow({ where: { id: calculation.id } })).productVersionId,
        graph.versionId,
      );
      assert.equal(
        (await prisma.loanFacility.findUniqueOrThrow({ where: { id: graph.facilityId } })).productVersionId,
        graph.versionId,
      );
    } finally {
      if (sameProductVersionId) {
        await prisma.productVersion.delete({ where: { id: sameProductVersionId } });
      }
      if (otherVersionId) {
        await prisma.productVersion.delete({ where: { id: otherVersionId } });
      }
      if (otherProductId) {
        await prisma.loanProduct.delete({ where: { id: otherProductId } });
      }
      await destroyGraph(graph);
    }
  });

  it("rejects a facility version change after a repayment schedule exists", async () => {
    const graph = await createGraph();
    let replacementVersionId: string | undefined;
    try {
      const schedule = await persistSchedule(schedulePayload(graph, fullSchedule));
      replacementVersionId = (
        await prisma.productVersion.create({
          data: {
            loanProductId: graph.productId,
            versionNumber: 2,
            effectiveFrom: utcDate("2026-08-01"),
            configuration: { interestPolicy, repaymentPolicy },
          },
        })
      ).id;
      await assert.rejects(
        () =>
          prisma.$executeRaw`
            UPDATE "LoanFacility"
            SET "productVersionId" = ${replacementVersionId}
            WHERE "id" = ${graph.facilityId}
          `,
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("RepaymentSchedule_loanFacilityId_productVersionId_fkey"),
      );
      assert.equal(
        (await prisma.repaymentSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).productVersionId,
        graph.versionId,
      );
      assert.equal(
        (await prisma.loanFacility.findUniqueOrThrow({ where: { id: graph.facilityId } })).productVersionId,
        graph.versionId,
      );
    } finally {
      if (replacementVersionId) {
        await prisma.productVersion.delete({ where: { id: replacementVersionId } });
      }
      await destroyGraph(graph);
    }
  });
});
