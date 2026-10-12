import { prisma } from "../src/shared/database/prisma.js";

export const TEST_DATABASE_NAME = "loan_management_test";

const FORBIDDEN_DATABASES = new Set([
  "loan_management_db",
  "loan_management_shadow",
  "postgres",
  "template0",
  "template1",
]);

/**
 * Fail closed before a database-backed test writes.
 * Environment indicators are checked before the connection is asked for its identity.
 */
export async function requireTestDatabase(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Refusing database tests: NODE_ENV must be test.");
  }
  if (process.env.MSPS_TEST_DATABASE !== TEST_DATABASE_NAME) {
    throw new Error("Refusing database tests: MSPS_TEST_DATABASE must be loan_management_test.");
  }

  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  const name = rows[0]?.name;
  if (name !== TEST_DATABASE_NAME || name === undefined || FORBIDDEN_DATABASES.has(name)) {
    throw new Error("Refusing database tests: the connection is not the disposable test database.");
  }
}
