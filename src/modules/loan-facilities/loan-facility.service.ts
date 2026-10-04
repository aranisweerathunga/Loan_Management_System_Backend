import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { Decimal, formatMoney, parsePositiveMoneyString } from "../../shared/money/decimal.js";
import type {
  CreateLoanDisbursementInput,
  CreateLoanFacilityInput,
  ListLoanFacilitiesQuery,
} from "./loan-facility.schemas.js";
import { isIsoCalendarDate } from "./loan-facility.schemas.js";

type DbClient = Prisma.TransactionClient;

/**
 * Phase 7A has no currency configuration to inherit. LKR is the only operational currency.
 * It is stored on the facility and is not copied onto each disbursement or ledger row.
 */
const SUPPORTED_CURRENCY_CODE = "LKR";

const MISSING_AUTHORIZED_AMOUNT =
  "The approval decision does not contain an authorized principal amount";

type LockedApplicationRow = {
  id: string;
  status: string;
  borrowerId: string;
  loanProductId: string;
  productVersionId: string;
  productPurposeId: string | null;
};

type LockedFacilityRow = {
  id: string;
  status: string;
  authorizedPrincipalAmount: string;
  facilityDate: string;
};

type FacilityRecord = {
  id: string;
  facilityNumber: string;
  loanApplicationId: string;
  borrowerId: string;
  loanProductId: string;
  productVersionId: string;
  productPurposeId: string | null;
  authorizedPrincipalAmount: { toString(): string };
  currencyCode: string;
  facilityDate: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type DisbursementRecord = {
  id: string;
  loanFacilityId: string;
  amount: { toString(): string };
  disbursementDate: Date;
  reference: string | null;
  remarks: string | null;
  createdAt: Date;
};

type TransactionRecord = {
  id: string;
  loanFacilityId: string;
  type: string;
  principalAmount: { toString(): string };
  transactionDate: Date;
  loanDisbursementId: string | null;
  createdAt: Date;
};

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * UTC calendar date of the server clock. This matches application-number years and
 * date-only values stored at UTC midnight. It is not a configurable business-date calendar.
 */
function utcTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function decimalFromDatabase(value: { toString(): string } | null | undefined): Decimal {
  if (value == null) {
    return new Decimal(0);
  }
  return new Decimal(value.toString());
}

function serializeFacility(facility: FacilityRecord, totalDisbursed: Decimal) {
  const authorized = decimalFromDatabase(facility.authorizedPrincipalAmount);
  return {
    id: facility.id,
    facilityNumber: facility.facilityNumber,
    loanApplicationId: facility.loanApplicationId,
    borrowerId: facility.borrowerId,
    loanProductId: facility.loanProductId,
    productVersionId: facility.productVersionId,
    productPurposeId: facility.productPurposeId,
    authorizedPrincipalAmount: formatMoney(authorized),
    totalDisbursed: formatMoney(totalDisbursed),
    remainingAuthorizedAmount: formatMoney(authorized.minus(totalDisbursed)),
    currencyCode: facility.currencyCode,
    facilityDate: toDateOnlyString(facility.facilityDate),
    status: facility.status,
    createdAt: facility.createdAt,
    updatedAt: facility.updatedAt,
  };
}

function serializeDisbursement(disbursement: DisbursementRecord) {
  return {
    id: disbursement.id,
    loanFacilityId: disbursement.loanFacilityId,
    amount: formatMoney(decimalFromDatabase(disbursement.amount)),
    disbursementDate: toDateOnlyString(disbursement.disbursementDate),
    reference: disbursement.reference,
    remarks: disbursement.remarks,
    createdAt: disbursement.createdAt,
  };
}

function serializeTransaction(transaction: TransactionRecord) {
  return {
    id: transaction.id,
    loanFacilityId: transaction.loanFacilityId,
    type: transaction.type,
    principalAmount: formatMoney(decimalFromDatabase(transaction.principalAmount)),
    transactionDate: toDateOnlyString(transaction.transactionDate),
    loanDisbursementId: transaction.loanDisbursementId,
    createdAt: transaction.createdAt,
  };
}

function isApplicationFacilityConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.map((part) => String(part)).join(" ") : String(target ?? "");
  return text.includes("loanApplicationId");
}

async function allocateFacilityNumber(tx: DbClient): Promise<string> {
  const calendarYear = new Date().getUTCFullYear();
  const rows = await tx.$queryRaw<Array<{ lastValue: number | bigint | string }>>`
    INSERT INTO "LoanFacilityNumberSequence" ("calendarYear", "lastValue")
    VALUES (${calendarYear}, 1)
    ON CONFLICT ("calendarYear")
    DO UPDATE SET "lastValue" = "LoanFacilityNumberSequence"."lastValue" + 1
    RETURNING "lastValue"
  `;

  // Sequence counter only. Monetary amounts are never converted with Number.
  const lastValue = Number(rows[0]?.lastValue);
  if (!Number.isInteger(lastValue) || lastValue < 1) {
    throw new AppError(500, "Failed to allocate facility number", "INTERNAL_SERVER_ERROR");
  }

  return `LF-${calendarYear}-${String(lastValue).padStart(6, "0")}`;
}

async function assertHistoricalReferences(tx: DbClient, application: LockedApplicationRow): Promise<void> {
  const borrower = await tx.borrower.findUnique({
    where: { id: application.borrowerId },
    select: { id: true },
  });
  if (!borrower) {
    throw new AppError(409, "The application's borrower can no longer be resolved", "INVALID_STATE");
  }

  const loanProduct = await tx.loanProduct.findUnique({
    where: { id: application.loanProductId },
    select: { id: true },
  });
  if (!loanProduct) {
    throw new AppError(409, "The application's loan product can no longer be resolved", "INVALID_STATE");
  }

  // Keep the application's exact product version, including a version that is no longer ACTIVE.
  const productVersion = await tx.productVersion.findUnique({
    where: { id: application.productVersionId },
    select: { id: true, loanProductId: true },
  });
  if (!productVersion || productVersion.loanProductId !== application.loanProductId) {
    throw new AppError(
      409,
      "The application's product version can no longer be resolved",
      "INVALID_STATE",
    );
  }

  if (application.productPurposeId) {
    const productPurpose = await tx.productPurpose.findUnique({
      where: { id: application.productPurposeId },
      select: { id: true, loanProductId: true },
    });
    if (!productPurpose || productPurpose.loanProductId !== application.loanProductId) {
      throw new AppError(
        409,
        "The application's product purpose can no longer be resolved",
        "INVALID_STATE",
      );
    }
  }
}

async function getRequiredFacility(facilityId: string): Promise<FacilityRecord> {
  const facility = await prisma.loanFacility.findUnique({ where: { id: facilityId } });
  if (!facility) {
    throw new AppError(404, "Loan facility not found", "NOT_FOUND");
  }
  return facility;
}

async function sumDisbursements(tx: DbClient | typeof prisma, facilityId: string): Promise<Decimal> {
  const totals = await tx.loanDisbursement.aggregate({
    where: { loanFacilityId: facilityId },
    _sum: { amount: true },
  });
  return decimalFromDatabase(totals._sum.amount);
}

async function disbursedTotalsByFacility(facilityIds: string[]): Promise<Map<string, Decimal>> {
  const totals = new Map<string, Decimal>();
  if (facilityIds.length === 0) {
    return totals;
  }

  const rows = await prisma.loanDisbursement.groupBy({
    by: ["loanFacilityId"],
    where: { loanFacilityId: { in: facilityIds } },
    _sum: { amount: true },
  });

  for (const row of rows) {
    totals.set(row.loanFacilityId, decimalFromDatabase(row._sum.amount));
  }

  return totals;
}

async function lockFacility(tx: DbClient, facilityId: string): Promise<LockedFacilityRow> {
  const rows = await tx.$queryRaw<LockedFacilityRow[]>`
    SELECT
      "id",
      "status"::text AS "status",
      "authorizedPrincipalAmount"::text AS "authorizedPrincipalAmount",
      to_char("facilityDate", 'YYYY-MM-DD') AS "facilityDate"
    FROM "LoanFacility"
    WHERE "id" = ${facilityId}
    FOR UPDATE
  `;
  const current = rows[0];
  if (!current) {
    throw new AppError(404, "Loan facility not found", "NOT_FOUND");
  }
  return current;
}

function assertDisbursableStatus(status: string): void {
  if (status !== "PENDING_DISBURSEMENT" && status !== "ACTIVE") {
    throw new AppError(409, "Facility is not in a disbursable state", "INVALID_STATE");
  }
}

export async function createLoanFacility(applicationId: string, input: CreateLoanFacilityInput) {
  if (!isIsoCalendarDate(input.facilityDate)) {
    throw new AppError(400, "facilityDate must be a valid calendar date", "VALIDATION_ERROR");
  }
  if (input.currencyCode !== SUPPORTED_CURRENCY_CODE) {
    throw new AppError(400, "currencyCode must be LKR", "VALIDATION_ERROR");
  }

  try {
    const facility = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedApplicationRow[]>`
        SELECT
          "id",
          "status"::text AS "status",
          "borrowerId",
          "loanProductId",
          "productVersionId",
          "productPurposeId"
        FROM "LoanApplication"
        WHERE "id" = ${applicationId}
        FOR UPDATE
      `;
      const application = locked[0];
      if (!application) {
        throw new AppError(404, "Loan application not found", "NOT_FOUND");
      }
      if (application.status !== "APPROVED") {
        throw new AppError(
          409,
          "Only APPROVED loan applications can create a loan facility",
          "INVALID_STATE",
        );
      }

      const existing = await tx.loanFacility.findUnique({
        where: { loanApplicationId: applicationId },
        select: { id: true },
      });
      if (existing) {
        throw new AppError(409, "A loan facility already exists for this application", "CONFLICT");
      }

      const decision = await tx.applicationDecision.findFirst({
        where: { loanApplicationId: applicationId, decision: "APPROVED" },
        orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
      });
      if (!decision) {
        throw new AppError(409, "Approved application has no approval decision", "INVALID_STATE");
      }

      const authorized = decision.authorizedPrincipalAmount
        ? new Decimal(decision.authorizedPrincipalAmount.toString())
        : null;
      if (!authorized || !authorized.greaterThan(0)) {
        throw new AppError(409, MISSING_AUTHORIZED_AMOUNT, "INVALID_STATE");
      }

      await assertHistoricalReferences(tx, application);

      const facilityNumber = await allocateFacilityNumber(tx);
      return tx.loanFacility.create({
        data: {
          facilityNumber,
          loanApplicationId: application.id,
          borrowerId: application.borrowerId,
          loanProductId: application.loanProductId,
          productVersionId: application.productVersionId,
          productPurposeId: application.productPurposeId,
          authorizedPrincipalAmount: authorized,
          currencyCode: SUPPORTED_CURRENCY_CODE,
          facilityDate: dateOnly(input.facilityDate),
          status: "PENDING_DISBURSEMENT",
        },
      });
    }, { maxWait: 15_000, timeout: 15_000 });

    return serializeFacility(facility, new Decimal(0));
  } catch (error) {
    if (isApplicationFacilityConflict(error)) {
      throw new AppError(409, "A loan facility already exists for this application", "CONFLICT");
    }
    throw error;
  }
}

export async function listLoanFacilities(query: ListLoanFacilitiesQuery) {
  if (query.borrowerId) {
    const borrower = await prisma.borrower.findUnique({
      where: { id: query.borrowerId },
      select: { id: true },
    });
    if (!borrower) {
      throw new AppError(404, "Borrower not found", "NOT_FOUND");
    }
  }

  if (query.loanProductId) {
    const loanProduct = await prisma.loanProduct.findUnique({
      where: { id: query.loanProductId },
      select: { id: true },
    });
    if (!loanProduct) {
      throw new AppError(404, "Loan product not found", "NOT_FOUND");
    }
  }

  const facilities = await prisma.loanFacility.findMany({
    where: {
      ...(query.borrowerId ? { borrowerId: query.borrowerId } : {}),
      ...(query.loanProductId ? { loanProductId: query.loanProductId } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  const totals = await disbursedTotalsByFacility(facilities.map((facility) => facility.id));

  return facilities.map((facility) =>
    serializeFacility(facility, totals.get(facility.id) ?? new Decimal(0)),
  );
}

export async function getLoanFacilityById(facilityId: string) {
  const facility = await getRequiredFacility(facilityId);
  const totalDisbursed = await sumDisbursements(prisma, facilityId);
  return serializeFacility(facility, totalDisbursed);
}

export async function createLoanDisbursement(facilityId: string, input: CreateLoanDisbursementInput) {
  const amount = parsePositiveMoneyString(input.amount, "amount");
  if (!isIsoCalendarDate(input.disbursementDate)) {
    throw new AppError(400, "disbursementDate must be a valid calendar date", "VALIDATION_ERROR");
  }

  const today = utcTodayDateString();
  if (input.disbursementDate > today) {
    throw new AppError(400, "disbursementDate must not be in the future", "VALIDATION_ERROR");
  }

  const businessDate = dateOnly(input.disbursementDate);
  const disbursement = await prisma.$transaction(async (tx) => {
    const facility = await lockFacility(tx, facilityId);
    if (input.disbursementDate < facility.facilityDate) {
      throw new AppError(
        400,
        "disbursementDate must not be earlier than the facility date",
        "VALIDATION_ERROR",
      );
    }

    assertDisbursableStatus(facility.status);

    const authorized = new Decimal(facility.authorizedPrincipalAmount);
    const alreadyDisbursed = await sumDisbursements(tx, facilityId);
    const remaining = authorized.minus(alreadyDisbursed);
    if (remaining.lessThanOrEqualTo(0)) {
      throw new AppError(
        409,
        "No remaining authorized amount is available for disbursement",
        "CONFLICT",
      );
    }
    if (amount.greaterThan(remaining)) {
      throw new AppError(409, "Disbursement amount exceeds the remaining authorized amount", "CONFLICT");
    }

    const created = await tx.loanDisbursement.create({
      data: {
        loanFacilityId: facilityId,
        amount,
        disbursementDate: businessDate,
        reference: input.reference ?? null,
        remarks: input.remarks ?? null,
      },
    });

    await tx.loanTransaction.create({
      data: {
        loanFacilityId: facilityId,
        type: "DISBURSEMENT",
        principalAmount: amount,
        transactionDate: businessDate,
        loanDisbursementId: created.id,
      },
    });

    if (facility.status === "PENDING_DISBURSEMENT") {
      await tx.loanFacility.update({
        where: { id: facilityId },
        data: { status: "ACTIVE" },
      });
    }

    return created;
  }, { maxWait: 15_000, timeout: 15_000 });

  return serializeDisbursement(disbursement);
}

/** Business-date order, then system time, then id. */
const disbursementHistoryOrder = [
  { disbursementDate: "asc" as const },
  { createdAt: "asc" as const },
  { id: "asc" as const },
];

/**
 * Financial history order: transactionDate ascending, then createdAt ascending, then id ascending.
 * Same-day entries stay in the order they were recorded.
 */
const transactionHistoryOrder = [
  { transactionDate: "asc" as const },
  { createdAt: "asc" as const },
  { id: "asc" as const },
];

export async function listLoanDisbursements(facilityId: string) {
  await getRequiredFacility(facilityId);
  const disbursements = await prisma.loanDisbursement.findMany({
    where: { loanFacilityId: facilityId },
    orderBy: disbursementHistoryOrder,
  });
  return disbursements.map(serializeDisbursement);
}

export async function getLoanDisbursement(facilityId: string, disbursementId: string) {
  await getRequiredFacility(facilityId);
  const disbursement = await prisma.loanDisbursement.findFirst({
    where: { id: disbursementId, loanFacilityId: facilityId },
  });
  if (!disbursement) {
    throw new AppError(404, "Loan disbursement not found", "NOT_FOUND");
  }
  return serializeDisbursement(disbursement);
}

export async function listLoanTransactions(facilityId: string) {
  await getRequiredFacility(facilityId);
  const transactions = await prisma.loanTransaction.findMany({
    where: { loanFacilityId: facilityId },
    orderBy: transactionHistoryOrder,
  });
  return transactions.map(serializeTransaction);
}

export async function getLoanTransaction(facilityId: string, transactionId: string) {
  await getRequiredFacility(facilityId);
  const transaction = await prisma.loanTransaction.findFirst({
    where: { id: transactionId, loanFacilityId: facilityId },
  });
  if (!transaction) {
    throw new AppError(404, "Loan transaction not found", "NOT_FOUND");
  }
  return serializeTransaction(transaction);
}
