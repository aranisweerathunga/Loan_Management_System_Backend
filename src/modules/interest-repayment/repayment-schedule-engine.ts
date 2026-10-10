import { AppError } from "../../shared/errors/app-error.js";
import { isIsoCalendarDate } from "../loan-facilities/loan-facility.schemas.js";
import {
  Decimal,
  MAX_MONEY,
  formatMoney,
  parseNonNegativeMoneyAmount,
} from "../../shared/money/decimal.js";

/**
 * This engine assembles a repayment schedule from already-resolved financial
 * allocations and due dates. It does not select MSPS repayment policy.
 * It does not require the supplied allocations to repay the full principal.
 * It does not read facilities, disbursements, or ProductVersion rows.
 * Schedule entries describe what should be paid. They do not record payments.
 */

const unresolvedWorkflowFields = [
  "repaymentStructure",
  "repaymentFrequency",
  "principalRepaymentMethod",
  "scheduleCommencementBasis",
  "firstRepaymentRule",
  "term",
  "gracePeriod",
  "paymentAllocationPriority",
  "facilityDate",
  "disbursementDate",
  "maturityDate",
] as const;

const ONE = new Decimal("1");

export type RepaymentScheduleEntry = {
  sequence: number;
  dueDate: string;
  openingPrincipal: string;
  scheduledPrincipal: string;
  scheduledInterest: string;
  totalScheduledAmount: string;
  closingPrincipal: string;
};

export type RepaymentScheduleResult = {
  principalAmount: string;
  totalScheduledPrincipal: string;
  totalScheduledInterest: string;
  totalScheduledAmount: string;
  remainingPrincipal: string;
  numberOfInstalments: number;
  entries: RepaymentScheduleEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(message: string): AppError {
  return new AppError(400, message, "VALIDATION_ERROR");
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array`);
  }
  if (value.length === 0) {
    throw validationError(`${field} must contain at least one period`);
  }
  return value;
}

function parseDueDates(value: unknown): string[] {
  return requireArray(value, "dueDates").map((item, index) => {
    if (typeof item !== "string") {
      throw validationError(`dueDates.${index} must be a YYYY-MM-DD date string`);
    }
    const dueDate = item.trim();
    if (!isIsoCalendarDate(dueDate)) {
      throw validationError(`dueDates.${index} must be a valid YYYY-MM-DD date`);
    }
    return dueDate;
  });
}

function assertChronological(dueDates: string[]): void {
  for (let index = 1; index < dueDates.length; index += 1) {
    const current = dueDates[index];
    const previous = dueDates[index - 1];
    if (current === undefined || previous === undefined) {
      throw validationError(`dueDates.${index} must be a valid YYYY-MM-DD date`);
    }
    if (current === previous) {
      throw validationError(`dueDates.${index} duplicates an earlier due date`);
    }
    if (current < previous) {
      throw validationError(`dueDates.${index} must be later than the previous due date`);
    }
  }
}

function parseAllocations(value: unknown, field: string): Decimal[] {
  return requireArray(value, field).map((item, index) =>
    parseNonNegativeMoneyAmount(item, `${field}.${index}`),
  );
}

export function assembleRepaymentSchedule(input: unknown): RepaymentScheduleResult {
  if (!isRecord(input)) {
    throw validationError("repayment schedule input must be an object");
  }

  for (const field of unresolvedWorkflowFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw validationError(`${field} is not resolved by the repayment schedule engine`);
    }
  }

  const principal = parseNonNegativeMoneyAmount(input.principalAmount, "principalAmount");
  const dueDates = parseDueDates(input.dueDates);
  const principalAllocations = parseAllocations(input.principalAllocations, "principalAllocations");
  const interestAllocations = parseAllocations(input.interestAllocations, "interestAllocations");

  if (
    dueDates.length !== principalAllocations.length ||
    dueDates.length !== interestAllocations.length
  ) {
    throw validationError(
      "dueDates, principalAllocations, and interestAllocations must contain the same number of periods",
    );
  }

  assertChronological(dueDates);

  let opening = principal;
  let totalPrincipal = new Decimal("0");
  let totalInterest = new Decimal("0");
  let sequence = new Decimal("0");
  const entries: RepaymentScheduleEntry[] = [];

  for (let index = 0; index < dueDates.length; index += 1) {
    const dueDate = dueDates[index];
    const scheduledPrincipal = principalAllocations[index];
    const scheduledInterest = interestAllocations[index];
    if (dueDate === undefined || scheduledPrincipal === undefined || scheduledInterest === undefined) {
      throw validationError("schedule periods are incomplete");
    }
    if (scheduledPrincipal.greaterThan(opening)) {
      throw validationError(`principalAllocations.${index} exceeds opening principal`);
    }

    const closing = opening.minus(scheduledPrincipal);
    const periodTotal = scheduledPrincipal.plus(scheduledInterest);
    if (periodTotal.greaterThan(MAX_MONEY) || closing.greaterThan(MAX_MONEY)) {
      throw validationError("scheduled amount exceeds the supported monetary precision");
    }

    sequence = sequence.plus(ONE);
    entries.push({
      sequence: sequence.toNumber(),
      dueDate,
      openingPrincipal: formatMoney(opening),
      scheduledPrincipal: formatMoney(scheduledPrincipal),
      scheduledInterest: formatMoney(scheduledInterest),
      totalScheduledAmount: formatMoney(periodTotal),
      closingPrincipal: formatMoney(closing),
    });

    totalPrincipal = totalPrincipal.plus(scheduledPrincipal);
    totalInterest = totalInterest.plus(scheduledInterest);
    opening = closing;
  }

  const remaining = principal.minus(totalPrincipal);
  if (remaining.isNeg()) {
    throw validationError("principalAllocations exceed principalAmount");
  }
  if (!opening.equals(remaining)) {
    throw new AppError(
      500,
      "remaining principal does not match the final closing principal",
      "INTERNAL_ERROR",
    );
  }

  const totalScheduled = totalPrincipal.plus(totalInterest);
  if (totalScheduled.greaterThan(MAX_MONEY)) {
    throw validationError("totalScheduledAmount exceeds the supported monetary precision");
  }

  return {
    principalAmount: formatMoney(principal),
    totalScheduledPrincipal: formatMoney(totalPrincipal),
    totalScheduledInterest: formatMoney(totalInterest),
    totalScheduledAmount: formatMoney(totalScheduled),
    remainingPrincipal: formatMoney(remaining),
    numberOfInstalments: entries.length,
    entries,
  };
}
