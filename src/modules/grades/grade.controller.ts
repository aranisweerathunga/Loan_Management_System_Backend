import type { Request, Response } from "express";
import * as gradeService from "./grade.service.js";
import type { CreateGradeInput, UpdateGradeInput } from "./grade.schemas.js";

export async function createGrade(req: Request, res: Response): Promise<void> {
  const grade = await gradeService.createGrade(req.body as CreateGradeInput);
  res.status(201).json({ data: grade });
}

export async function listGrades(_req: Request, res: Response): Promise<void> {
  const grades = await gradeService.listGrades();
  res.status(200).json({ data: grades });
}

export async function getGrade(req: Request, res: Response): Promise<void> {
  const grade = await gradeService.getGradeById(req.params.gradeId as string);
  res.status(200).json({ data: grade });
}

export async function updateGrade(req: Request, res: Response): Promise<void> {
  const grade = await gradeService.updateGrade(
    req.params.gradeId as string,
    req.body as UpdateGradeInput,
  );
  res.status(200).json({ data: grade });
}
