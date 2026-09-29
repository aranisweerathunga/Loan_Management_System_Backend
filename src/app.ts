import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { borrowerRouter } from "./modules/borrowers/borrower.routes.js";
import { gradeRouter } from "./modules/grades/grade.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { loanApplicationRouter } from "./modules/loan-applications/loan-application.routes.js";
import { productRouter } from "./modules/products/product.routes.js";
import { errorHandler } from "./shared/middleware/error-handler.js";
import { notFoundHandler } from "./shared/middleware/not-found.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
    }),
  );
  app.use(express.json());

  app.use("/api", healthRouter);
  app.use("/api", productRouter);
  app.use("/api", gradeRouter);
  app.use("/api", borrowerRouter);
  app.use("/api", loanApplicationRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
