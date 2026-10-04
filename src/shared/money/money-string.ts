import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { parsePositiveMoneyString } from "./decimal.js";

export function positiveMoneyString(field: string) {
  return z
    .string({
      error: (issue) => {
        if (issue.input === undefined) {
          return `${field} is required`;
        }
        if (typeof issue.input === "number") {
          return `${field} must be a decimal string, not a number`;
        }
        return `${field} must be a decimal string`;
      },
    })
    .trim()
    .superRefine((value, ctx) => {
      try {
        parsePositiveMoneyString(value, field);
      } catch (error) {
        if (error instanceof AppError) {
          ctx.addIssue(error.message);
          return;
        }
        throw error;
      }
    });
}
