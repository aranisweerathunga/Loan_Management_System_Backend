import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { healthRouter } from "./modules/health/health.routes.js";
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
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
