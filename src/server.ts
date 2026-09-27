import type { Server } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectDatabase, verifyDatabaseConnection } from "./shared/database/prisma.js";
import { toSafeError } from "./shared/errors/safe-error.js";
import { logger } from "./shared/logging/logger.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp();
let server: Server | undefined;
let shuttingDown = false;

function closeHttpServer(httpServer: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!httpServer.listening) {
      resolve();
      return;
    }

    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");

  const timeout = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Graceful shutdown timed out");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  timeout.unref();

  try {
    if (server) {
      await closeHttpServer(server);
    }

    await disconnectDatabase();
    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error({ err: toSafeError(error) }, "Graceful shutdown failed");
    process.exit(1);
  }
}

async function start(): Promise<void> {
  if (env.NODE_ENV === "production") {
    try {
      await verifyDatabaseConnection();
      logger.info("PostgreSQL connection verified");
    } catch (error) {
      logger.error(
        { err: toSafeError(error) },
        "PostgreSQL connection failed. Refusing to start in production. Confirm DATABASE_URL and that the database is reachable.",
      );

      try {
        await disconnectDatabase();
      } catch (disconnectError) {
        logger.error({ err: toSafeError(disconnectError) }, "Error while disconnecting from PostgreSQL");
      }

      process.exit(1);
    }
  }

  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "API server started");
  });

  server.on("error", (error) => {
    logger.error({ err: toSafeError(error) }, "API server failed to start");
    process.exit(1);
  });

  if (env.NODE_ENV !== "production") {
    verifyDatabaseConnection()
      .then(() => {
        logger.info("PostgreSQL connection verified");
      })
      .catch((error: unknown) => {
        logger.error(
          { err: toSafeError(error) },
          "PostgreSQL connection failed. Confirm DATABASE_URL and that loan_management_db exists. Use a dedicated role such as loan_app rather than the postgres superuser for ongoing work.",
        );
      });
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: toSafeError(reason) }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.error({ err: toSafeError(error) }, "Uncaught exception");
  void shutdown("uncaughtException");
});

void start();
