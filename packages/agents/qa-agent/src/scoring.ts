import type {
  QaIssue,
  QaScorecard,
  ReviewCriterion,
  ReviewStatus
} from "../../../shared/contracts/src/index.js";
import { REVIEW_CRITERIA, SCORE_DEDUCTIONS } from "../../../shared/contracts/src/index.js";

function clampScore(value: number): number {
  return Math.max(0, Math.min(20, value));
}

export function calculateScorecard(issues: QaIssue[]): QaScorecard {
  const scores = Object.fromEntries(REVIEW_CRITERIA.map((criterion) => [criterion, 20])) as Record<
    ReviewCriterion,
    number
  >;

  for (const issue of issues) {
    scores[issue.criterion] = clampScore(scores[issue.criterion] - SCORE_DEDUCTIONS[issue.severity]);
  }

  return {
    clarity: scores.clarity,
    consistency: scores.consistency,
    completeness: scores.completeness,
    feasibility: scores.feasibility,
    alignment: scores.alignment,
    total: REVIEW_CRITERIA.reduce((sum, criterion) => sum + scores[criterion], 0)
  };
}

export function determineStatus(issues: QaIssue[], missingInputs: string[]): ReviewStatus {
  if (issues.some((issue) => issue.severity === "blocker")) {
    return "fail";
  }

  if (issues.some((issue) => issue.severity === "major")) {
    return "revise";
  }

  if (missingInputs.length === 1) {
    return "revise";
  }

  return "pass";
}
