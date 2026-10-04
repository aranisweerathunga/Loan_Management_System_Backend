import type { Request, Response } from "express";
import type {
  CreateLoanDisbursementInput,
  CreateLoanFacilityInput,
  ListLoanFacilitiesQuery,
} from "./loan-facility.schemas.js";
import * as loanFacilityService from "./loan-facility.service.js";

export async function createLoanFacility(req: Request, res: Response): Promise<void> {
  const facility = await loanFacilityService.createLoanFacility(
    req.params.applicationId as string,
    req.body as CreateLoanFacilityInput,
  );
  res.status(201).json({ data: facility });
}

export async function listLoanFacilities(req: Request, res: Response): Promise<void> {
  const facilities = await loanFacilityService.listLoanFacilities(req.query as ListLoanFacilitiesQuery);
  res.status(200).json({ data: facilities });
}

export async function getLoanFacility(req: Request, res: Response): Promise<void> {
  const facility = await loanFacilityService.getLoanFacilityById(req.params.facilityId as string);
  res.status(200).json({ data: facility });
}

export async function createLoanDisbursement(req: Request, res: Response): Promise<void> {
  const disbursement = await loanFacilityService.createLoanDisbursement(
    req.params.facilityId as string,
    req.body as CreateLoanDisbursementInput,
  );
  res.status(201).json({ data: disbursement });
}

export async function listLoanDisbursements(req: Request, res: Response): Promise<void> {
  const disbursements = await loanFacilityService.listLoanDisbursements(
    req.params.facilityId as string,
  );
  res.status(200).json({ data: disbursements });
}

export async function getLoanDisbursement(req: Request, res: Response): Promise<void> {
  const disbursement = await loanFacilityService.getLoanDisbursement(
    req.params.facilityId as string,
    req.params.disbursementId as string,
  );
  res.status(200).json({ data: disbursement });
}

export async function listLoanTransactions(req: Request, res: Response): Promise<void> {
  const transactions = await loanFacilityService.listLoanTransactions(
    req.params.facilityId as string,
  );
  res.status(200).json({ data: transactions });
}

export async function getLoanTransaction(req: Request, res: Response): Promise<void> {
  const transaction = await loanFacilityService.getLoanTransaction(
    req.params.facilityId as string,
    req.params.transactionId as string,
  );
  res.status(200).json({ data: transaction });
}
