import { Router } from "express";
import * as snapshotHistoryController from "./snapshot-history.controller.js";

/**
 * Prepared GET routes for persisted financial snapshot history.
 *
 * This router is intentionally unmounted. The application has no
 * authentication. Do not import it from src/app.ts, src/server.ts, or
 * loan-facility.routes.ts. Do not enable it with an environment flag.
 *
 * When a future authenticated entry point mounts it at /api, the paths are:
 * GET /loan-facilities/:facilityId/interest-calculations
 * GET /loan-facilities/:facilityId/interest-calculations/:calculationId
 * GET /loan-facilities/:facilityId/repayment-schedules
 * GET /loan-facilities/:facilityId/repayment-schedules/:scheduleId
 */

export const snapshotHistoryRouter = Router();

snapshotHistoryRouter.get(
  "/loan-facilities/:facilityId/interest-calculations",
  snapshotHistoryController.listInterestCalculations,
);
snapshotHistoryRouter.get(
  "/loan-facilities/:facilityId/interest-calculations/:calculationId",
  snapshotHistoryController.getInterestCalculation,
);
snapshotHistoryRouter.get(
  "/loan-facilities/:facilityId/repayment-schedules",
  snapshotHistoryController.listRepaymentSchedules,
);
snapshotHistoryRouter.get(
  "/loan-facilities/:facilityId/repayment-schedules/:scheduleId",
  snapshotHistoryController.getRepaymentSchedule,
);
