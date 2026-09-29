import { Router } from "express";
import { assessmentIdParamSchema } from "../eligibility/eligibility.schemas.js";
import * as eligibilityController from "../eligibility/eligibility.controller.js";
import { validateBody, validateParams, validateQuery } from "../../shared/middleware/validate.js";
import * as loanApplicationController from "./loan-application.controller.js";
import {
  applicationIdParamSchema,
  createLoanApplicationSchema,
  listLoanApplicationsQuerySchema,
  updateDraftLoanApplicationSchema,
} from "./loan-application.schemas.js";

export const loanApplicationRouter = Router();

loanApplicationRouter.post(
  "/loan-applications",
  validateBody(createLoanApplicationSchema),
  loanApplicationController.createLoanApplication,
);
loanApplicationRouter.get(
  "/loan-applications",
  validateQuery(listLoanApplicationsQuerySchema),
  loanApplicationController.listLoanApplications,
);
loanApplicationRouter.get(
  "/loan-applications/:applicationId",
  validateParams(applicationIdParamSchema),
  loanApplicationController.getLoanApplication,
);
loanApplicationRouter.patch(
  "/loan-applications/:applicationId",
  validateParams(applicationIdParamSchema),
  validateBody(updateDraftLoanApplicationSchema),
  loanApplicationController.updateDraftLoanApplication,
);
loanApplicationRouter.get(
  "/loan-applications/:applicationId/status-history",
  validateParams(applicationIdParamSchema),
  loanApplicationController.listApplicationStatusHistory,
);
loanApplicationRouter.post(
  "/loan-applications/:applicationId/submit",
  validateParams(applicationIdParamSchema),
  loanApplicationController.submitLoanApplication,
);
loanApplicationRouter.post(
  "/loan-applications/:applicationId/start-review",
  validateParams(applicationIdParamSchema),
  loanApplicationController.startReview,
);
loanApplicationRouter.post(
  "/loan-applications/:applicationId/eligibility-assessments",
  validateParams(applicationIdParamSchema),
  eligibilityController.createEligibilityAssessment,
);
loanApplicationRouter.get(
  "/loan-applications/:applicationId/eligibility-assessments",
  validateParams(applicationIdParamSchema),
  eligibilityController.listEligibilityAssessments,
);
loanApplicationRouter.get(
  "/loan-applications/:applicationId/eligibility-assessments/:assessmentId",
  validateParams(assessmentIdParamSchema),
  eligibilityController.getEligibilityAssessment,
);
