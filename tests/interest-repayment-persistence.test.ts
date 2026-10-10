import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "../src/generated/prisma/client.js";
import { calculateInterest } from "../src/modules/interest-repayment/interest-engine.js";
import { assembleRepaymentSchedule } from "../src/modules/interest-repayment/repayment-schedule-engine.js";
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

let facilitySequencesBefore: SequenceRow[] = [];
let applicationSequencesBefore: SequenceRow[] = [];

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function money(value: Prisma.Decimal | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

function provenance(graph: Required<GraphIds>, historySequence: number) {
  return {
    loanFacilityId: graph.facilityId,
    productVersionId: graph.versionId,
    historySequence,
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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

async function createGraph(): Promise<Required<GraphIds>> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const ids: GraphIds = {};
  try {
    ids.categoryId = (
      await prisma.productCategory.create({
        data: { code: `P8C${suffix}`.slice(0, 32), name: "Phase 8 persistence" },
      })
    ).id;
    ids.productId = (
      await prisma.loanProduct.create({
        data: {
          categoryId: ids.categoryId,
          code: `P8P${suffix}`.slice(0, 32),
          name: "Phase 8 persistence product",
        },
      })
    ).id;
    ids.versionId = (
      await prisma.productVersion.create({
        data: {
          loanProductId: ids.productId,
          versionNumber: 1,
          effectiveFrom: utcDate("2026-01-01"),
          configuration: {},
        },
      })
    ).id;
    ids.borrowerId = (
      await prisma.borrower.create({
        data: { firstName: "Phase", lastName: "Persistence" },
      })
    ).id;
    ids.applicationId = (
      await prisma.loanApplication.create({
        data: {
          applicationNumber: `P8A-PERS-${suffix}`,
          borrowerId: ids.borrowerId,
          loanProductId: ids.productId,
          productVersionId: ids.versionId,
        },
      })
    ).id;
    ids.facilityId = (
      await prisma.loanFacility.create({
        data: {
          facilityNumber: `P8F-PERS-${suffix}`,
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

describe("interest and repayment persistence", () => {
  it("leaves existing facilities, applications, and the disbursement ledger readable", async () => {
    const [facilities, applications, transactions, disbursements] = await Promise.all([
      prisma.loanFacility.findMany({ select: { id: true }, take: 5 }),
      prisma.loanApplication.findMany({ select: { id: true }, take: 5 }),
      prisma.loanTransaction.findMany({ select: { id: true, type: true }, take: 5 }),
      prisma.loanDisbursement.findMany({ select: { id: true }, take: 5 }),
    ]);
    assert.ok(Array.isArray(facilities));
    assert.ok(Array.isArray(applications));
    assert.ok(Array.isArray(disbursements));
    for (const transaction of transactions) {
      assert.equal(transaction.type, "DISBURSEMENT");
    }

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'LoanTransaction'
      ORDER BY ordinal_position
    `;
    assert.deepEqual(
      columns.map((column) => column.column_name),
      [
        "id",
        "loanFacilityId",
        "type",
        "principalAmount",
        "transactionDate",
        "loanDisbursementId",
        "createdAt",
      ],
    );

    const labels = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'LoanTransactionType'
      ORDER BY e.enumsortorder
    `;
    assert.deepEqual(
      labels.map((label) => label.enumlabel),
      ["DISBURSEMENT"],
    );
  });

  it("stores an interest calculation snapshot and allows another calculation for the same facility", async () => {
    const graph = await createGraph();
    const transactionsBefore = await prisma.loanTransaction.count();
    try {
      const first = calculateInterest({
        calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
        principalAmount: "1000000.00",
        annualRate: "10.0000",
        allocationFrequency: "MONTHLY",
        recalculationFrequency: "ANNUAL",
      });
      const policySnapshot = {
        interestPolicy: {
          annualRate: "10.0000",
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
        },
      };
      const stored = await prisma.interestCalculation.create({
        data: {
          ...provenance(graph, 1),
          calculationStrategy: first.calculationStrategy,
          principalAmount: first.principalAmount,
          annualRate: first.annualRate,
          annualInterestAmount: first.annualInterestAmount,
          allocationFrequency: first.allocationFrequency,
          recalculationFrequency: first.recalculationFrequency,
          inputSnapshot: asJson({
            principalAmount: first.principalAmount,
            annualRate: first.annualRate,
            allocationFrequency: first.allocationFrequency,
            recalculationFrequency: first.recalculationFrequency,
          }),
          policySnapshot: asJson(policySnapshot),
          resultSnapshot: asJson(first),
          allocations: {
            create: first.allocations.map((allocation) => ({
              sequence: allocation.sequence,
              interestAmount: allocation.interestAmount,
            })),
          },
        },
        include: { allocations: { orderBy: { sequence: "asc" } } },
      });

      assert.equal(money(stored.principalAmount), "1000000.00");
      assert.equal(new Prisma.Decimal(stored.annualRate).toFixed(4), "10.0000");
      assert.equal(money(stored.annualInterestAmount), "100000.00");
      assert.equal(stored.productVersionId, graph.versionId);
      assert.equal(stored.historySequence, 1);
      assert.equal(stored.periodStart, null);
      assert.equal(stored.periodEnd, null);
      assert.equal(stored.allocations.length, 12);
      assert.equal(money(stored.allocations[0]?.interestAmount ?? "0"), "8333.34");
      const resultSnapshot = stored.resultSnapshot as {
        annualInterestAmount: unknown;
        allocations: Array<{ interestAmount: unknown }>;
      };
      assert.equal(typeof resultSnapshot.annualInterestAmount, "string");
      assert.equal(resultSnapshot.annualInterestAmount, "100000.00");
      assert.equal(typeof resultSnapshot.allocations[0]?.interestAmount, "string");
      const inputSnapshot = stored.inputSnapshot as { principalAmount: unknown };
      assert.equal(inputSnapshot.principalAmount, "1000000.00");

      const second = calculateInterest({
        calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
        principalAmount: "250000.00",
        annualRate: "10.0000",
        allocationFrequency: "MONTHLY",
        recalculationFrequency: "ANNUAL",
      });
      await prisma.interestCalculation.create({
        data: {
          ...provenance(graph, 2),
          calculationStrategy: second.calculationStrategy,
          principalAmount: second.principalAmount,
          annualRate: second.annualRate,
          annualInterestAmount: second.annualInterestAmount,
          allocationFrequency: second.allocationFrequency,
          recalculationFrequency: second.recalculationFrequency,
          inputSnapshot: asJson({ principalAmount: second.principalAmount }),
          policySnapshot: asJson(policySnapshot),
          resultSnapshot: asJson(second),
          allocations: {
            create: second.allocations.map((allocation) => ({
              sequence: allocation.sequence,
              interestAmount: allocation.interestAmount,
            })),
          },
        },
      });

      const history = await prisma.interestCalculation.findMany({
        where: { loanFacilityId: graph.facilityId },
        orderBy: { historySequence: "asc" },
      });
      assert.equal(history.length, 2);
      assert.equal(money(history[0]?.principalAmount ?? "0"), "1000000.00");
      assert.equal(money(history[1]?.principalAmount ?? "0"), "250000.00");
      assert.equal(await prisma.loanTransaction.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(await prisma.loanTransaction.count(), transactionsBefore);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("rejects a duplicate interest allocation sequence", async () => {
    const graph = await createGraph();
    try {
      const calculation = await prisma.interestCalculation.create({
        data: {
          ...provenance(graph, 1),
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          principalAmount: "10.00",
          annualRate: "0.0000",
          annualInterestAmount: "0.00",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
          inputSnapshot: asJson({ principalAmount: "10.00" }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson({ annualInterestAmount: "0.00" }),
          allocations: { create: [{ sequence: 1, interestAmount: "0.00" }] },
        },
      });

      await assert.rejects(
        () =>
          prisma.interestAllocation.create({
            data: {
              interestCalculationId: calculation.id,
              sequence: 1,
              interestAmount: "0.01",
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
          assert.equal(error.code, "P2002");
          return true;
        },
      );
    } finally {
      await destroyGraph(graph);
    }
  });

  it("stores a full schedule and a partial schedule without writing loan transactions", async () => {
    const graph = await createGraph();
    const transactionsBefore = await prisma.loanTransaction.count();
    try {
      const calculation = await prisma.interestCalculation.create({
        data: {
          ...provenance(graph, 1),
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          principalAmount: "100.00",
          annualRate: "0.0000",
          annualInterestAmount: "0.00",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
          inputSnapshot: asJson({ principalAmount: "100.00" }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson({ annualInterestAmount: "0.00" }),
        },
      });

      const full = assembleRepaymentSchedule({
        principalAmount: "100.00",
        dueDates: ["2026-01-15", "2026-02-15"],
        principalAllocations: ["40.00", "60.00"],
        interestAllocations: ["1.00", "2.00"],
      });
      const storedFull = await prisma.repaymentSchedule.create({
        data: {
          ...provenance(graph, 1),
          interestCalculationId: calculation.id,
          principalAmount: full.principalAmount,
          totalScheduledPrincipal: full.totalScheduledPrincipal,
          totalScheduledInterest: full.totalScheduledInterest,
          totalScheduledAmount: full.totalScheduledAmount,
          remainingPrincipal: full.remainingPrincipal,
          numberOfInstalments: full.numberOfInstalments,
          inputSnapshot: asJson({
            principalAmount: "100.00",
            dueDates: ["2026-01-15", "2026-02-15"],
            principalAllocations: ["40.00", "60.00"],
            interestAllocations: ["1.00", "2.00"],
          }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson(full),
          entries: {
            create: full.entries.map((entry) => ({
              sequence: entry.sequence,
              dueDate: utcDate(entry.dueDate),
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
      assert.equal(money(storedFull.remainingPrincipal), "0.00");
      assert.equal(money(storedFull.totalScheduledPrincipal), "100.00");
      assert.equal(money(storedFull.totalScheduledAmount), "103.00");
      assert.equal(storedFull.entries.length, 2);
      assert.equal(storedFull.entries[1]?.dueDate.toISOString().slice(0, 10), "2026-02-15");
      assert.equal(money(storedFull.entries[1]?.closingPrincipal ?? "0"), "0.00");
      const fullSnapshot = storedFull.resultSnapshot as { remainingPrincipal: unknown };
      assert.equal(typeof fullSnapshot.remainingPrincipal, "string");
      assert.equal(fullSnapshot.remainingPrincipal, "0.00");

      const partial = assembleRepaymentSchedule({
        principalAmount: "1000000.00",
        dueDates: ["2026-03-15", "2026-04-15", "2026-05-15"],
        principalAllocations: ["20000.00", "20000.00", "20000.00"],
        interestAllocations: ["0.00", "0.00", "0.00"],
      });
      const storedPartial = await prisma.repaymentSchedule.create({
        data: {
          ...provenance(graph, 2),
          principalAmount: partial.principalAmount,
          totalScheduledPrincipal: partial.totalScheduledPrincipal,
          totalScheduledInterest: partial.totalScheduledInterest,
          totalScheduledAmount: partial.totalScheduledAmount,
          remainingPrincipal: partial.remainingPrincipal,
          numberOfInstalments: partial.numberOfInstalments,
          inputSnapshot: asJson({
            principalAmount: "1000000.00",
            principalAllocations: ["20000.00", "20000.00", "20000.00"],
          }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson(partial),
          entries: {
            create: partial.entries.map((entry) => ({
              sequence: entry.sequence,
              dueDate: utcDate(entry.dueDate),
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
      assert.equal(storedPartial.interestCalculationId, null);
      assert.equal(money(storedPartial.totalScheduledPrincipal), "60000.00");
      assert.equal(money(storedPartial.remainingPrincipal), "940000.00");
      assert.equal(money(storedPartial.entries[2]?.closingPrincipal ?? "0"), "940000.00");
      const partialSnapshot = storedPartial.inputSnapshot as { principalAmount: unknown };
      assert.equal(typeof partialSnapshot.principalAmount, "string");

      const schedules = await prisma.repaymentSchedule.findMany({
        where: { loanFacilityId: graph.facilityId },
      });
      assert.equal(schedules.length, 2);
      assert.equal(await prisma.loanTransaction.count({ where: { loanFacilityId: graph.facilityId } }), 0);
      assert.equal(await prisma.loanTransaction.count(), transactionsBefore);
    } finally {
      await destroyGraph(graph);
    }
  });

  it("rejects a duplicate repayment schedule entry sequence", async () => {
    const graph = await createGraph();
    try {
      const schedule = await prisma.repaymentSchedule.create({
        data: {
          ...provenance(graph, 1),
          principalAmount: "10.00",
          totalScheduledPrincipal: "10.00",
          totalScheduledInterest: "0.00",
          totalScheduledAmount: "10.00",
          remainingPrincipal: "0.00",
          numberOfInstalments: 1,
          inputSnapshot: asJson({ principalAmount: "10.00" }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson({ remainingPrincipal: "0.00" }),
          entries: {
            create: [
              {
                sequence: 1,
                dueDate: utcDate("2026-01-15"),
                openingPrincipal: "10.00",
                scheduledPrincipal: "10.00",
                scheduledInterest: "0.00",
                totalScheduledAmount: "10.00",
                closingPrincipal: "0.00",
              },
            ],
          },
        },
      });

      await assert.rejects(
        () =>
          prisma.repaymentScheduleEntry.create({
            data: {
              repaymentScheduleId: schedule.id,
              sequence: 1,
              dueDate: utcDate("2026-02-15"),
              openingPrincipal: "0.00",
              scheduledPrincipal: "0.00",
              scheduledInterest: "0.00",
              totalScheduledAmount: "0.00",
              closingPrincipal: "0.00",
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
          assert.equal(error.code, "P2002");
          return true;
        },
      );
    } finally {
      await destroyGraph(graph);
    }
  });

  it("keeps a calculation reference on the same facility and the facility product version", async () => {
    const graph = await createGraph();
    const other = await createGraph();
    let otherVersionId: string | undefined;
    try {
      const calculation = await prisma.interestCalculation.create({
        data: {
          ...provenance(graph, 1),
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          principalAmount: "100.00",
          annualRate: "10.0000",
          annualInterestAmount: "10.00",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
          inputSnapshot: asJson({ principalAmount: "100.00" }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson({ annualInterestAmount: "10.00" }),
        },
      });
      const linked = await prisma.repaymentSchedule.create({
        data: {
          ...provenance(graph, 1),
          interestCalculationId: calculation.id,
          principalAmount: "100.00",
          totalScheduledPrincipal: "100.00",
          totalScheduledInterest: "0.00",
          totalScheduledAmount: "100.00",
          remainingPrincipal: "0.00",
          numberOfInstalments: 1,
          inputSnapshot: asJson({ principalAmount: "100.00" }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson({ remainingPrincipal: "0.00" }),
        },
      });
      assert.equal(linked.interestCalculationId, calculation.id);
      assert.equal(linked.loanFacilityId, calculation.loanFacilityId);
      assert.equal(linked.productVersionId, graph.versionId);

      const unlinked = await prisma.repaymentSchedule.create({
        data: {
          ...provenance(graph, 2),
          principalAmount: "100.00",
          totalScheduledPrincipal: "40.00",
          totalScheduledInterest: "0.00",
          totalScheduledAmount: "40.00",
          remainingPrincipal: "60.00",
          numberOfInstalments: 1,
          inputSnapshot: asJson({ principalAmount: "100.00" }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson({ remainingPrincipal: "60.00" }),
        },
      });
      assert.equal(unlinked.interestCalculationId, null);

      const otherCalculation = await prisma.interestCalculation.create({
        data: {
          ...provenance(other, 1),
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          principalAmount: "50.00",
          annualRate: "1.0000",
          annualInterestAmount: "0.50",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
          inputSnapshot: asJson({ principalAmount: "50.00" }),
          policySnapshot: asJson({}),
          resultSnapshot: asJson({ annualInterestAmount: "0.50" }),
        },
      });
      await assert.rejects(
        () =>
          prisma.repaymentSchedule.create({
            data: {
              ...provenance(graph, 3),
              interestCalculationId: otherCalculation.id,
              principalAmount: "100.00",
              totalScheduledPrincipal: "0.00",
              totalScheduledInterest: "0.00",
              totalScheduledAmount: "0.00",
              remainingPrincipal: "100.00",
              numberOfInstalments: 1,
              inputSnapshot: asJson({}),
              policySnapshot: asJson({}),
              resultSnapshot: asJson({}),
            },
          }),
        isForeignKeyViolation,
      );

      otherVersionId = (
        await prisma.productVersion.create({
          data: {
            loanProductId: graph.productId,
            versionNumber: 2,
            effectiveFrom: utcDate("2026-02-01"),
            configuration: {},
          },
        })
      ).id;
      await assert.rejects(
        () =>
          prisma.interestCalculation.create({
            data: {
              loanFacilityId: graph.facilityId,
              productVersionId: otherVersionId,
              historySequence: 2,
              calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
              principalAmount: "100.00",
              annualRate: "10.0000",
              annualInterestAmount: "10.00",
              allocationFrequency: "MONTHLY",
              recalculationFrequency: "ANNUAL",
              inputSnapshot: asJson({}),
              policySnapshot: asJson({}),
              resultSnapshot: asJson({}),
            },
          }),
        isForeignKeyViolation,
      );
      await assert.rejects(
        () =>
          prisma.repaymentSchedule.create({
            data: {
              loanFacilityId: graph.facilityId,
              productVersionId: otherVersionId,
              historySequence: 4,
              principalAmount: "100.00",
              totalScheduledPrincipal: "0.00",
              totalScheduledInterest: "0.00",
              totalScheduledAmount: "0.00",
              remainingPrincipal: "100.00",
              numberOfInstalments: 1,
              inputSnapshot: asJson({}),
              policySnapshot: asJson({}),
              resultSnapshot: asJson({}),
            },
          }),
        isForeignKeyViolation,
      );

      await assert.rejects(
        () =>
          prisma.interestCalculation.create({
            data: {
              ...provenance(graph, 1),
              calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
              principalAmount: "1.00",
              annualRate: "1.0000",
              annualInterestAmount: "0.01",
              allocationFrequency: "MONTHLY",
              recalculationFrequency: "ANNUAL",
              inputSnapshot: asJson({}),
              policySnapshot: asJson({}),
              resultSnapshot: asJson({}),
            },
          }),
        isUniqueViolation,
      );
      await prisma.interestCalculation.create({
        data: {
          ...provenance(graph, 2),
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          principalAmount: "1.00",
          annualRate: "1.0000",
          annualInterestAmount: "0.01",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
          inputSnapshot: asJson({}),
          policySnapshot: asJson({}),
          resultSnapshot: asJson({}),
        },
      });
      await assert.rejects(
        () =>
          prisma.repaymentSchedule.create({
            data: {
              ...provenance(graph, 1),
              principalAmount: "1.00",
              totalScheduledPrincipal: "1.00",
              totalScheduledInterest: "0.00",
              totalScheduledAmount: "1.00",
              remainingPrincipal: "0.00",
              numberOfInstalments: 1,
              inputSnapshot: asJson({}),
              policySnapshot: asJson({}),
              resultSnapshot: asJson({}),
            },
          }),
        isUniqueViolation,
      );

      const calculations = await prisma.interestCalculation.findMany({
        where: { loanFacilityId: graph.facilityId },
        orderBy: { historySequence: "asc" },
        select: { historySequence: true },
      });
      assert.deepEqual(
        calculations.map((row) => row.historySequence),
        [1, 2],
      );
      const schedules = await prisma.repaymentSchedule.findMany({
        where: { loanFacilityId: graph.facilityId },
        orderBy: { historySequence: "asc" },
        select: { historySequence: true },
      });
      assert.deepEqual(
        schedules.map((row) => row.historySequence),
        [1, 2],
      );
    } finally {
      if (otherVersionId) {
        await prisma.productVersion.delete({ where: { id: otherVersionId } });
      }
      await destroyGraph(graph);
      await destroyGraph(other);
    }
  });
});
