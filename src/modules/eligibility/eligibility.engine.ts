import { AppError } from "../../shared/errors/app-error.js";
import { assertEpfPercentageLimitNotExecutable, EPF_PERCENTAGE_LIMIT } from "./epf-percentage-limit.js";
import type {
  AssessmentOutcome,
  AssessmentSubject,
  EligibilitySnapshots,
  ExecutableRule,
  RuleResult,
} from "./eligibility.types.js";

const NO_ELIGIBILITY_RULES_CONFIGURED = "NO_ELIGIBILITY_RULES_CONFIGURED";

/**
 * Executable strategies are registered here in source.
 * EPF_PERCENTAGE_LIMIT is intentionally absent until its reference basis and rounding policy are confirmed.
 */
const executableRules: ExecutableRule[] = [];

type NoRulesPlan = {
  kind: "no-rules";
  eligibility: null | { rules: [] };
};

type ReadyPlan = {
  kind: "ready";
  rules: Array<{ index: number; rule: ExecutableRule; config: unknown }>;
};

type EligibilityPlan = NoRulesPlan | ReadyPlan;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(message: string): AppError {
  return new AppError(400, message, "VALIDATION_ERROR");
}

function parseEligibilityPlan(configuration: unknown): EligibilityPlan {
  if (!isRecord(configuration)) {
    throw validationError("configuration must be an object");
  }

  if (!Object.prototype.hasOwnProperty.call(configuration, "eligibility")) {
    return { kind: "no-rules", eligibility: null };
  }

  const eligibility = configuration.eligibility;
  if (!isRecord(eligibility)) {
    throw validationError("eligibility must be an object");
  }

  const allowedKeys = new Set(["rules"]);
  const unexpected = Object.keys(eligibility).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw validationError(`eligibility: unrecognized key ${unexpected.join(", ")}`);
  }

  if (!Array.isArray(eligibility.rules)) {
    throw validationError("eligibility.rules must be an array");
  }

  if (eligibility.rules.length === 0) {
    return { kind: "no-rules", eligibility: { rules: [] } };
  }

  const ready: ReadyPlan["rules"] = [];

  eligibility.rules.forEach((rule, index) => {
    if (!isRecord(rule) || typeof rule.type !== "string" || rule.type.trim().length === 0) {
      throw validationError(`eligibility.rules.${index}.type: eligibility rule type is required`);
    }

    if (rule.type === EPF_PERCENTAGE_LIMIT) {
      assertEpfPercentageLimitNotExecutable(rule, index);
    }

    const executable = executableRules.find((candidate) => candidate.type === rule.type);
    if (!executable) {
      throw validationError(`eligibility.rules.${index}.type: unsupported eligibility rule ${rule.type}`);
    }

    ready.push({
      index,
      rule: executable,
      config: executable.validate(rule, index),
    });
  });

  return { kind: "ready", rules: ready };
}

function inputSnapshot(subject: AssessmentSubject): Record<string, unknown> {
  return {
    application: subject.application,
    borrower: subject.borrower,
    loanProduct: subject.loanProduct,
    productVersion: subject.productVersion,
    productPurpose: subject.productPurpose,
  };
}

function ruleSnapshot(
  subject: AssessmentSubject,
  eligibility: null | { rules: unknown[] },
): Record<string, unknown> {
  return {
    productVersionId: subject.productVersion.id,
    versionNumber: subject.productVersion.versionNumber,
    eligibility,
  };
}

function combineOutcomes(results: RuleResult[]): AssessmentOutcome {
  if (results.some((result) => result.outcome === "FAILED")) return "INELIGIBLE";
  if (results.length === 0 || results.some((result) => result.outcome === "REVIEW_REQUIRED")) {
    return "REVIEW_REQUIRED";
  }
  return "ELIGIBLE";
}

function summarize(outcome: AssessmentOutcome, results: RuleResult[]): { reasonCodes: string[]; summary: string } {
  const reasonCodes = [...new Set(results.flatMap((result) => result.reasonCodes))];
  if (outcome === "ELIGIBLE") {
    return { reasonCodes, summary: "All configured eligibility rules passed." };
  }
  if (outcome === "INELIGIBLE") {
    return { reasonCodes, summary: "One or more eligibility rules failed." };
  }
  return {
    reasonCodes,
    summary: "One or more eligibility rules could not be conclusively evaluated.",
  };
}

export function buildEligibilitySnapshots(
  configuration: unknown,
  subject: AssessmentSubject,
): EligibilitySnapshots {
  const plan = parseEligibilityPlan(configuration);
  const inputs = inputSnapshot(subject);

  if (plan.kind === "no-rules") {
    return {
      inputSnapshot: inputs,
      ruleSnapshot: ruleSnapshot(subject, plan.eligibility),
      resultSnapshot: {
        outcome: "REVIEW_REQUIRED",
        reasonCodes: [NO_ELIGIBILITY_RULES_CONFIGURED],
        summary:
          "No eligibility rules are configured for this product version, so eligibility cannot be established.",
        rules: [],
      },
    };
  }

  const results = plan.rules.map((entry) => {
    const result = entry.rule.evaluate(entry.config, subject);
    return { ...result, index: entry.index, type: entry.rule.type };
  });
  const outcome = combineOutcomes(results);
  const explanation = summarize(outcome, results);

  return {
    inputSnapshot: inputs,
    ruleSnapshot: ruleSnapshot(
      subject,
      { rules: plan.rules.map((entry) => entry.config) },
    ),
    resultSnapshot: {
      outcome,
      reasonCodes: explanation.reasonCodes,
      summary: explanation.summary,
      rules: results,
    },
  };
}
