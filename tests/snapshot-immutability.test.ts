import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Prisma } from "../src/generated/prisma/client.js";
import { disconnectDatabase, prisma } from "../src/shared/database/prisma.js";
import { requireTestDatabase } from "./require-test-database.js";

type GraphIds = {
  facilityId: string;
  versionId: string;
};

const FORBIDDEN_DATABASES = new Set([
  "loan_management_db",
  "loan_management_shadow",
  "postgres",
  "template0",
  "template1",
]);

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isAppendOnlyRejection(error: unknown): boolean {
  return error instanceof Error && error.message.includes("financial snapshot rows are append-only");
}

async function assertCurrentDatabaseIsDisposable(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  const name = rows[0]?.name;
  assert.equal(name, "loan_management_test");
  assert.equal(FORBIDDEN_DATABASES.has(name ?? ""), false);
}

async function createGraph(): Promise<GraphIds> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const category = await prisma.productCategory.create({
    data: { code: `P8I${suffix}`.slice(0, 32), name: "Phase 8C immutability" },
  });
  const product = await prisma.loanProduct.create({
    data: {
      categoryId: category.id,
      code: `P8N${suffix}`.slice(0, 32),
      name: "Phase 8C immutability product",
    },
  });
  const version = await prisma.productVersion.create({
    data: {
      loanProductId: product.id,
      versionNumber: 1,
      effectiveFrom: utcDate("2026-01-01"),
      configuration: {},
    },
  });
  const borrower = await prisma.borrower.create({
    data: { firstName: "Phase", lastName: "Immutability" },
  });
  const application = await prisma.loanApplication.create({
    data: {
      applicationNumber: `P8A-IMM-${suffix}`,
      borrowerId: borrower.id,
      loanProductId: product.id,
      productVersionId: version.id,
    },
  });
  const facility = await prisma.loanFacility.create({
    data: {
      facilityNumber: `P8F-IMM-${suffix}`,
      loanApplicationId: application.id,
      borrowerId: borrower.id,
      loanProductId: product.id,
      productVersionId: version.id,
      authorizedPrincipalAmount: "1000.00",
      currencyCode: "LKR",
      facilityDate: utcDate("2026-01-01"),
    },
  });
  return { facilityId: facility.id, versionId: version.id };
}

async function insertCalculation(graph: GraphIds, historySequence: number) {
  return prisma.interestCalculation.create({
    data: {
      loanFacilityId: graph.facilityId,
      productVersionId: graph.versionId,
      historySequence,
      calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
      principalAmount: "100.00",
      annualRate: "10.0000",
      annualInterestAmount: "10.00",
      allocationFrequency: "MONTHLY",
      recalculationFrequency: "ANNUAL",
      inputSnapshot: asJson({ principalAmount: "100.00" }),
      policySnapshot: asJson({ interestPolicy: { annualRate: "10.0000" } }),
      resultSnapshot: asJson({ annualInterestAmount: "10.00" }),
      allocations: {
        create: [{ sequence: 1, interestAmount: "10.00" }],
      },
    },
    include: { allocations: true },
  });
}

async function insertSchedule(graph: GraphIds, historySequence: number) {
  return prisma.repaymentSchedule.create({
    data: {
      loanFacilityId: graph.facilityId,
      productVersionId: graph.versionId,
      historySequence,
      principalAmount: "100.00",
      totalScheduledPrincipal: "100.00",
      totalScheduledInterest: "10.00",
      totalScheduledAmount: "110.00",
      remainingPrincipal: "0.00",
      numberOfInstalments: 1,
      inputSnapshot: asJson({ principalAmount: "100.00" }),
      policySnapshot: asJson({ repaymentPolicy: { paymentAllocationPriority: ["INTEREST", "PRINCIPAL"] } }),
      resultSnapshot: asJson({ totalScheduledAmount: "110.00" }),
      entries: {
        create: [
          {
            sequence: 1,
            dueDate: utcDate("2026-02-01"),
            openingPrincipal: "100.00",
            scheduledPrincipal: "100.00",
            scheduledInterest: "10.00",
            totalScheduledAmount: "110.00",
            closingPrincipal: "0.00",
          },
        ],
      },
    },
    include: { entries: true },
  });
}

describe("financial snapshot immutability", { concurrency: 1 }, () => {
  let graph: GraphIds;

  before(async () => {
    await requireTestDatabase();
    await assertCurrentDatabaseIsDisposable();
    graph = await createGraph();
  });

  after(async () => {
    await disconnectDatabase();
  });

  it("accepts a first insert and rejects update, delete, and truncate of each snapshot table", async () => {
    const calculation = await insertCalculation(graph, 1);
    const allocation = calculation.allocations[0];
    assert.ok(allocation);
    const schedule = await insertSchedule(graph, 1);
    const entry = schedule.entries[0];
    assert.ok(entry);
    const request = await prisma.financialSnapshotRequest.create({
      data: {
        loanFacilityId: graph.facilityId,
        snapshotType: "INTEREST_CALCULATION",
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
        interestCalculationId: calculation.id,
      },
    });

    const mutations: Array<{ table: string; sql: Prisma.Sql }> = [
      {
        table: "InterestCalculation",
        sql: Prisma.sql`UPDATE "InterestCalculation" SET "principalAmount" = 1.00 WHERE "id" = ${calculation.id}`,
      },
      {
        table: "InterestCalculation",
        sql: Prisma.sql`DELETE FROM "InterestCalculation" WHERE "id" = ${calculation.id}`,
      },
      {
        table: "InterestCalculation",
        sql: Prisma.sql`TRUNCATE TABLE "InterestCalculation"`,
      },
      {
        table: "InterestAllocation",
        sql: Prisma.sql`UPDATE "InterestAllocation" SET "interestAmount" = 1.00 WHERE "id" = ${allocation.id}`,
      },
      {
        table: "InterestAllocation",
        sql: Prisma.sql`DELETE FROM "InterestAllocation" WHERE "id" = ${allocation.id}`,
      },
      {
        table: "InterestAllocation",
        sql: Prisma.sql`TRUNCATE TABLE "InterestAllocation"`,
      },
      {
        table: "RepaymentSchedule",
        sql: Prisma.sql`UPDATE "RepaymentSchedule" SET "principalAmount" = 1.00 WHERE "id" = ${schedule.id}`,
      },
      {
        table: "RepaymentSchedule",
        sql: Prisma.sql`DELETE FROM "RepaymentSchedule" WHERE "id" = ${schedule.id}`,
      },
      {
        table: "RepaymentSchedule",
        sql: Prisma.sql`TRUNCATE TABLE "RepaymentSchedule"`,
      },
      {
        table: "RepaymentScheduleEntry",
        sql: Prisma.sql`UPDATE "RepaymentScheduleEntry" SET "scheduledInterest" = 1.00 WHERE "id" = ${entry.id}`,
      },
      {
        table: "RepaymentScheduleEntry",
        sql: Prisma.sql`DELETE FROM "RepaymentScheduleEntry" WHERE "id" = ${entry.id}`,
      },
      {
        table: "RepaymentScheduleEntry",
        sql: Prisma.sql`TRUNCATE TABLE "RepaymentScheduleEntry"`,
      },
      {
        table: "FinancialSnapshotRequest",
        sql: Prisma.sql`UPDATE "FinancialSnapshotRequest" SET "requestFingerprint" = ${"b".repeat(64)} WHERE "id" = ${request.id}`,
      },
      {
        table: "FinancialSnapshotRequest",
        sql: Prisma.sql`DELETE FROM "FinancialSnapshotRequest" WHERE "id" = ${request.id}`,
      },
      {
        table: "FinancialSnapshotRequest",
        sql: Prisma.sql`TRUNCATE TABLE "FinancialSnapshotRequest"`,
      },
    ];

    for (const mutation of mutations) {
      await assert.rejects(
        () =>
          prisma.$transaction(async (tx) => {
            await tx.$executeRaw(mutation.sql);
            throw new Error(`${mutation.table} mutation was not rejected`);
          }),
        isAppendOnlyRejection,
      );
    }

    const storedCalculation = await prisma.interestCalculation.findUniqueOrThrow({ where: { id: calculation.id } });
    const storedAllocation = await prisma.interestAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    const storedSchedule = await prisma.repaymentSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    const storedEntry = await prisma.repaymentScheduleEntry.findUniqueOrThrow({ where: { id: entry.id } });
    const storedRequest = await prisma.financialSnapshotRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(storedCalculation.principalAmount.toFixed(2), "100.00");
    assert.equal(storedAllocation.interestAmount.toFixed(2), "10.00");
    assert.equal(storedSchedule.principalAmount.toFixed(2), "100.00");
    assert.equal(storedEntry.scheduledInterest.toFixed(2), "10.00");
    assert.equal(storedRequest.requestFingerprint, "a".repeat(64));
    assert.equal(await prisma.interestCalculation.count({ where: { id: calculation.id } }), 1);
    assert.equal(await prisma.financialSnapshotRequest.count({ where: { id: request.id } }), 1);
  });

  it("rolls back a new snapshot when a later change in the same transaction is rejected", async () => {
    const blockedId = randomUUID();
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await tx.interestCalculation.create({
            data: {
              id: blockedId,
              loanFacilityId: graph.facilityId,
              productVersionId: graph.versionId,
              historySequence: 2,
              calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
              principalAmount: "50.00",
              annualRate: "10.0000",
              annualInterestAmount: "5.00",
              allocationFrequency: "MONTHLY",
              recalculationFrequency: "ANNUAL",
              inputSnapshot: asJson({ principalAmount: "50.00" }),
              policySnapshot: asJson({ interestPolicy: { annualRate: "10.0000" } }),
              resultSnapshot: asJson({ annualInterestAmount: "5.00" }),
            },
          });
          await tx.$executeRaw`UPDATE "InterestCalculation" SET "principalAmount" = 1.00 WHERE "id" = ${blockedId}`;
        }),
      isAppendOnlyRejection,
    );
    assert.equal(await prisma.interestCalculation.count({ where: { id: blockedId } }), 0);

    const appended = await insertCalculation(graph, 3);
    assert.equal(appended.historySequence, 3);
    assert.equal(appended.principalAmount.toFixed(2), "100.00");
  });
});
