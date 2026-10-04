import type { Request, Response } from "express";
import * as loanApplicationService from "./loan-application.service.js";
import type {
  ApproveLoanApplicationInput,
  CreateLoanApplicationInput,
  ListLoanApplicationsQuery,
  RejectLoanApplicationInput,
  UpdateDraftLoanApplicationInput,
} from "./loan-application.schemas.js";

export async function createLoanApplication(req: Request, res: Response): Promise<void> {
  const application = await loanApplicationService.createLoanApplication(
    req.body as CreateLoanApplicationInput,
  );
  res.status(201).json({ data: application });
}

export async function listLoanApplications(req: Request, res: Response): Promise<void> {
  const applications = await loanApplicationService.listLoanApplications(
    req.query as ListLoanApplicationsQuery,
  );
  res.status(200).json({ data: applications });
}

export async function getLoanApplication(req: Request, res: Response): Promise<void> {
  const application = await loanApplicationService.getLoanApplicationById(
    req.params.applicationId as string,
  );
  res.status(200).json({ data: application });
}

export async function updateDraftLoanApplication(req: Request, res: Response): Promise<void> {
  const application = await loanApplicationService.updateDraftLoanApplication(
    req.params.applicationId as string,
    req.body as UpdateDraftLoanApplicationInput,
  );
  res.status(200).json({ data: application });
}

export async function listApplicationStatusHistory(req: Request, res: Response): Promise<void> {
  const history = await loanApplicationService.listApplicationStatusHistory(
    req.params.applicationId as string,
  );
  res.status(200).json({ data: history });
}

export async function submitLoanApplication(req: Request, res: Response): Promise<void> {
  const application = await loanApplicationService.submitLoanApplication(
    req.params.applicationId as string,
  );
  res.status(200).json({ data: application });
}

export async function startReview(req: Request, res: Response): Promise<void> {
  const application = await loanApplicationService.startReview(
    req.params.applicationId as string,
  );
  res.status(200).json({ data: application });
}

export async function approveLoanApplication(req: Request, res: Response): Promise<void> {
  const application = await loanApplicationService.approveLoanApplication(
    req.params.applicationId as string,
    req.body as ApproveLoanApplicationInput,
  );
  res.status(200).json({ data: application });
}

export async function rejectLoanApplication(req: Request, res: Response): Promise<void> {
  const body = req.body as RejectLoanApplicationInput;
  const application = await loanApplicationService.rejectLoanApplication(
    req.params.applicationId as string,
    body.remarks,
  );
  res.status(200).json({ data: application });
}

export async function listApplicationDecisions(req: Request, res: Response): Promise<void> {
  const decisions = await loanApplicationService.listApplicationDecisions(
    req.params.applicationId as string,
  );
  res.status(200).json({ data: decisions });
}

export async function getApplicationDecision(req: Request, res: Response): Promise<void> {
  const decision = await loanApplicationService.getApplicationDecision(
    req.params.applicationId as string,
    req.params.decisionId as string,
  );
  res.status(200).json({ data: decision });
}
