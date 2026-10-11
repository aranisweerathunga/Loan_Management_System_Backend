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

async function destroyGraph(ids: GraphIds): Promise<void> {
  if (ids.facilityId) {
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

before(async () => {
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
      const first = await persistInterestCalculationSnapshot(calculationPayload(graph, "1000000.00"));
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

      const second = await persistInterestCalculationSnapshot(calculationPayload(graph, "250000.00"));
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
      const calculation = await persistInterestCalculationSnapshot(calculationPayload(graph, "100.00"));
      const full = await persistRepaymentScheduleSnapshot(
        schedulePayload(graph, fullSchedule, calculation.id),
      );
      assert.equal(full.historySequence, 1);
      assert.equal(calculation.historySequence, 1);
      assert.equal(full.remainingPrincipal, "0.00");
      assert.equal(full.interestCalculationId, calculation.id);

      const partial = await persistRepaymentScheduleSnapshot(schedulePayload(graph, partialSchedule));
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
        () => persistInterestCalculationSnapshot(payload),
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
        () => persistInterestCalculationSnapshot(payload),
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
        () => persistInterestCalculationSnapshot({ ...payload, historySequence: 1 }),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /historySequence is allocated by the snapshot writer/);
          return true;
        },
      );

      const foreignCalculation = await persistInterestCalculationSnapshot(calculationPayload(other, "100.00"));
      const before = await prisma.interestCalculation.findUniqueOrThrow({ where: { id: foreignCalculation.id } });
      await assert.rejects(
        () =>
          persistRepaymentScheduleSnapshot(
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
      () => persistInterestCalculationSnapshot({ loanFacilityId: missingId, productVersionId: randomUUID() }),
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
        () => persistInterestCalculationSnapshot(null),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /must be an object/);
          return true;
        },
      );
      await assert.rejects(
        () => persistRepaymentScheduleSnapshot({ loanFacilityId: " ", productVersionId: graph.versionId }),
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
        () => persistInterestCalculationSnapshot(calculation),
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
        () => persistInterestCalculationSnapshot(unexpected),
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
        () => persistRepaymentScheduleSnapshot(substituted),
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
        () => persistRepaymentScheduleSnapshot(incomplete),
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
      const original = await persistInterestCalculationSnapshot(calculationPayload(graph, "1000000.00"));
      const invalid = calculationPayload(graph, "1000000.00");
      invalid.allocations = invalid.allocations.map((allocation, index) =>
        index === 0 ? { ...allocation, interestAmount: "0.00" } : allocation,
      );
      await assert.rejects(
        () => persistInterestCalculationSnapshot(invalid),
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
        persistInterestCalculationSnapshot(calculationPayload(calculations, "1000000.00")),
        persistInterestCalculationSnapshot(calculationPayload(calculations, "250000.00")),
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
        persistRepaymentScheduleSnapshot(schedulePayload(schedules, fullSchedule)),
        persistRepaymentScheduleSnapshot(schedulePayload(schedules, partialSchedule)),
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
});
