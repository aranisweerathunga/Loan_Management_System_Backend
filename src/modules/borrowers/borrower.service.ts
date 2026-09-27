import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { formatMoney, parseNonNegativeMoneyString } from "../../shared/money/decimal.js";
import type {
  CreateBorrowerInput,
  CreateEmployeeProfileInput,
  CreateEmploymentHistoryInput,
  CreateEpfBalanceInput,
  CreateGradeHistoryInput,
  CreateIdentifierInput,
  UpdateBorrowerInput,
  UpdateEmployeeProfileInput,
  UpdateIdentifierInput,
} from "./borrower.schemas.js";

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function serializeBorrower(borrower: {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: Date | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...borrower,
    dateOfBirth: borrower.dateOfBirth ? toDateOnlyString(borrower.dateOfBirth) : null,
  };
}

function serializeDatedRecord<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(record: T) {
  return {
    ...record,
    effectiveFrom: toDateOnlyString(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? toDateOnlyString(record.effectiveTo) : null,
  };
}

function serializeEpfBalance(record: {
  id: string;
  employeeProfileId: string;
  balance: Prisma.Decimal;
  asOfDate: Date;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...record,
    balance: formatMoney(record.balance),
    asOfDate: toDateOnlyString(record.asOfDate),
  };
}

async function getRequiredBorrower(borrowerId: string) {
  const borrower = await prisma.borrower.findUnique({ where: { id: borrowerId } });
  if (!borrower) {
    throw new AppError(404, "Borrower not found", "NOT_FOUND");
  }
  return borrower;
}

async function getRequiredIdentifier(borrowerId: string, identifierId: string) {
  const identifier = await prisma.borrowerIdentifier.findFirst({
    where: { id: identifierId, borrowerId },
  });
  if (!identifier) {
    throw new AppError(404, "Borrower identifier not found", "NOT_FOUND");
  }
  return identifier;
}

async function getRequiredEmployeeProfile(borrowerId: string) {
  await getRequiredBorrower(borrowerId);
  const profile = await prisma.employeeProfile.findUnique({ where: { borrowerId } });
  if (!profile) {
    throw new AppError(404, "Employee profile not found", "NOT_FOUND");
  }
  return profile;
}

export async function createBorrower(input: CreateBorrowerInput) {
  const borrower = await prisma.borrower.create({
    data: {
      firstName: input.firstName,
      middleName: input.middleName ?? null,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth ? dateOnly(input.dateOfBirth) : null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return serializeBorrower(borrower);
}

export async function listBorrowers() {
  const borrowers = await prisma.borrower.findMany({ orderBy: { createdAt: "asc" } });
  return borrowers.map(serializeBorrower);
}

export async function getBorrowerById(borrowerId: string) {
  const borrower = await prisma.borrower.findUnique({
    where: { id: borrowerId },
    include: {
      identifiers: { orderBy: { createdAt: "asc" } },
      employeeProfile: true,
    },
  });
  if (!borrower) {
    throw new AppError(404, "Borrower not found", "NOT_FOUND");
  }

  return {
    ...serializeBorrower(borrower),
    identifiers: borrower.identifiers,
    employeeProfile: borrower.employeeProfile,
  };
}

export async function updateBorrower(borrowerId: string, input: UpdateBorrowerInput) {
  await getRequiredBorrower(borrowerId);
  const borrower = await prisma.borrower.update({
    where: { id: borrowerId },
    data: {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.middleName !== undefined ? { middleName: input.middleName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.dateOfBirth !== undefined
        ? { dateOfBirth: input.dateOfBirth ? dateOnly(input.dateOfBirth) : null }
        : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return serializeBorrower(borrower);
}

export async function createIdentifier(borrowerId: string, input: CreateIdentifierInput) {
  await getRequiredBorrower(borrowerId);
  return prisma.borrowerIdentifier.create({
    data: {
      borrowerId,
      type: input.type,
      value: input.value,
      isPrimary: input.isPrimary ?? false,
    },
  });
}

export async function listIdentifiers(borrowerId: string) {
  await getRequiredBorrower(borrowerId);
  return prisma.borrowerIdentifier.findMany({
    where: { borrowerId },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateIdentifier(
  borrowerId: string,
  identifierId: string,
  input: UpdateIdentifierInput,
) {
  await getRequiredIdentifier(borrowerId, identifierId);
  return prisma.borrowerIdentifier.update({
    where: { id: identifierId },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
    },
  });
}

export async function createEmployeeProfile(borrowerId: string, input: CreateEmployeeProfileInput) {
  await getRequiredBorrower(borrowerId);
  const existing = await prisma.employeeProfile.findUnique({ where: { borrowerId } });
  if (existing) {
    throw new AppError(409, "Borrower already has an employee profile", "CONFLICT");
  }

  return prisma.employeeProfile.create({
    data: {
      borrowerId,
      isActive: input.isActive ?? true,
    },
  });
}

export async function getEmployeeProfile(borrowerId: string) {
  return getRequiredEmployeeProfile(borrowerId);
}

export async function updateEmployeeProfile(borrowerId: string, input: UpdateEmployeeProfileInput) {
  const profile = await getRequiredEmployeeProfile(borrowerId);
  return prisma.employeeProfile.update({
    where: { id: profile.id },
    data: {
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function createEmploymentHistory(borrowerId: string, input: CreateEmploymentHistoryInput) {
  const profile = await getRequiredEmployeeProfile(borrowerId);
  const record = await prisma.employmentHistory.create({
    data: {
      employeeProfileId: profile.id,
      status: input.status,
      effectiveFrom: dateOnly(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null,
    },
  });
  return serializeDatedRecord(record);
}

export async function listEmploymentHistory(borrowerId: string) {
  const profile = await getRequiredEmployeeProfile(borrowerId);
  const records = await prisma.employmentHistory.findMany({
    where: { employeeProfileId: profile.id },
    orderBy: { effectiveFrom: "asc" },
  });
  return records.map(serializeDatedRecord);
}

export async function createGradeHistory(borrowerId: string, input: CreateGradeHistoryInput) {
  const profile = await getRequiredEmployeeProfile(borrowerId);
  const grade = await prisma.grade.findUnique({ where: { id: input.gradeId } });
  if (!grade) {
    throw new AppError(404, "Grade not found", "NOT_FOUND");
  }

  const record = await prisma.gradeHistory.create({
    data: {
      employeeProfileId: profile.id,
      gradeId: input.gradeId,
      effectiveFrom: dateOnly(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null,
    },
    include: { grade: true },
  });
  return serializeDatedRecord(record);
}

export async function listGradeHistory(borrowerId: string) {
  const profile = await getRequiredEmployeeProfile(borrowerId);
  const records = await prisma.gradeHistory.findMany({
    where: { employeeProfileId: profile.id },
    include: { grade: true },
    orderBy: { effectiveFrom: "asc" },
  });
  return records.map(serializeDatedRecord);
}

export async function createEpfBalance(borrowerId: string, input: CreateEpfBalanceInput) {
  const profile = await getRequiredEmployeeProfile(borrowerId);
  const balance = parseNonNegativeMoneyString(input.balance);
  const record = await prisma.epfBalanceHistory.create({
    data: {
      employeeProfileId: profile.id,
      balance,
      asOfDate: dateOnly(input.asOfDate),
      source: input.source,
    },
  });
  return serializeEpfBalance(record);
}

export async function listEpfBalances(borrowerId: string) {
  const profile = await getRequiredEmployeeProfile(borrowerId);
  const records = await prisma.epfBalanceHistory.findMany({
    where: { employeeProfileId: profile.id },
    orderBy: { asOfDate: "desc" },
  });
  return records.map(serializeEpfBalance);
}
