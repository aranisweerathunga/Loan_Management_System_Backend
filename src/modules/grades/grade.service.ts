import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { CreateGradeInput, UpdateGradeInput } from "./grade.schemas.js";

async function getRequiredGrade(gradeId: string) {
  const grade = await prisma.grade.findUnique({ where: { id: gradeId } });
  if (!grade) {
    throw new AppError(404, "Grade not found", "NOT_FOUND");
  }
  return grade;
}

export async function createGrade(input: CreateGradeInput) {
  return prisma.grade.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
    },
  });
}

export async function listGrades() {
  return prisma.grade.findMany({ orderBy: { createdAt: "asc" } });
}

export async function getGradeById(gradeId: string) {
  return getRequiredGrade(gradeId);
}

export async function updateGrade(gradeId: string, input: UpdateGradeInput) {
  await getRequiredGrade(gradeId);
  return prisma.grade.update({
    where: { id: gradeId },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}
