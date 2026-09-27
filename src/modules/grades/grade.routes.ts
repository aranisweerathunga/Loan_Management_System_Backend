import { Router } from "express";
import { validateBody, validateParams } from "../../shared/middleware/validate.js";
import * as gradeController from "./grade.controller.js";
import { createGradeSchema, gradeIdParamSchema, updateGradeSchema } from "./grade.schemas.js";

export const gradeRouter = Router();

gradeRouter.post("/grades", validateBody(createGradeSchema), gradeController.createGrade);
gradeRouter.get("/grades", gradeController.listGrades);
gradeRouter.get("/grades/:gradeId", validateParams(gradeIdParamSchema), gradeController.getGrade);
gradeRouter.patch(
  "/grades/:gradeId",
  validateParams(gradeIdParamSchema),
  validateBody(updateGradeSchema),
  gradeController.updateGrade,
);
