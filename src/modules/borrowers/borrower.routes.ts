import { Router } from "express";
import { validateBody, validateParams } from "../../shared/middleware/validate.js";
import * as borrowerController from "./borrower.controller.js";
import {
  borrowerIdParamSchema,
  createBorrowerSchema,
  createEmployeeProfileSchema,
  createEmploymentHistorySchema,
  createEpfBalanceSchema,
  createGradeHistorySchema,
  createIdentifierSchema,
  identifierIdParamSchema,
  updateBorrowerSchema,
  updateEmployeeProfileSchema,
  updateIdentifierSchema,
} from "./borrower.schemas.js";

export const borrowerRouter = Router();

borrowerRouter.post("/borrowers", validateBody(createBorrowerSchema), borrowerController.createBorrower);
borrowerRouter.get("/borrowers", borrowerController.listBorrowers);
borrowerRouter.get(
  "/borrowers/:borrowerId",
  validateParams(borrowerIdParamSchema),
  borrowerController.getBorrower,
);
borrowerRouter.patch(
  "/borrowers/:borrowerId",
  validateParams(borrowerIdParamSchema),
  validateBody(updateBorrowerSchema),
  borrowerController.updateBorrower,
);

borrowerRouter.post(
  "/borrowers/:borrowerId/identifiers",
  validateParams(borrowerIdParamSchema),
  validateBody(createIdentifierSchema),
  borrowerController.createIdentifier,
);
borrowerRouter.get(
  "/borrowers/:borrowerId/identifiers",
  validateParams(borrowerIdParamSchema),
  borrowerController.listIdentifiers,
);
borrowerRouter.patch(
  "/borrowers/:borrowerId/identifiers/:identifierId",
  validateParams(identifierIdParamSchema),
  validateBody(updateIdentifierSchema),
  borrowerController.updateIdentifier,
);

borrowerRouter.post(
  "/borrowers/:borrowerId/employee-profile",
  validateParams(borrowerIdParamSchema),
  validateBody(createEmployeeProfileSchema),
  borrowerController.createEmployeeProfile,
);
borrowerRouter.get(
  "/borrowers/:borrowerId/employee-profile",
  validateParams(borrowerIdParamSchema),
  borrowerController.getEmployeeProfile,
);
borrowerRouter.patch(
  "/borrowers/:borrowerId/employee-profile",
  validateParams(borrowerIdParamSchema),
  validateBody(updateEmployeeProfileSchema),
  borrowerController.updateEmployeeProfile,
);

borrowerRouter.post(
  "/borrowers/:borrowerId/employment-history",
  validateParams(borrowerIdParamSchema),
  validateBody(createEmploymentHistorySchema),
  borrowerController.createEmploymentHistory,
);
borrowerRouter.get(
  "/borrowers/:borrowerId/employment-history",
  validateParams(borrowerIdParamSchema),
  borrowerController.listEmploymentHistory,
);

borrowerRouter.post(
  "/borrowers/:borrowerId/grade-history",
  validateParams(borrowerIdParamSchema),
  validateBody(createGradeHistorySchema),
  borrowerController.createGradeHistory,
);
borrowerRouter.get(
  "/borrowers/:borrowerId/grade-history",
  validateParams(borrowerIdParamSchema),
  borrowerController.listGradeHistory,
);

borrowerRouter.post(
  "/borrowers/:borrowerId/epf-balances",
  validateParams(borrowerIdParamSchema),
  validateBody(createEpfBalanceSchema),
  borrowerController.createEpfBalance,
);
borrowerRouter.get(
  "/borrowers/:borrowerId/epf-balances",
  validateParams(borrowerIdParamSchema),
  borrowerController.listEpfBalances,
);
