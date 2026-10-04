import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { Decimal, formatMoney, parsePositiveMoneyString } from "../../shared/money/decimal.js";
import type {
  ApproveLoanApplicationInput,
  CreateLoanApplicationInput,
  ListLoanApplicationsQuery,
  UpdateDraftLoanApplicationInput,
} from "./loan-application.schemas.js";

type DbClient = Prisma.TransactionClient;

const applicationListInclude = {
  borrower: {
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      isActive: true,
    },
  },
  loanProduct: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
  },
  productVersion: {
    select: {
      id: true,
      versionNumber: true,
      status: true,
    },
  },
  productPurpose: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
  },
} as const;

const applicationDetailInclude = {
  ...applicationListInclude,
  eligibilityAssessments: {
    select: {
      id: true,
      loanApplicationId: true,
      productVersionId: true,
      status: true,
      assessedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  facility: {
    select: {
      id: true,
      facilityNumber: true,
      status: true,
    },
  },
};

function serializeApplication<T extends Prisma.LoanApplicationGetPayload<{ include: typeof applicationListInclude }>>(
  application: T,
) {
  return {
    id: application.id,
    applicationNumber: application.applicationNumber,
    borrowerId: application.borrowerId,
    loanProductId: application.loanProductId,
    productVersionId: application.productVersionId,
    productPurposeId: application.productPurposeId,
    status: application.status,
    submittedAt: application.submittedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    borrower: application.borrower,
    loanProduct: application.loanProduct,
    productVersion: application.productVersion,
    productPurpose: application.productPurpose,
  };
}

function serializeApplicationDetail(
  application: Prisma.LoanApplicationGetPayload<{ include: typeof applicationDetailInclude }>,
) {
  return {
    ...serializeApplication(application),
    eligibilityAssessments: application.eligibilityAssessments,
    facility: application.facility
      ? {
          id: application.facility.id,
          facilityNumber: application.facility.facilityNumber,
          status: application.facility.status,
        }
      : null,
  };
}

function serializeDecision(decision: {
  id: string;
  loanApplicationId: string;
  decision: "APPROVED" | "REJECTED";
  remarks: string | null;
  authorizedPrincipalAmount: { toFixed: (digits: number) => string } | null;
  decidedAt: Date;
  createdAt: Date;
}) {
  return {
    id: decision.id,
    loanApplicationId: decision.loanApplicationId,
    decision: decision.decision,
    remarks: decision.remarks,
    authorizedPrincipalAmount: decision.authorizedPrincipalAmount
      ? formatMoney(decision.authorizedPrincipalAmount)
      : null,
    decidedAt: decision.decidedAt,
    createdAt: decision.createdAt,
  };
}

function formatApplicationNumber(calendarYear: number, lastValue: number): string {
  return `LA-${calendarYear}-${String(lastValue).padStart(6, "0")}`;
}

function currentCalendarYearUtc(): number {
  return new Date().getUTCFullYear();
}

async function allocateApplicationNumber(tx: DbClient): Promise<string> {
  const calendarYear = currentCalendarYearUtc();
  const rows = await tx.$queryRaw<Array<{ lastValue: number | bigint | string }>>`
    INSERT INTO "LoanApplicationNumberSequence" ("calendarYear", "lastValue")
    VALUES (${calendarYear}, 1)
    ON CONFLICT ("calendarYear")
    DO UPDATE SET "lastValue" = "LoanApplicationNumberSequence"."lastValue" + 1
    RETURNING "lastValue"
  `;

  const lastValue = Number(rows[0]?.lastValue);
  if (!Number.isInteger(lastValue) || lastValue < 1) {
    throw new AppError(500, "Failed to allocate application number", "INTERNAL_SERVER_ERROR");
  }

  return formatApplicationNumber(calendarYear, lastValue);
}

type SelectableConfigurationInput = {
  borrowerId: string;
  loanProductId: string;
  productVersionId: string;
  productPurposeId: string | null;
};

async function assertSelectableConfiguration(
  tx: DbClient,
  input: SelectableConfigurationInput,
): Promise<void> {
  const borrower = await tx.borrower.findUnique({ where: { id: input.borrowerId } });
  if (!borrower) {
    throw new AppError(404, "Borrower not found", "NOT_FOUND");
  }
  if (!borrower.isActive) {
    throw new AppError(409, "Inactive borrowers cannot be selected for an application", "CONFLICT");
  }

  const loanProduct = await tx.loanProduct.findUnique({ where: { id: input.loanProductId } });
  if (!loanProduct) {
    throw new AppError(404, "Loan product not found", "NOT_FOUND");
  }
  if (!loanProduct.isActive) {
    throw new AppError(409, "Inactive loan products cannot be selected for an application", "CONFLICT");
  }

  const productVersion = await tx.productVersion.findUnique({
    where: { id: input.productVersionId },
  });
  if (!productVersion) {
    throw new AppError(404, "Product version not found", "NOT_FOUND");
  }
  if (productVersion.loanProductId !== input.loanProductId) {
    throw new AppError(
      409,
      "Product version does not belong to the selected loan product",
      "CONFLICT",
    );
  }
  if (productVersion.status !== "ACTIVE") {
    throw new AppError(
      409,
      "Only ACTIVE product versions can be selected for an application",
      "INVALID_STATE",
    );
  }

  if (input.productPurposeId) {
    const productPurpose = await tx.productPurpose.findUnique({
      where: { id: input.productPurposeId },
    });
    if (!productPurpose) {
      throw new AppError(404, "Product purpose not found", "NOT_FOUND");
    }
    if (productPurpose.loanProductId !== input.loanProductId) {
      throw new AppError(
        409,
        "Product purpose does not belong to the selected loan product",
        "CONFLICT",
      );
    }
    if (!productPurpose.isActive) {
      throw new AppError(
        409,
        "Inactive product purposes cannot be selected for an application",
        "CONFLICT",
      );
    }
  }
}

async function getRequiredApplication(applicationId: string) {
  const application = await prisma.loanApplication.findUnique({
    where: { id: applicationId },
    include: applicationDetailInclude,
  });
  if (!application) {
    throw new AppError(404, "Loan application not found", "NOT_FOUND");
  }
  return application;
}

export async function createLoanApplication(input: CreateLoanApplicationInput) {
  const productPurposeId = input.productPurposeId ?? null;

  const application = await prisma.$transaction(async (tx) => {
    await assertSelectableConfiguration(tx, {
      borrowerId: input.borrowerId,
      loanProductId: input.loanProductId,
      productVersionId: input.productVersionId,
      productPurposeId,
    });

    const applicationNumber = await allocateApplicationNumber(tx);
    const created = await tx.loanApplication.create({
      data: {
        applicationNumber,
        borrowerId: input.borrowerId,
        loanProductId: input.loanProductId,
        productVersionId: input.productVersionId,
        productPurposeId,
        status: "DRAFT",
      },
    });

    await tx.applicationStatusHistory.create({
      data: {
        loanApplicationId: created.id,
        fromStatus: null,
        toStatus: "DRAFT",
      },
    });

    return tx.loanApplication.findUniqueOrThrow({
      where: { id: created.id },
      include: applicationDetailInclude,
    });
  });

  return serializeApplicationDetail(application);
}

export async function listLoanApplications(query: ListLoanApplicationsQuery) {
  if (query.borrowerId) {
    const borrower = await prisma.borrower.findUnique({ where: { id: query.borrowerId } });
    if (!borrower) {
      throw new AppError(404, "Borrower not found", "NOT_FOUND");
    }
  }

  if (query.loanProductId) {
    const loanProduct = await prisma.loanProduct.findUnique({ where: { id: query.loanProductId } });
    if (!loanProduct) {
      throw new AppError(404, "Loan product not found", "NOT_FOUND");
    }
  }

  const applications = await prisma.loanApplication.findMany({
    where: {
      ...(query.borrowerId ? { borrowerId: query.borrowerId } : {}),
      ...(query.loanProductId ? { loanProductId: query.loanProductId } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    include: applicationListInclude,
    orderBy: { createdAt: "desc" },
  });

  return applications.map(serializeApplication);
}

export async function getLoanApplicationById(applicationId: string) {
  return serializeApplicationDetail(await getRequiredApplication(applicationId));
}

export async function updateDraftLoanApplication(
  applicationId: string,
  input: UpdateDraftLoanApplicationInput,
) {
  const application = await prisma.$transaction(async (tx) => {
    const current = await tx.loanApplication.findUnique({ where: { id: applicationId } });
    if (!current) {
      throw new AppError(404, "Loan application not found", "NOT_FOUND");
    }
    if (current.status !== "DRAFT") {
      throw new AppError(
        409,
        "Only DRAFT loan applications can be edited",
        "INVALID_STATE",
      );
    }

    const nextSelection: SelectableConfigurationInput = {
      borrowerId: input.borrowerId ?? current.borrowerId,
      loanProductId: input.loanProductId ?? current.loanProductId,
      productVersionId: input.productVersionId ?? current.productVersionId,
      productPurposeId:
        input.productPurposeId === undefined ? current.productPurposeId : input.productPurposeId,
    };

    await assertSelectableConfiguration(tx, nextSelection);

    await tx.loanApplication.update({
      where: { id: applicationId },
      data: {
        borrowerId: nextSelection.borrowerId,
        loanProductId: nextSelection.loanProductId,
        productVersionId: nextSelection.productVersionId,
        productPurposeId: nextSelection.productPurposeId,
      },
    });

    return tx.loanApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: applicationDetailInclude,
    });
  });

  return serializeApplicationDetail(application);
}

export async function listApplicationStatusHistory(applicationId: string) {
  await getRequiredApplication(applicationId);

  return prisma.applicationStatusHistory.findMany({
    where: { loanApplicationId: applicationId },
    orderBy: { changedAt: "asc" },
  });
}

export async function submitLoanApplication(applicationId: string) {
  const application = await prisma.$transaction(async (tx) => {
    const current = await tx.loanApplication.findUnique({ where: { id: applicationId } });
    if (!current) {
      throw new AppError(404, "Loan application not found", "NOT_FOUND");
    }
    if (current.status !== "DRAFT") {
      throw new AppError(
        409,
        "Only DRAFT loan applications can be submitted",
        "INVALID_STATE",
      );
    }

    await assertSelectableConfiguration(tx, {
      borrowerId: current.borrowerId,
      loanProductId: current.loanProductId,
      productVersionId: current.productVersionId,
      productPurposeId: current.productPurposeId,
    });

    await tx.loanApplication.update({
      where: { id: applicationId },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    await tx.applicationStatusHistory.create({
      data: {
        loanApplicationId: applicationId,
        fromStatus: "DRAFT",
        toStatus: "SUBMITTED",
      },
    });

    return tx.loanApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: applicationDetailInclude,
    });
  });

  return serializeApplicationDetail(application);
}

export async function startReview(applicationId: string) {
  const application = await prisma.$transaction(async (tx) => {
    const current = await tx.loanApplication.findUnique({ where: { id: applicationId } });
    if (!current) {
      throw new AppError(404, "Loan application not found", "NOT_FOUND");
    }
    if (current.status !== "SUBMITTED") {
      throw new AppError(
        409,
        "Only SUBMITTED loan applications can be moved to under review",
        "INVALID_STATE",
      );
    }

    await tx.loanApplication.update({
      where: { id: applicationId },
      data: { status: "UNDER_REVIEW" },
    });

    await tx.applicationStatusHistory.create({
      data: {
        loanApplicationId: applicationId,
        fromStatus: "SUBMITTED",
        toStatus: "UNDER_REVIEW",
      },
    });

    return tx.loanApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: applicationDetailInclude,
    });
  });

  return serializeApplicationDetail(application);
}

/**
 * Actor identity is not recorded. Authentication does not exist yet, so
 * no-self-approval cannot be enforced. A later migration can add an
 * authenticated actor reference on ApplicationDecision without changing
 * the decision itself. Eligibility assessments are not consulted.
 */
async function recordTerminalDecision(
  applicationId: string,
  decision: "APPROVED" | "REJECTED",
  remarks: string | null,
  authorizedPrincipalAmount: Decimal | null,
) {
  const action = decision === "APPROVED" ? "approved" : "rejected";

  const application = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"::text AS "status"
      FROM "LoanApplication"
      WHERE "id" = ${applicationId}
      FOR UPDATE
    `;
    const current = locked[0];
    if (!current) {
      throw new AppError(404, "Loan application not found", "NOT_FOUND");
    }
    if (current.status !== "UNDER_REVIEW") {
      throw new AppError(
        409,
        `Only UNDER_REVIEW loan applications can be ${action}`,
        "INVALID_STATE",
      );
    }

    if (decision === "APPROVED" && authorizedPrincipalAmount === null) {
      throw new AppError(
        500,
        "Approved decisions require an authorized principal amount",
        "INTERNAL_SERVER_ERROR",
      );
    }

    const decidedAt = new Date();

    await tx.loanApplication.update({
      where: { id: applicationId },
      data: { status: decision },
    });

    await tx.applicationStatusHistory.create({
      data: {
        loanApplicationId: applicationId,
        fromStatus: "UNDER_REVIEW",
        toStatus: decision,
        changedAt: decidedAt,
      },
    });

    await tx.applicationDecision.create({
      data: {
        loanApplicationId: applicationId,
        decision,
        remarks,
        authorizedPrincipalAmount: decision === "APPROVED" ? authorizedPrincipalAmount : null,
        decidedAt,
      },
    });

    return tx.loanApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: applicationDetailInclude,
    });
  });

  return serializeApplicationDetail(application);
}

export async function approveLoanApplication(
  applicationId: string,
  input: ApproveLoanApplicationInput,
) {
  const authorizedPrincipalAmount = parsePositiveMoneyString(
    input.authorizedPrincipalAmount,
    "authorizedPrincipalAmount",
  );
  return recordTerminalDecision(
    applicationId,
    "APPROVED",
    input.remarks ?? null,
    authorizedPrincipalAmount,
  );
}

export async function rejectLoanApplication(applicationId: string, remarks: string) {
  return recordTerminalDecision(applicationId, "REJECTED", remarks, null);
}

/** Newest first: decidedAt descending, then id descending. */
export async function listApplicationDecisions(applicationId: string) {
  await getRequiredApplication(applicationId);

  const decisions = await prisma.applicationDecision.findMany({
    where: { loanApplicationId: applicationId },
    orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
  });
  return decisions.map(serializeDecision);
}

export async function getApplicationDecision(applicationId: string, decisionId: string) {
  await getRequiredApplication(applicationId);

  const decision = await prisma.applicationDecision.findFirst({
    where: { id: decisionId, loanApplicationId: applicationId },
  });
  if (!decision) {
    throw new AppError(404, "Application decision not found", "NOT_FOUND");
  }

  return serializeDecision(decision);
}
