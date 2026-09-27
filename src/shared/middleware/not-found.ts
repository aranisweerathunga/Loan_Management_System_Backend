import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, "Route not found", "NOT_FOUND"));
}
