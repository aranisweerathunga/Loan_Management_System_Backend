import { NEVER, z } from "zod";

/**
 * Query validation for internal financial snapshot history reads.
 *
 * A cursor is an opaque page token. Version 1 binds it to the facility and
 * history type that issued it, plus the historySequence/id position.
 * Callers pass the token back unchanged. It is not a financial decision.
 */

export const SNAPSHOT_HISTORY_DEFAULT_LIMIT = 50;
export const SNAPSHOT_HISTORY_MAX_LIMIT = 100;
export const SNAPSHOT_HISTORY_CURSOR_VERSION = 1 as const;

export const snapshotHistoryTypes = ["interest-calculation", "repayment-schedule"] as const;
export type SnapshotHistoryType = (typeof snapshotHistoryTypes)[number];

const POSTGRES_INT_MIN = -2_147_483_648;
const POSTGRES_INT_MAX = 2_147_483_647;
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const LIMIT_PATTERN = /^[1-9]\d*$/;
const SUPPORTED_QUERY_KEYS = new Set(["limit", "cursor"]);

const cursorPayloadSchema = z.strictObject({
  version: z.literal(SNAPSHOT_HISTORY_CURSOR_VERSION),
  historyType: z.enum(snapshotHistoryTypes),
  facilityId: z.uuid(),
  historySequence: z.number().int().min(POSTGRES_INT_MIN).max(POSTGRES_INT_MAX),
  id: z.uuid(),
});

export type SnapshotHistoryCursor = z.infer<typeof cursorPayloadSchema>;

export type SnapshotHistoryQuery = {
  limit: number;
  cursor: SnapshotHistoryCursor | null;
};

function canonicalCursorJson(position: SnapshotHistoryCursor): string {
  return JSON.stringify({
    version: position.version,
    historyType: position.historyType,
    facilityId: position.facilityId.toLowerCase(),
    historySequence: position.historySequence,
    id: position.id,
  });
}

export function encodeSnapshotHistoryCursor(
  position: SnapshotHistoryCursor,
): string | undefined {
  const parsed = cursorPayloadSchema.safeParse(position);
  if (!parsed.success) {
    return undefined;
  }

  return Buffer.from(canonicalCursorJson(parsed.data), "utf8").toString("base64url");
}

function decodeSnapshotHistoryCursor(cursor: string): SnapshotHistoryCursor | undefined {
  if (!OPAQUE_CURSOR_PATTERN.test(cursor)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }

  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    return undefined;
  }

  const reencoded = encodeSnapshotHistoryCursor(result.data);
  if (reencoded !== cursor) {
    return undefined;
  }

  return {
    version: result.data.version,
    historyType: result.data.historyType,
    facilityId: result.data.facilityId.toLowerCase(),
    historySequence: result.data.historySequence,
    id: result.data.id,
  };
}

function readLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return SNAPSHOT_HISTORY_DEFAULT_LIMIT;
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1 || value > SNAPSHOT_HISTORY_MAX_LIMIT) {
      return undefined;
    }
    return value;
  }

  if (typeof value === "string" && LIMIT_PATTERN.test(value)) {
    const parsed = Number(value);
    if (parsed >= 1 && parsed <= SNAPSHOT_HISTORY_MAX_LIMIT) {
      return parsed;
    }
  }

  return undefined;
}

function readCursor(value: unknown): SnapshotHistoryCursor | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return decodeSnapshotHistoryCursor(value);
}

function plainQueryRecord(value: object): Record<string, unknown> | undefined {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export const snapshotHistoryQuerySchema = z.any().transform((value, ctx): SnapshotHistoryQuery => {
  if (value === undefined) {
    return { limit: SNAPSHOT_HISTORY_DEFAULT_LIMIT, cursor: null };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    ctx.addIssue({
      code: "custom",
      message: "query must be an object",
      input: value,
    });
    return NEVER;
  }

  const record = plainQueryRecord(value);
  if (record === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "query must be an object",
      input: value,
    });
    return NEVER;
  }

  const unknownKeys = Object.keys(record)
    .filter((key) => !SUPPORTED_QUERY_KEYS.has(key))
    .sort();
  for (const key of unknownKeys) {
    ctx.addIssue({
      code: "custom",
      path: [key],
      message: "is not a supported query parameter",
      input: record[key],
    });
  }

  const limit = readLimit(record.limit);
  const cursor = readCursor(record.cursor);

  if (limit === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["limit"],
      message: "must be an integer from 1 to 100",
      input: record.limit,
    });
  }

  if (cursor === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["cursor"],
      message: "is invalid",
      input: record.cursor,
    });
  }

  if (unknownKeys.length > 0 || limit === undefined || cursor === undefined) {
    return NEVER;
  }

  return { limit, cursor };
});

export const snapshotFacilityIdSchema = z.uuid();
export const interestCalculationIdSchema = z.uuid();
export const repaymentScheduleIdSchema = z.uuid();
