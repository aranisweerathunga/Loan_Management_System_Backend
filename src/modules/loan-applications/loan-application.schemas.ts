import { z } from "zod";

export const loanApplicationStatuses = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
] as const;

const decisionRemarksSchema = z
  .string({
    error: (issue) =>
      issue.input === undefined ? "remarks is required" : "remarks must be a string",
  })
  .trim()
  .min(1, "remarks must not be blank")
  .max(500, "remarks must be at most 500 characters");

export const approveLoanApplicationSchema = z.strictObject({
  remarks: decisionRemarksSchema.optional(),
});

export const rejectLoanApplicationSchema = z.strictObject({
  remarks: decisionRemarksSchema,
});

export const decisionIdParamSchema = z.object({
  applicationId: z.uuid(),
  decisionId: z.uuid(),
});

export const applicationIdParamSchema = z.object({
  applicationId: z.uuid(),
});

export const listLoanApplicationsQuerySchema = z.object({
  borrowerId: z.uuid().optional(),
  loanProductId: z.uuid().optional(),
  status: z.enum(loanApplicationStatuses).optional(),
});

export const createLoanApplicationSchema = z.object({
  borrowerId: z.uuid(),
  loanProductId: z.uuid(),
  productVersionId: z.uuid(),
  productPurposeId: z.uuid().nullable().optional(),
});

export const updateDraftLoanApplicationSchema = z
  .object({
    borrowerId: z.uuid().optional(),
    loanProductId: z.uuid().optional(),
    productVersionId: z.uuid().optional(),
    productPurposeId: z.uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export type CreateLoanApplicationInput = z.infer<typeof createLoanApplicationSchema>;
export type UpdateDraftLoanApplicationInput = z.infer<typeof updateDraftLoanApplicationSchema>;
export type ListLoanApplicationsQuery = z.infer<typeof listLoanApplicationsQuerySchema>;
export type ApproveLoanApplicationInput = z.infer<typeof approveLoanApplicationSchema>;
export type RejectLoanApplicationInput = z.infer<typeof rejectLoanApplicationSchema>;
