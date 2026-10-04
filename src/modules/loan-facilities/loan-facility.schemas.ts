import { z } from "zod";
import { positiveMoneyString } from "../../shared/money/money-string.js";

export const facilityStatuses = ["PENDING_DISBURSEMENT", "ACTIVE"] as const;

const REFERENCE_MAX_LENGTH = 120;
const REMARKS_MAX_LENGTH = 500;

export function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isoDateField(field: string) {
  return z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? `${field} is required`
          : `${field} must be a YYYY-MM-DD date string`,
    })
    .trim()
    .refine((value) => isIsoCalendarDate(value), {
      message: `${field} must be a valid YYYY-MM-DD date`,
    });
}

function optionalText(field: string, maxLength: number) {
  return z
    .string({
      error: () => `${field} must be a string`,
    })
    .trim()
    .min(1, `${field} must not be blank`)
    .max(maxLength, `${field} must be at most ${maxLength} characters`)
    .optional();
}

export const facilityIdParamSchema = z.object({
  facilityId: z.uuid(),
});

export const disbursementIdParamSchema = z.object({
  facilityId: z.uuid(),
  disbursementId: z.uuid(),
});

export const transactionIdParamSchema = z.object({
  facilityId: z.uuid(),
  transactionId: z.uuid(),
});

export const listLoanFacilitiesQuerySchema = z.object({
  status: z.enum(facilityStatuses).optional(),
  borrowerId: z.uuid().optional(),
  loanProductId: z.uuid().optional(),
});

export const createLoanFacilitySchema = z.strictObject({
  facilityDate: isoDateField("facilityDate"),
  currencyCode: z
    .string({
      error: (issue) =>
        issue.input === undefined ? "currencyCode is required" : "currencyCode must be LKR",
    })
    .trim()
    .refine((value) => value === "LKR", { message: "currencyCode must be LKR" }),
});

export const createLoanDisbursementSchema = z.strictObject({
  amount: positiveMoneyString("amount"),
  disbursementDate: isoDateField("disbursementDate"),
  reference: optionalText("reference", REFERENCE_MAX_LENGTH),
  remarks: optionalText("remarks", REMARKS_MAX_LENGTH),
});

export type ListLoanFacilitiesQuery = z.infer<typeof listLoanFacilitiesQuerySchema>;
export type CreateLoanFacilityInput = z.infer<typeof createLoanFacilitySchema>;
export type CreateLoanDisbursementInput = z.infer<typeof createLoanDisbursementSchema>;
