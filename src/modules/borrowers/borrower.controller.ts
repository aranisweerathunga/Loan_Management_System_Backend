import type { Request, Response } from "express";
import * as borrowerService from "./borrower.service.js";
import type {
  CreateBorrowerInput,
  CreateEmployeeProfileInput,
  CreateEmploymentHistoryInput,
  CreateEpfBalanceInput,
  CreateGradeHistoryInput,
  CreateIdentifierInput,
  UpdateBorrowerInput,
  UpdateEmployeeProfileInput,
  UpdateIdentifierInput,
} from "./borrower.schemas.js";

export async function createBorrower(req: Request, res: Response): Promise<void> {
  const borrower = await borrowerService.createBorrower(req.body as CreateBorrowerInput);
  res.status(201).json({ data: borrower });
}

export async function listBorrowers(_req: Request, res: Response): Promise<void> {
  const borrowers = await borrowerService.listBorrowers();
  res.status(200).json({ data: borrowers });
}

export async function getBorrower(req: Request, res: Response): Promise<void> {
  const borrower = await borrowerService.getBorrowerById(req.params.borrowerId as string);
  res.status(200).json({ data: borrower });
}

export async function updateBorrower(req: Request, res: Response): Promise<void> {
  const borrower = await borrowerService.updateBorrower(
    req.params.borrowerId as string,
    req.body as UpdateBorrowerInput,
  );
  res.status(200).json({ data: borrower });
}

export async function createIdentifier(req: Request, res: Response): Promise<void> {
  const identifier = await borrowerService.createIdentifier(
    req.params.borrowerId as string,
    req.body as CreateIdentifierInput,
  );
  res.status(201).json({ data: identifier });
}

export async function listIdentifiers(req: Request, res: Response): Promise<void> {
  const identifiers = await borrowerService.listIdentifiers(req.params.borrowerId as string);
  res.status(200).json({ data: identifiers });
}

export async function updateIdentifier(req: Request, res: Response): Promise<void> {
  const identifier = await borrowerService.updateIdentifier(
    req.params.borrowerId as string,
    req.params.identifierId as string,
    req.body as UpdateIdentifierInput,
  );
  res.status(200).json({ data: identifier });
}

export async function createEmployeeProfile(req: Request, res: Response): Promise<void> {
  const profile = await borrowerService.createEmployeeProfile(
    req.params.borrowerId as string,
    req.body as CreateEmployeeProfileInput,
  );
  res.status(201).json({ data: profile });
}

export async function getEmployeeProfile(req: Request, res: Response): Promise<void> {
  const profile = await borrowerService.getEmployeeProfile(req.params.borrowerId as string);
  res.status(200).json({ data: profile });
}

export async function updateEmployeeProfile(req: Request, res: Response): Promise<void> {
  const profile = await borrowerService.updateEmployeeProfile(
    req.params.borrowerId as string,
    req.body as UpdateEmployeeProfileInput,
  );
  res.status(200).json({ data: profile });
}

export async function createEmploymentHistory(req: Request, res: Response): Promise<void> {
  const record = await borrowerService.createEmploymentHistory(
    req.params.borrowerId as string,
    req.body as CreateEmploymentHistoryInput,
  );
  res.status(201).json({ data: record });
}

export async function listEmploymentHistory(req: Request, res: Response): Promise<void> {
  const records = await borrowerService.listEmploymentHistory(req.params.borrowerId as string);
  res.status(200).json({ data: records });
}

export async function createGradeHistory(req: Request, res: Response): Promise<void> {
  const record = await borrowerService.createGradeHistory(
    req.params.borrowerId as string,
    req.body as CreateGradeHistoryInput,
  );
  res.status(201).json({ data: record });
}

export async function listGradeHistory(req: Request, res: Response): Promise<void> {
  const records = await borrowerService.listGradeHistory(req.params.borrowerId as string);
  res.status(200).json({ data: records });
}

export async function createEpfBalance(req: Request, res: Response): Promise<void> {
  const record = await borrowerService.createEpfBalance(
    req.params.borrowerId as string,
    req.body as CreateEpfBalanceInput,
  );
  res.status(201).json({ data: record });
}

export async function listEpfBalances(req: Request, res: Response): Promise<void> {
  const records = await borrowerService.listEpfBalances(req.params.borrowerId as string);
  res.status(200).json({ data: records });
}
