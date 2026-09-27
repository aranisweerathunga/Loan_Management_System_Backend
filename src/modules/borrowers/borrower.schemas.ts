import { z } from "zod";

const trimmedName = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(120, "name must be at most 120 characters");

const optionalMiddleName = z
  .string()
  .trim()
  .max(120, "middleName must be at most 120 characters")
  .nullable()
  .optional();

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "date must be a valid calendar date",
  });

const identifierType = z
  .string()
  .trim()
  .min(2, "type must be at least 2 characters")
  .max(32, "type must be at most 32 characters")
  .regex(/^[A-Za-z0-9_-]+$/, "type may contain only letters, numbers, underscores and hyphens");

const identifierValue = z
  .string()
  .trim()
  .min(1, "value is required")
  .max(64, "value must be at most 64 characters");

const employmentStatus = z
  .string()
  .trim()
  .min(2, "status must be at least 2 characters")
  .max(32, "status must be at most 32 characters")
  .regex(/^[A-Za-z0-9_-]+$/, "status may contain only letters, numbers, underscores and hyphens");

const moneyString = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "balance must be a non-negative decimal string with up to 2 decimal places");

export const borrowerIdParamSchema = z.object({
  borrowerId: z.uuid(),
});

export const identifierIdParamSchema = z.object({
  borrowerId: z.uuid(),
  identifierId: z.uuid(),
});

export const createBorrowerSchema = z.object({
  firstName: trimmedName,
  middleName: optionalMiddleName,
  lastName: trimmedName,
  dateOfBirth: isoDate.nullable().optional(),
  email: z.email().trim().max(254).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateBorrowerSchema = z
  .object({
    firstName: trimmedName.optional(),
    middleName: optionalMiddleName,
    lastName: trimmedName.optional(),
    dateOfBirth: isoDate.nullable().optional(),
    email: z.email().trim().max(254).nullable().optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const createIdentifierSchema = z.object({
  type: identifierType,
  value: identifierValue,
  isPrimary: z.boolean().optional(),
});

export const updateIdentifierSchema = z
  .object({
    type: identifierType.optional(),
    value: identifierValue.optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const createEmployeeProfileSchema = z.object({
  isActive: z.boolean().optional(),
});

export const updateEmployeeProfileSchema = z
  .object({
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const createEmploymentHistorySchema = z
  .object({
    status: employmentStatus,
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
  })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo must not be earlier than effectiveFrom",
    path: ["effectiveTo"],
  });

export const createGradeHistorySchema = z
  .object({
    gradeId: z.uuid(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
  })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo must not be earlier than effectiveFrom",
    path: ["effectiveTo"],
  });

export const createEpfBalanceSchema = z.object({
  balance: moneyString,
  asOfDate: isoDate,
  source: z.enum(["MANUAL", "IMPORT"]),
});

export type CreateBorrowerInput = z.infer<typeof createBorrowerSchema>;
export type UpdateBorrowerInput = z.infer<typeof updateBorrowerSchema>;
export type CreateIdentifierInput = z.infer<typeof createIdentifierSchema>;
export type UpdateIdentifierInput = z.infer<typeof updateIdentifierSchema>;
export type CreateEmployeeProfileInput = z.infer<typeof createEmployeeProfileSchema>;
export type UpdateEmployeeProfileInput = z.infer<typeof updateEmployeeProfileSchema>;
export type CreateEmploymentHistoryInput = z.infer<typeof createEmploymentHistorySchema>;
export type CreateGradeHistoryInput = z.infer<typeof createGradeHistorySchema>;
export type CreateEpfBalanceInput = z.infer<typeof createEpfBalanceSchema>;
