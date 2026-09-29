import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { buildEligibilitySnapshots } from "./eligibility.engine.js";
import type { AssessmentSubject } from "./eligibility.types.js";

const subjectInclude = {
  borrower: {
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
    },
  },
  loanProduct: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  productVersion: {
    select: {
      id: true,
      versionNumber: true,
      status: true,
      configuration: true,
    },
  },
  productPurpose: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
} as const;

function serializeAssessment(assessment: {
  id: string;
  loanApplicationId: string;
  productVersionId: string;
  status: string;
  inputSnapshot: Prisma.JsonValue;
  ruleSnapshot: Prisma.JsonValue;
  resultSnapshot: Prisma.JsonValue | null;
  assessedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return assessment;
}

async function requireApplication(applicationId: string): Promise<void> {
  const application = await prisma.loanApplication.findUnique({
    where: { id: applicationId },
    select: { id: true },
  });
  if (!application) {
    throw new AppError(404, "Loan application not found", "NOT_FOUND");
  }
}

export async function createEligibilityAssessment(applicationId: string) {
  const assessment = await prisma.$transaction(async (tx) => {
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
        "Only UNDER_REVIEW loan applications can be assessed",
        "INVALID_STATE",
      );
    }

    const application = await tx.loanApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: subjectInclude,
    });
    if (application.status !== "UNDER_REVIEW") {
      throw new AppError(
        409,
        "Only UNDER_REVIEW loan applications can be assessed",
        "INVALID_STATE",
      );
    }

    const subject: AssessmentSubject = {
      application: {
        id: application.id,
        applicationNumber: application.applicationNumber,
        status: "UNDER_REVIEW",
        borrowerId: application.borrowerId,
        loanProductId: application.loanProductId,
        productVersionId: application.productVersionId,
        productPurposeId: application.productPurposeId,
      },
      borrower: application.borrower,
      loanProduct: application.loanProduct,
      productVersion: {
        id: application.productVersion.id,
        versionNumber: application.productVersion.versionNumber,
        status: application.productVersion.status,
      },
      productPurpose: application.productPurpose,
    };

    const snapshots = buildEligibilitySnapshots(application.productVersion.configuration, subject);

    return tx.eligibilityAssessment.create({
      data: {
        loanApplicationId: application.id,
        productVersionId: application.productVersionId,
        status: "COMPLETED",
        inputSnapshot: snapshots.inputSnapshot as Prisma.InputJsonValue,
        ruleSnapshot: snapshots.ruleSnapshot as Prisma.InputJsonValue,
        resultSnapshot: snapshots.resultSnapshot as Prisma.InputJsonValue,
        assessedAt: new Date(),
      },
    });
  });

  return serializeAssessment(assessment);
}

/** Newest first: createdAt descending, then id descending. */
export async function listEligibilityAssessments(applicationId: string) {
  await requireApplication(applicationId);
  const assessments = await prisma.eligibilityAssessment.findMany({
    where: { loanApplicationId: applicationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return assessments.map(serializeAssessment);
}

export async function getEligibilityAssessment(applicationId: string, assessmentId: string) {
  await requireApplication(applicationId);
  const assessment = await prisma.eligibilityAssessment.findFirst({
    where: { id: assessmentId, loanApplicationId: applicationId },
  });
  if (!assessment) {
    throw new AppError(404, "Eligibility assessment not found", "NOT_FOUND");
  }
  return serializeAssessment(assessment);
}
