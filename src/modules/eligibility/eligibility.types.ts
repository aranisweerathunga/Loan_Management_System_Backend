export const assessmentOutcomes = ["ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"] as const;

export type AssessmentOutcome = (typeof assessmentOutcomes)[number];

export const ruleOutcomes = ["PASSED", "FAILED", "REVIEW_REQUIRED"] as const;

export type RuleOutcome = (typeof ruleOutcomes)[number];

export type AssessmentSubject = {
  application: {
    id: string;
    applicationNumber: string;
    status: "UNDER_REVIEW";
    borrowerId: string;
    loanProductId: string;
    productVersionId: string;
    productPurposeId: string | null;
  };
  borrower: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
  };
  loanProduct: {
    id: string;
    code: string;
    name: string;
  };
  productVersion: {
    id: string;
    versionNumber: number;
    status: string;
  };
  productPurpose: {
    id: string;
    code: string;
    name: string;
  } | null;
};

export type RuleResult = {
  index: number;
  type: string;
  outcome: RuleOutcome;
  reasonCodes: string[];
  summary: string;
  calculated?: Record<string, string>;
};

export type ExecutableRule = {
  type: string;
  validate(rule: unknown, index: number): unknown;
  evaluate(config: unknown, subject: AssessmentSubject): RuleResult;
};

export type EligibilitySnapshots = {
  inputSnapshot: Record<string, unknown>;
  ruleSnapshot: Record<string, unknown>;
  resultSnapshot: Record<string, unknown>;
};
