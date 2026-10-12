import type { Request, Response } from "express";
import * as snapshotHistoryService from "./snapshot-history.service.js";

/**
 * HTTP adapters for persisted financial snapshot history.
 *
 * These handlers are not reachable. snapshot-history.routes.ts is not mounted,
 * and the API does not authenticate callers. The read service validates the
 * facility id, snapshot id, limit, and cursor, and it returns the existing
 * 400 and 404 errors.
 */

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

export async function listInterestCalculations(req: Request, res: Response): Promise<void> {
  const page = await snapshotHistoryService.listInterestCalculations(
    routeParam(req, "facilityId"),
    req.query,
  );
  res.status(200).json({ data: page.items, page: page.page });
}

export async function getInterestCalculation(req: Request, res: Response): Promise<void> {
  const calculation = await snapshotHistoryService.getInterestCalculation(
    routeParam(req, "facilityId"),
    routeParam(req, "calculationId"),
  );
  res.status(200).json({ data: calculation });
}

export async function listRepaymentSchedules(req: Request, res: Response): Promise<void> {
  const page = await snapshotHistoryService.listRepaymentSchedules(
    routeParam(req, "facilityId"),
    req.query,
  );
  res.status(200).json({ data: page.items, page: page.page });
}

export async function getRepaymentSchedule(req: Request, res: Response): Promise<void> {
  const schedule = await snapshotHistoryService.getRepaymentSchedule(
    routeParam(req, "facilityId"),
    routeParam(req, "scheduleId"),
  );
  res.status(200).json({ data: schedule });
}
