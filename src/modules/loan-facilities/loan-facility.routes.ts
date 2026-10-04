import { Router } from "express";
import { applicationIdParamSchema } from "../loan-applications/loan-application.schemas.js";
import { validateBody, validateParams, validateQuery } from "../../shared/middleware/validate.js";
import * as loanFacilityController from "./loan-facility.controller.js";
import {
  createLoanDisbursementSchema,
  createLoanFacilitySchema,
  disbursementIdParamSchema,
  facilityIdParamSchema,
  listLoanFacilitiesQuerySchema,
  transactionIdParamSchema,
} from "./loan-facility.schemas.js";

export const loanFacilityRouter = Router();

loanFacilityRouter.post(
  "/loan-applications/:applicationId/facility",
  validateParams(applicationIdParamSchema),
  validateBody(createLoanFacilitySchema),
  loanFacilityController.createLoanFacility,
);

loanFacilityRouter.get(
  "/loan-facilities",
  validateQuery(listLoanFacilitiesQuerySchema),
  loanFacilityController.listLoanFacilities,
);
loanFacilityRouter.get(
  "/loan-facilities/:facilityId",
  validateParams(facilityIdParamSchema),
  loanFacilityController.getLoanFacility,
);

loanFacilityRouter.post(
  "/loan-facilities/:facilityId/disbursements",
  validateParams(facilityIdParamSchema),
  validateBody(createLoanDisbursementSchema),
  loanFacilityController.createLoanDisbursement,
);
loanFacilityRouter.get(
  "/loan-facilities/:facilityId/disbursements",
  validateParams(facilityIdParamSchema),
  loanFacilityController.listLoanDisbursements,
);
loanFacilityRouter.get(
  "/loan-facilities/:facilityId/disbursements/:disbursementId",
  validateParams(disbursementIdParamSchema),
  loanFacilityController.getLoanDisbursement,
);

loanFacilityRouter.get(
  "/loan-facilities/:facilityId/transactions",
  validateParams(facilityIdParamSchema),
  loanFacilityController.listLoanTransactions,
);
loanFacilityRouter.get(
  "/loan-facilities/:facilityId/transactions/:transactionId",
  validateParams(transactionIdParamSchema),
  loanFacilityController.getLoanTransaction,
);
