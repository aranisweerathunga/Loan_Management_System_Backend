import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Prisma } from "../src/generated/prisma/client.js";
import {
  getInterestCalculation,
  getRepaymentSchedule,
  listInterestCalculations,
  listRepaymentSchedules,
} from "../src/modules/interest-repayment/snapshot-history.service.js";
import { disconnectDatabase, prisma } from "../src/shared/database/prisma.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { requireTestDatabase } from "./require-test-database.js";

/**
 * Reads persisted snapshot history. Fixtures are append-only and are left in
 * place until the disposable test database is dropped.
 */

type RowRef = {
  id: string;
  historySequence: number;
};

type FinancialCounts = {
  calculations: number;
  allocations: number;
  schedules: number;
  entries: number;
  requests: number;
};

const richInputSnapshot = {
  principalAmount: "100.5",
  annualRate: "10",
  notes: ["keep-scale", 1],
};

const richPolicySnapshot = {
  interestPolicy: { annualRate: "10" },
};

const richResultSnapshot = {
  annualInterestAmount: "80.250",
  allocations: [{ sequence: 1, interestAmount: "1.5" }],
};

const linkedScheduleInput = { principalAmount: "100.5", source: "linked" };
const linkedSchedulePolicy = { repaymentPolicy: { marker: "linked" } };
const linkedScheduleResult = { totalScheduledAmount: "110.500" };

const plainSnapshot = { marker: "plain" } as Prisma.InputJsonValue;

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function oppositeId(prefix: string, sequence: number, total: number): string {
  const opposite = (total - sequence + 1).toString(16).padStart(12, "0");
  return `${prefix}-0000-4000-8000-${opposite}`;
}

function byHistoryThenId(left: RowRef, right: RowRef): number {
  if (left.historySequence !== right.historySequence) {
    return left.historySequence - right.historySequence;
  }
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

async function expectAppError(
  promise: Promise<unknown>,
  statusCode: number,
  code: string,
  message: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
}

function ownKeys(value: unknown, keys: Set<string>): void {
  if (value instanceof Date || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) ownKeys(item, keys);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    ownKeys(child, keys);
  }
}

function cursorToken(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function requireCursor(cursor: string | null): string {
  assert.equal(typeof cursor, "string");
  if (typeof cursor !== "string") {
    throw new Error("Expected a pagination cursor.");
  }
  return cursor;
}

describe("financial snapshot history reads", { concurrency: 1 }, () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const calculationKey = randomUUID();
  const scheduleKey = randomUUID();
  const calculationFingerprint = randomBytes(32).toString("hex");
  const scheduleFingerprint = randomBytes(32).toString("hex");
  const facilityIds: string[] = [];
  const calculationsA: RowRef[] = [];
  const schedulesA: RowRef[] = [];
  const calculationsC: RowRef[] = [];
  let facilityA = "";
  let facilityB = "";
  let facilityC = "";
  let versionId = "";
  let richCalculationId = "";
  let linkedScheduleId = "";
  let unlinkedScheduleId = "";
  let calculationB = "";
  let scheduleB = "";

  before(async () => {
    await requireTestDatabase();
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(rows[0]?.name, "loan_management_test");

    const category = await prisma.productCategory.create({
      data: { code: `P8H${suffix}`, name: "Phase 8C history" },
    });
    const product = await prisma.loanProduct.create({
      data: {
        categoryId: category.id,
        code: `P8N${suffix}`,
        name: "Phase 8C history product",
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
    versionId = version.id;
    const borrower = await prisma.borrower.create({
      data: { firstName: "Phase", lastName: "History" },
    });

    facilityA = await createFacility("A", borrower.id, product.id);
    facilityB = await createFacility("B", borrower.id, product.id);
    facilityC = await createFacility("C", borrower.id, product.id);
    facilityIds.push(facilityA, facilityB, facilityC);

    for (const sequence of [5, 1, 4, 2, 3]) {
      const id = oppositeId("b2222222", sequence, 5);
      const rich = sequence === 1;
      await prisma.interestCalculation.create({
        data: {
          id,
          loanFacilityId: facilityA,
          productVersionId: versionId,
          historySequence: sequence,
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          principalAmount: rich ? "1000.10" : "10.00",
          annualRate: rich ? "12.3400" : "1.0000",
          annualInterestAmount: rich ? "80.25" : "1.00",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
          periodStart: rich ? utcDate("2026-04-01") : null,
          periodEnd: rich ? utcDate("2026-12-31") : null,
          inputSnapshot: rich ? jsonValue(richInputSnapshot) : plainSnapshot,
          policySnapshot: rich ? jsonValue(richPolicySnapshot) : plainSnapshot,
          resultSnapshot: rich ? jsonValue(richResultSnapshot) : plainSnapshot,
          ...(rich
            ? {
                allocations: {
                  create: [
                    { sequence: 2, interestAmount: "2.25" },
                    { sequence: 1, interestAmount: "1.50" },
                  ],
                },
              }
            : {}),
        },
      });
      calculationsA.push({ id, historySequence: sequence });
      if (rich) richCalculationId = id;
    }

    const paginationTotal = 51;
    await prisma.interestCalculation.createMany({
      data: Array.from({ length: paginationTotal }, (_, index) => {
        const historySequence = index + 1;
        const id = oppositeId("a1111111", historySequence, paginationTotal);
        calculationsC.push({ id, historySequence });
        return {
          id,
          loanFacilityId: facilityC,
          productVersionId: versionId,
          historySequence,
          calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
          principalAmount: "10.00",
          annualRate: "1.0000",
          annualInterestAmount: "1.00",
          allocationFrequency: "MONTHLY",
          recalculationFrequency: "ANNUAL",
          inputSnapshot: plainSnapshot,
          policySnapshot: plainSnapshot,
          resultSnapshot: plainSnapshot,
        };
      }),
    });

    calculationB = oppositeId("d4444444", 1, 1);
    await prisma.interestCalculation.create({
      data: {
        id: calculationB,
        loanFacilityId: facilityB,
        productVersionId: versionId,
        historySequence: 1,
        calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
        principalAmount: "20.00",
        annualRate: "2.0000",
        annualInterestAmount: "2.00",
        allocationFrequency: "MONTHLY",
        recalculationFrequency: "ANNUAL",
        inputSnapshot: plainSnapshot,
        policySnapshot: plainSnapshot,
        resultSnapshot: plainSnapshot,
      },
    });

    linkedScheduleId = oppositeId("c3333333", 1, 2);
    unlinkedScheduleId = oppositeId("c3333333", 2, 2);
    await prisma.repaymentSchedule.create({
      data: {
        id: linkedScheduleId,
        loanFacilityId: facilityA,
        productVersionId: versionId,
        historySequence: 1,
        interestCalculationId: richCalculationId,
        principalAmount: "1000.10",
        totalScheduledPrincipal: "1000.10",
        totalScheduledInterest: "80.25",
        totalScheduledAmount: "1080.35",
        remainingPrincipal: "0.00",
        numberOfInstalments: 3,
        inputSnapshot: jsonValue(linkedScheduleInput),
        policySnapshot: jsonValue(linkedSchedulePolicy),
        resultSnapshot: jsonValue(linkedScheduleResult),
        entries: {
          create: [
            entry(2, "2026-02-01", "2.00"),
            entry(3, "2026-01-01", "3.00"),
            entry(1, "2026-03-01", "1.00"),
          ],
        },
      },
    });
    await prisma.repaymentSchedule.create({
      data: {
        id: unlinkedScheduleId,
        loanFacilityId: facilityA,
        productVersionId: versionId,
        historySequence: 2,
        principalAmount: "50.00",
        totalScheduledPrincipal: "50.00",
        totalScheduledInterest: "0.00",
        totalScheduledAmount: "50.00",
        remainingPrincipal: "0.00",
        numberOfInstalments: 1,
        inputSnapshot: plainSnapshot,
        policySnapshot: plainSnapshot,
        resultSnapshot: plainSnapshot,
        entries: {
          create: [entry(1, "2026-05-01", "0.00")],
        },
      },
    });
    schedulesA.push(
      { id: linkedScheduleId, historySequence: 1 },
      { id: unlinkedScheduleId, historySequence: 2 },
    );

    scheduleB = oppositeId("e5555555", 1, 1);
    await prisma.repaymentSchedule.create({
      data: {
        id: scheduleB,
        loanFacilityId: facilityB,
        productVersionId: versionId,
        historySequence: 1,
        principalAmount: "20.00",
        totalScheduledPrincipal: "20.00",
        totalScheduledInterest: "2.00",
        totalScheduledAmount: "22.00",
        remainingPrincipal: "0.00",
        numberOfInstalments: 1,
        inputSnapshot: plainSnapshot,
        policySnapshot: plainSnapshot,
        resultSnapshot: plainSnapshot,
        entries: {
          create: [entry(1, "2026-06-01", "2.00")],
        },
      },
    });

    await prisma.financialSnapshotRequest.create({
      data: {
        loanFacilityId: facilityA,
        snapshotType: "INTEREST_CALCULATION",
        idempotencyKey: calculationKey,
        requestFingerprint: calculationFingerprint,
        interestCalculationId: richCalculationId,
      },
    });
    await prisma.financialSnapshotRequest.create({
      data: {
        loanFacilityId: facilityA,
        snapshotType: "REPAYMENT_SCHEDULE",
        idempotencyKey: scheduleKey,
        requestFingerprint: scheduleFingerprint,
        repaymentScheduleId: linkedScheduleId,
      },
    });
  });

  after(async () => {
    await disconnectDatabase();
  });

  it("returns interest calculation history only for the requested facility", async () => {
    const listedA = await listInterestCalculations(facilityA, { limit: 100 });
    const listedB = await listInterestCalculations(facilityB, { limit: 100 });
    assert.deepEqual(
      listedA.items.map((item) => item.id).sort(),
      calculationsA.map((item) => item.id).sort(),
    );
    assert.deepEqual(
      listedB.items.map((item) => item.id),
      [calculationB],
    );
    assert.equal(listedA.items.every((item) => item.loanFacilityId === facilityA), true);
    assert.equal(listedB.items.every((item) => item.loanFacilityId === facilityB), true);
  });

  it("returns repayment schedule history only for the requested facility", async () => {
    const listedA = await listRepaymentSchedules(facilityA, { limit: 100 });
    const listedB = await listRepaymentSchedules(facilityB, { limit: 100 });
    assert.deepEqual(
      listedA.items.map((item) => item.id).sort(),
      schedulesA.map((item) => item.id).sort(),
    );
    assert.deepEqual(
      listedB.items.map((item) => item.id),
      [scheduleB],
    );
    assert.equal(listedA.items.every((item) => item.loanFacilityId === facilityA), true);
    assert.equal(listedB.items.every((item) => item.loanFacilityId === facilityB), true);
  });

  it("returns 404 when a snapshot belongs to another facility", async () => {
    await expectAppError(
      getInterestCalculation(facilityB, richCalculationId),
      404,
      "NOT_FOUND",
      "Interest calculation not found",
    );
    await expectAppError(
      getInterestCalculation(facilityA, calculationB),
      404,
      "NOT_FOUND",
      "Interest calculation not found",
    );
    await expectAppError(
      getRepaymentSchedule(facilityB, linkedScheduleId),
      404,
      "NOT_FOUND",
      "Repayment schedule not found",
    );
    await expectAppError(
      getRepaymentSchedule(facilityA, scheduleB),
      404,
      "NOT_FOUND",
      "Repayment schedule not found",
    );
  });

  it("returns 404 for a missing facility or snapshot", async () => {
    const missingFacility = randomUUID();
    const missingSnapshot = randomUUID();
    await expectAppError(
      listInterestCalculations(missingFacility),
      404,
      "NOT_FOUND",
      "Loan facility not found",
    );
    await expectAppError(
      listRepaymentSchedules(missingFacility),
      404,
      "NOT_FOUND",
      "Loan facility not found",
    );
    await expectAppError(
      getInterestCalculation(missingFacility, missingSnapshot),
      404,
      "NOT_FOUND",
      "Loan facility not found",
    );
    await expectAppError(
      getInterestCalculation(facilityA, missingSnapshot),
      404,
      "NOT_FOUND",
      "Interest calculation not found",
    );
    await expectAppError(
      getRepaymentSchedule(facilityA, missingSnapshot),
      404,
      "NOT_FOUND",
      "Repayment schedule not found",
    );
  });

  it("orders history by historySequence ascending, then id ascending", async () => {
    const calculations = await listInterestCalculations(facilityA, { limit: 100 });
    const schedules = await listRepaymentSchedules(facilityA, { limit: 100 });
    const expectedCalculations = [...calculationsA].sort(byHistoryThenId).map((item) => item.id);
    const expectedSchedules = [...schedulesA].sort(byHistoryThenId).map((item) => item.id);
    const byId = [...calculationsA].sort((left, right) => (left.id < right.id ? -1 : 1)).map((item) => item.id);

    assert.deepEqual(calculations.items.map((item) => item.id), expectedCalculations);
    assert.deepEqual(
      calculations.items.map((item) => item.historySequence),
      [1, 2, 3, 4, 5],
    );
    assert.notDeepEqual(expectedCalculations, byId);
    assert.deepEqual(schedules.items.map((item) => item.id), expectedSchedules);
    assert.deepEqual(
      schedules.items.map((item) => item.historySequence),
      [1, 2],
    );
  });

  it("orders allocations and repayment entries by sequence ascending", async () => {
    const calculation = await getInterestCalculation(facilityA, richCalculationId);
    const schedule = await getRepaymentSchedule(facilityA, linkedScheduleId);

    assert.deepEqual(
      calculation.allocations.map((item) => item.sequence),
      [1, 2],
    );
    assert.deepEqual(
      calculation.allocations.map((item) => item.interestAmount),
      ["1.50", "2.25"],
    );
    assert.deepEqual(
      schedule.entries.map((item) => item.sequence),
      [1, 2, 3],
    );
    assert.deepEqual(
      schedule.entries.map((item) => item.dueDate),
      ["2026-03-01", "2026-02-01", "2026-01-01"],
    );
    assert.deepEqual(
      schedule.entries.map((item) => item.scheduledInterest),
      ["1.00", "2.00", "3.00"],
    );
  });

  it("pages through history without missing or duplicating records", async () => {
    const first = await listInterestCalculations(facilityC);
    assert.equal(first.items.length, 50);
    const second = await listInterestCalculations(facilityC, { cursor: requireCursor(first.page.nextCursor) });
    const expected = [...calculationsC].sort(byHistoryThenId).map((item) => item.id);
    const collected = [...first.items, ...second.items].map((item) => item.id);

    assert.equal(second.items.length, 1);
    assert.equal(second.page.nextCursor, null);
    assert.equal(new Set(collected).size, collected.length);
    assert.deepEqual(collected, expected);

    const limited = await listInterestCalculations(facilityA, { limit: 2 });
    const middle = await listInterestCalculations(facilityA, {
      limit: 2,
      cursor: requireCursor(limited.page.nextCursor),
    });
    const last = await listInterestCalculations(facilityA, {
      limit: 2,
      cursor: requireCursor(middle.page.nextCursor),
    });
    assert.deepEqual(
      [...limited.items, ...middle.items, ...last.items].map((item) => item.id),
      [...calculationsA].sort(byHistoryThenId).map((item) => item.id),
    );
    assert.equal(last.page.nextCursor, null);

    const wide = await listInterestCalculations(facilityC, { limit: 100 });
    assert.equal(wide.items.length, 51);
    assert.equal(wide.page.nextCursor, null);
  });

  it("rejects a cursor from another facility or history type", async () => {
    const calculations = await listInterestCalculations(facilityA, { limit: 1 });
    const schedules = await listRepaymentSchedules(facilityA, { limit: 1 });
    const calculationCursor = requireCursor(calculations.page.nextCursor);
    const scheduleCursor = requireCursor(schedules.page.nextCursor);

    await expectAppError(
      listInterestCalculations(facilityB, { cursor: calculationCursor }),
      400,
      "VALIDATION_ERROR",
      "cursor: does not belong to this facility",
    );
    await expectAppError(
      listRepaymentSchedules(facilityA, { cursor: calculationCursor }),
      400,
      "VALIDATION_ERROR",
      "cursor: does not belong to this history",
    );
    await expectAppError(
      listInterestCalculations(facilityA, { cursor: scheduleCursor }),
      400,
      "VALIDATION_ERROR",
      "cursor: does not belong to this history",
    );
    await expectAppError(
      listRepaymentSchedules(facilityB, { cursor: calculationCursor }),
      400,
      "VALIDATION_ERROR",
      "cursor: does not belong to this facility; cursor: does not belong to this history",
    );
  });

  it("rejects malformed, noncanonical, and unsupported-version cursors", async () => {
    const page = await listInterestCalculations(facilityA, { limit: 1 });
    const issued = requireCursor(page.page.nextCursor);
    const decoded = JSON.parse(Buffer.from(issued, "base64url").toString("utf8")) as {
      version: number;
      historyType: string;
      facilityId: string;
      historySequence: number;
      id: string;
    };
    const reordered = cursorToken({
      id: decoded.id,
      historySequence: decoded.historySequence,
      facilityId: decoded.facilityId,
      historyType: decoded.historyType,
      version: decoded.version,
    });
    const spaced = Buffer.from(
      Buffer.from(issued, "base64url").toString("utf8").replace("{", "{ "),
      "utf8",
    ).toString("base64url");
    const unsupported = cursorToken({ ...decoded, version: 2 });
    const stringVersion = cursorToken({ ...decoded, version: "1" });
    const extraField = cursorToken({ ...decoded, extra: true });
    const invalidCursors = [
      "%%%",
      "",
      "e30",
      reordered,
      spaced,
      unsupported,
      stringVersion,
      extraField,
    ];

    for (const cursor of invalidCursors) {
      await expectAppError(
        listInterestCalculations(facilityA, { cursor }),
        400,
        "VALIDATION_ERROR",
        "cursor: is invalid",
      );
    }
  });

  it("rejects unknown query parameters and invalid limits", async () => {
    await expectAppError(
      listInterestCalculations(facilityA, { page: 1 }),
      400,
      "VALIDATION_ERROR",
      "page: is not a supported query parameter",
    );
    await expectAppError(
      listRepaymentSchedules(facilityA, { status: "ACTIVE" }),
      400,
      "VALIDATION_ERROR",
      "status: is not a supported query parameter",
    );
    for (const limit of [0, 101, "01", "abc", 1.5]) {
      await expectAppError(
        listInterestCalculations(facilityA, { limit }),
        400,
        "VALIDATION_ERROR",
        "limit: must be an integer from 1 to 100",
      );
    }
  });

  it("preserves money scale, annual-rate scale, snapshot JSON, and calculation links", async () => {
    const listed = await listInterestCalculations(facilityA, { limit: 100 });
    const calculation = listed.items.find((item) => item.id === richCalculationId);
    const detail = await getInterestCalculation(facilityA, richCalculationId);
    const schedules = await listRepaymentSchedules(facilityA, { limit: 100 });
    const linked = await getRepaymentSchedule(facilityA, linkedScheduleId);
    const unlinked = await getRepaymentSchedule(facilityA, unlinkedScheduleId);

    assert.ok(calculation);
    assert.equal(calculation.principalAmount, "1000.10");
    assert.equal(calculation.annualInterestAmount, "80.25");
    assert.equal(calculation.annualRate, "12.3400");
    assert.equal(calculation.periodStart, "2026-04-01");
    assert.equal(calculation.periodEnd, "2026-12-31");
    assert.equal(detail.principalAmount, "1000.10");
    assert.equal(detail.annualRate, "12.3400");
    assert.deepEqual(detail.inputSnapshot, richInputSnapshot);
    assert.deepEqual(detail.policySnapshot, richPolicySnapshot);
    assert.deepEqual(detail.resultSnapshot, richResultSnapshot);
    assert.equal(linked.principalAmount, "1000.10");
    assert.equal(linked.totalScheduledAmount, "1080.35");
    assert.equal(linked.interestCalculationId, richCalculationId);
    assert.deepEqual(linked.inputSnapshot, linkedScheduleInput);
    assert.deepEqual(linked.policySnapshot, linkedSchedulePolicy);
    assert.deepEqual(linked.resultSnapshot, linkedScheduleResult);
    assert.equal(unlinked.interestCalculationId, null);
    assert.equal(
      schedules.items.find((item) => item.id === unlinkedScheduleId)?.interestCalculationId,
      null,
    );
    assert.equal(
      schedules.items.find((item) => item.id === linkedScheduleId)?.interestCalculationId,
      richCalculationId,
    );
  });

  it("does not return idempotency material, create rows, or reference calculation engines", async () => {
    const beforeCounts = await countsFor(facilityIds);
    const calculation = await getInterestCalculation(facilityA, richCalculationId);
    const schedule = await getRepaymentSchedule(facilityA, linkedScheduleId);
    const calculations = await listInterestCalculations(facilityA, { limit: 100 });
    const schedules = await listRepaymentSchedules(facilityA, { limit: 100 });
    const afterCounts = await countsFor(facilityIds);

    const keys = new Set<string>();
    ownKeys(calculation, keys);
    ownKeys(schedule, keys);
    ownKeys(calculations, keys);
    ownKeys(schedules, keys);
    assert.equal(keys.has("idempotencyKey"), false);
    assert.equal(keys.has("requestFingerprint"), false);
    const serialized = JSON.stringify({ calculation, schedule, calculations, schedules });
    assert.equal(serialized.includes(calculationKey), false);
    assert.equal(serialized.includes(scheduleKey), false);
    assert.equal(serialized.includes(calculationFingerprint), false);
    assert.equal(serialized.includes(scheduleFingerprint), false);
    assert.deepEqual(afterCounts, beforeCounts);

    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../src/modules/interest-repayment/snapshot-history.service.ts"),
      "utf8",
    );
    assert.equal(source.includes("interest-engine"), false);
    assert.equal(source.includes("repayment-schedule-engine"), false);
    assert.equal(source.includes("annual-interest-allocation"), false);
    assert.equal(source.includes("snapshot-writer"), false);
    assert.equal(source.includes("calculateInterest"), false);
    assert.equal(source.includes("assembleRepaymentSchedule"), false);
  });

  async function createFacility(label: string, borrowerId: string, productId: string): Promise<string> {
    const application = await prisma.loanApplication.create({
      data: {
        applicationNumber: `P8H-A-${label}-${suffix}`,
        borrowerId,
        loanProductId: productId,
        productVersionId: versionId,
      },
    });
    const facility = await prisma.loanFacility.create({
      data: {
        facilityNumber: `P8H-F-${label}-${suffix}`,
        loanApplicationId: application.id,
        borrowerId,
        loanProductId: productId,
        productVersionId: versionId,
        authorizedPrincipalAmount: "1000.00",
        currencyCode: "LKR",
        facilityDate: utcDate("2026-01-01"),
      },
    });
    return facility.id;
  }
});

function entry(sequence: number, dueDate: string, scheduledInterest: string) {
  return {
    sequence,
    dueDate: utcDate(dueDate),
    openingPrincipal: "100.00",
    scheduledPrincipal: "10.00",
    scheduledInterest,
    totalScheduledAmount: "10.00",
    closingPrincipal: "90.00",
  };
}

async function countsFor(facilityIds: string[]): Promise<FinancialCounts> {
  const [calculations, allocations, schedules, entries, requests] = await Promise.all([
    prisma.interestCalculation.count({ where: { loanFacilityId: { in: facilityIds } } }),
    prisma.interestAllocation.count({
      where: { interestCalculation: { loanFacilityId: { in: facilityIds } } },
    }),
    prisma.repaymentSchedule.count({ where: { loanFacilityId: { in: facilityIds } } }),
    prisma.repaymentScheduleEntry.count({
      where: { repaymentSchedule: { loanFacilityId: { in: facilityIds } } },
    }),
    prisma.financialSnapshotRequest.count({ where: { loanFacilityId: { in: facilityIds } } }),
  ]);
  return { calculations, allocations, schedules, entries, requests };
}
