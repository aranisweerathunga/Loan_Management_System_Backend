import type { Request, Response } from "express";
import * as eligibilityService from "./eligibility.service.js";

export async function createEligibilityAssessment(req: Request, res: Response): Promise<void> {
  const assessment = await eligibilityService.createEligibilityAssessment(
    req.params.applicationId as string,
  );
  res.status(201).json({ data: assessment });
}

export async function listEligibilityAssessments(req: Request, res: Response): Promise<void> {
  const assessments = await eligibilityService.listEligibilityAssessments(
    req.params.applicationId as string,
  );
  res.status(200).json({ data: assessments });
}

export async function getEligibilityAssessment(req: Request, res: Response): Promise<void> {
  const assessment = await eligibilityService.getEligibilityAssessment(
    req.params.applicationId as string,
    req.params.assessmentId as string,
  );
  res.status(200).json({ data: assessment });
}
