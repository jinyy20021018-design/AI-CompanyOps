export const AGENT_NAMES = ["product", "engineering", "finance"] as const;
export const ARTIFACT_FORMATS = ["markdown", "json", "text"] as const;
export const REVIEW_MODES = ["mock", "live"] as const;
export const OUTPUT_FORMATS = ["json", "markdown"] as const;
export const ISSUE_SEVERITIES = ["blocker", "major", "minor", "info"] as const;
export const REVIEW_CRITERIA = [
  "clarity",
  "consistency",
  "completeness",
  "feasibility",
  "alignment"
] as const;
export const REVIEW_STATUSES = ["pass", "revise", "fail"] as const;
export const SCORE_DEDUCTIONS = {
  blocker: 10,
  major: 5,
  minor: 2,
  info: 0
} as const;
