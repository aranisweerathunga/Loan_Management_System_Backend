import { z } from "zod";

export const loanApplicationStatuses = ["DRAFT", "SUBMITTED", "UNDER_REVIEW"] as const;

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
