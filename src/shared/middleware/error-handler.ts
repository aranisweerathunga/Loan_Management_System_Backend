import type { NextFunction, Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../errors/app-error.js";
import { logger } from "../logging/logger.js";

function prismaConflictMessage(error: Prisma.PrismaClientKnownRequestError): string {
  if (error.code === "P2002") {
    return "A record with this unique value already exists";
  }

  if (error.code === "P2003") {
    return "Referenced record does not exist";
  }

  return "A database constraint was violated";
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res.status(409).json({
        error: {
          code: "CONFLICT",
          message: prismaConflictMessage(error),
        },
      });
      return;
    }

    if (error.code === "P2003" || error.code === "P2025") {
      res.status(error.code === "P2025" ? 404 : 400).json({
        error: {
          code: error.code === "P2025" ? "NOT_FOUND" : "VALIDATION_ERROR",
          message: error.code === "P2025" ? "Record not found" : prismaConflictMessage(error),
        },
      });
      return;
    }
  }

  logger.error({ err: error }, "Unhandled application error");

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
}
