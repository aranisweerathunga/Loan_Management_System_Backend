import { z } from "zod";
import { productVersionConfigurationSchema } from "../interest-repayment/configuration.js";

const trimmedCode = z
  .string()
  .trim()
  .min(2, "code must be at least 2 characters")
  .max(32, "code must be at most 32 characters")
  .regex(/^[A-Za-z0-9_-]+$/, "code may contain only letters, numbers, underscores and hyphens");

const trimmedName = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(120, "name must be at most 120 characters");

const optionalDescription = z
  .string()
  .trim()
  .max(500, "description must be at most 500 characters")
  .nullable()
  .optional();

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "date must be a valid calendar date",
  });

export const idParamSchema = z.object({
  categoryId: z.uuid().optional(),
  productId: z.uuid().optional(),
  purposeId: z.uuid().optional(),
  versionId: z.uuid().optional(),
});

export const categoryIdParamSchema = z.object({
  categoryId: z.uuid(),
});

export const productIdParamSchema = z.object({
  productId: z.uuid(),
});

export const purposeIdParamSchema = z.object({
  productId: z.uuid(),
  purposeId: z.uuid(),
});

export const versionIdParamSchema = z.object({
  productId: z.uuid(),
  versionId: z.uuid(),
});

export const listProductsQuerySchema = z.object({
  categoryId: z.uuid().optional(),
});

export const createCategorySchema = z.object({
  code: trimmedCode,
  name: trimmedName,
  description: optionalDescription,
  isActive: z.boolean().optional(),
});

export const updateCategorySchema = z
  .object({
    code: trimmedCode.optional(),
    name: trimmedName.optional(),
    description: optionalDescription,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const createProductSchema = z.object({
  categoryId: z.uuid(),
  code: trimmedCode,
  name: trimmedName,
  description: optionalDescription,
  isActive: z.boolean().optional(),
});

export const updateProductSchema = z
  .object({
    categoryId: z.uuid().optional(),
    code: trimmedCode.optional(),
    name: trimmedName.optional(),
    description: optionalDescription,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const createPurposeSchema = z.object({
  code: trimmedCode,
  name: trimmedName,
  description: optionalDescription,
  isActive: z.boolean().optional(),
});

export const updatePurposeSchema = z
  .object({
    code: trimmedCode.optional(),
    name: trimmedName.optional(),
    description: optionalDescription,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const createVersionSchema = z
  .object({
    versionNumber: z.number().int().positive(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    configuration: productVersionConfigurationSchema,
  })
  .refine(
    (value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      message: "effectiveTo must not be earlier than effectiveFrom",
      path: ["effectiveTo"],
    },
  );

export const updateDraftVersionSchema = z
  .object({
    versionNumber: z.number().int().positive().optional(),
    effectiveFrom: isoDate.optional(),
    effectiveTo: isoDate.nullable().optional(),
    configuration: productVersionConfigurationSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  })
  .refine(
    (value) =>
      !value.effectiveFrom ||
      value.effectiveTo === undefined ||
      value.effectiveTo === null ||
      value.effectiveTo >= value.effectiveFrom,
    {
      message: "effectiveTo must not be earlier than effectiveFrom",
      path: ["effectiveTo"],
    },
  );

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreatePurposeInput = z.infer<typeof createPurposeSchema>;
export type UpdatePurposeInput = z.infer<typeof updatePurposeSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type UpdateDraftVersionInput = z.infer<typeof updateDraftVersionSchema>;
