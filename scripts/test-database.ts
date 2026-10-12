import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const TEST_DATABASE_NAME = "loan_management_test";
const DEVELOPMENT_DATABASE_NAME = "loan_management_db";
const MAINTENANCE_DATABASE_NAME = "postgres";
const DISPOSABLE_MARKER = "msps-disposable-test-database";
const ADMIN_URL_ENV = "TEST_DATABASE_ADMIN_URL";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const FORBIDDEN_DATABASES = new Set([
  DEVELOPMENT_DATABASE_NAME,
  "loan_management_shadow",
  MAINTENANCE_DATABASE_NAME,
  "template0",
  "template1",
]);
const TEST_FILES = [
  "tests/interest-repayment-policy.test.ts",
  "tests/product-version-policy-lifecycle.test.ts",
  "tests/annual-interest-allocation.test.ts",
  "tests/repayment-schedule-engine.test.ts",
  "tests/interest-repayment-persistence.test.ts",
  "tests/financial-snapshot-validation.test.ts",
  "tests/principal-resolver.test.ts",
  "tests/snapshot-writer.test.ts",
  "tests/snapshot-immutability.test.ts",
  "tests/snapshot-history.test.ts",
];

type DatabaseState = {
  name: string;
  owner: string;
  marker: string | null;
};

type LifecycleConfig = {
  adminUrl: string;
  testDatabaseUrl: string;
  ownerRole: string;
};

loadEnv();

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected test database error.";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[connection string omitted]");
}

function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error("The application role name cannot be used as a database owner.");
  }
  return `"${identifier}"`;
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

function portOf(url: URL): string {
  return url.port || "5432";
}

function parseLocalPostgresUrl(value: string | undefined, label: string): URL {
  if (!value || !value.trim()) {
    throw new Error(`${label} is not set. No database was created or dropped.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a PostgreSQL URL. No database was created or dropped.`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${label} must be a PostgreSQL URL. No database was created or dropped.`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${label} must point at a local PostgreSQL host. No database was created or dropped.`);
  }
  return url;
}

function readConfig(): LifecycleConfig {
  const developmentUrl = parseLocalPostgresUrl(process.env.DATABASE_URL, "DATABASE_URL");
  if (databaseName(developmentUrl) !== DEVELOPMENT_DATABASE_NAME) {
    throw new Error("DATABASE_URL must name loan_management_db. No database was created or dropped.");
  }

  const adminUrl = parseLocalPostgresUrl(process.env[ADMIN_URL_ENV], ADMIN_URL_ENV);
  if (databaseName(adminUrl) !== MAINTENANCE_DATABASE_NAME) {
    throw new Error(`${ADMIN_URL_ENV} must connect to the postgres maintenance database. No database was created or dropped.`);
  }
  if (portOf(adminUrl) !== portOf(developmentUrl)) {
    throw new Error("The administrator connection and DATABASE_URL must use the same local port. No database was created or dropped.");
  }

  const ownerRole = decodeURIComponent(developmentUrl.username);
  quoteIdent(ownerRole);

  const testDatabaseUrl = new URL(developmentUrl.href);
  testDatabaseUrl.pathname = `/${TEST_DATABASE_NAME}`;

  return {
    adminUrl: adminUrl.href,
    testDatabaseUrl: testDatabaseUrl.href,
    ownerRole,
  };
}

function isLoopbackAddress(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "127.0.0.1/32" || addr === "::1" || addr === "::1/128";
}

async function assertLocalMaintenanceSession(client: pg.Client): Promise<void> {
  const result = await client.query<{ db: string; addr: string }>(
    `SELECT current_database() AS db, COALESCE(inet_server_addr()::text, '') AS addr`,
  );
  const session = result.rows[0];
  if (session?.db !== MAINTENANCE_DATABASE_NAME || !isLoopbackAddress(session.addr)) {
    throw new Error("The administrator connection is not a verified local maintenance session. No database was created or dropped.");
  }
}

async function readTestDatabase(client: pg.Client): Promise<DatabaseState | null> {
  const result = await client.query<DatabaseState>(
    `SELECT datname AS name,
            pg_catalog.pg_get_userbyid(datdba) AS owner,
            pg_catalog.shobj_description(oid, 'pg_database') AS marker
     FROM pg_catalog.pg_database
     WHERE datname = $1`,
    [TEST_DATABASE_NAME],
  );
  return result.rows[0] ?? null;
}

function assertDisposable(state: DatabaseState, ownerRole: string): void {
  if (state.name !== TEST_DATABASE_NAME || FORBIDDEN_DATABASES.has(state.name)) {
    throw new Error("Refusing to change a database outside the disposable test workflow.");
  }
  if (state.marker !== DISPOSABLE_MARKER) {
    throw new Error(
      "Refusing to change loan_management_test because its disposable-test marker is missing. It was not dropped or overwritten.",
    );
  }
  if (state.owner !== ownerRole) {
    throw new Error(
      "Refusing to change loan_management_test because its owner is not the application role. It was not dropped or overwritten.",
    );
  }
}

async function countConnections(client: pg.Client): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM pg_stat_activity
     WHERE datname = $1`,
    [TEST_DATABASE_NAME],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function waitUntilIdle(client: pg.Client): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await countConnections(client)) === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return (await countConnections(client)) === 0;
}

async function dropVerifiedDatabase(client: pg.Client, ownerRole: string): Promise<void> {
  const state = await readTestDatabase(client);
  if (!state) return;
  assertDisposable(state, ownerRole);
  const connections = await countConnections(client);
  if (connections > 0) {
    throw new Error(`Refusing to drop loan_management_test because ${connections} active connection(s) remain.`);
  }
  await client.query(`DROP DATABASE "loan_management_test"`);
}

async function createMarkedDatabase(client: pg.Client, ownerRole: string): Promise<void> {
  await client.query(`CREATE DATABASE "loan_management_test" OWNER ${quoteIdent(ownerRole)}`);
  await client.query(`COMMENT ON DATABASE "loan_management_test" IS '${DISPOSABLE_MARKER}'`);
  const created = await readTestDatabase(client);
  if (!created) {
    throw new Error("loan_management_test was created but could not be read back. It was not dropped.");
  }
  try {
    assertDisposable(created, ownerRole);
  } catch (error) {
    throw new Error(`${safeMessage(error)} It remains in place because automated deletion is not allowed.`, {
      cause: error,
    });
  }
  console.log("Created loan_management_test and verified its disposable-test marker.");
}

async function prepareDatabase(client: pg.Client, ownerRole: string): Promise<void> {
  const existing = await readTestDatabase(client);
  if (existing) {
    assertDisposable(existing, ownerRole);
    if (!(await waitUntilIdle(client))) {
      const connections = await countConnections(client);
      throw new Error(`Refusing to drop loan_management_test because ${connections} active connection(s) remain.`);
    }
    await dropVerifiedDatabase(client, ownerRole);
    console.log("Removed a previously marked loan_management_test database.");
  }
  await createMarkedDatabase(client, ownerRole);
}

function testEnvironment(testDatabaseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[ADMIN_URL_ENV];
  env.NODE_ENV = "test";
  env.MSPS_TEST_DATABASE = TEST_DATABASE_NAME;
  env.DATABASE_URL = testDatabaseUrl;
  return env;
}

function runCommand(executable: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolvePromise(1);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

async function runPrismaMigrate(testDatabaseUrl: string): Promise<number> {
  console.log("Applying existing migrations to loan_management_test.");
  return runCommand(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], testEnvironment(testDatabaseUrl));
}

async function runTests(testDatabaseUrl: string): Promise<number> {
  console.log("Running backend tests against loan_management_test.");
  return runCommand(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), "--test", ...TEST_FILES],
    testEnvironment(testDatabaseUrl),
  );
}

async function cleanup(client: pg.Client, ownerRole: string): Promise<void> {
  const existing = await readTestDatabase(client);
  if (!existing) return;
  assertDisposable(existing, ownerRole);
  if (!(await waitUntilIdle(client))) {
    const connections = await countConnections(client);
    throw new Error(`Refusing to drop loan_management_test because ${connections} active connection(s) remain.`);
  }
  await dropVerifiedDatabase(client, ownerRole);
}

async function main(): Promise<number> {
  const config = readConfig();
  const admin = new pg.Client({ connectionString: config.adminUrl });
  await admin.connect();
  let prepared = false;
  let exitCode = 0;
  let cleanupFailed = false;
  try {
    await assertLocalMaintenanceSession(admin);
    await prepareDatabase(admin, config.ownerRole);
    prepared = true;
    const migrateCode = await runPrismaMigrate(config.testDatabaseUrl);
    exitCode = migrateCode === 0 ? await runTests(config.testDatabaseUrl) : migrateCode;
  } catch (error) {
    console.error(safeMessage(error));
    if (exitCode === 0) exitCode = 1;
  } finally {
    if (prepared) {
      try {
        await cleanup(admin, config.ownerRole);
        console.log("Removed disposable database loan_management_test.");
      } catch (error) {
        cleanupFailed = true;
        console.error(safeMessage(error));
      }
    }
    await admin.end();
  }
  if (exitCode !== 0 && cleanupFailed) {
    console.error("The test run failed, and disposable database cleanup also failed.");
  }
  if (exitCode === 0 && cleanupFailed) return 1;
  return exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(safeMessage(error));
    process.exitCode = 1;
  });
