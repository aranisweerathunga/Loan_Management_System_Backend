import { Router } from "express";
import { prisma } from "../../shared/database/prisma.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "loan-management-api",
  });
});

healthRouter.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: "ok",
      database: "up",
    });
  } catch {
    res.status(503).json({
      status: "unavailable",
      database: "down",
    });
  }
});
