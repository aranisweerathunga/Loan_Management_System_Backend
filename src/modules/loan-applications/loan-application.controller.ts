import type { Request, Response } from "express";
import * as loanApplicationService from "./loan-application.service.js";
import type {
  CreateLoanApplicationInput,
  ListLoanApplicationsQuery,
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
