import { z } from "zod";

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

export const gradeIdParamSchema = z.object({
  gradeId: z.uuid(),
});

export const createGradeSchema = z.object({
  code: trimmedCode,
  name: trimmedName,
  description: optionalDescription,
  isActive: z.boolean().optional(),
});

export const updateGradeSchema = z
  .object({
    code: trimmedCode.optional(),
    name: trimmedName.optional(),
    description: optionalDescription,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export type CreateGradeInput = z.infer<typeof createGradeSchema>;
export type UpdateGradeInput = z.infer<typeof updateGradeSchema>;
