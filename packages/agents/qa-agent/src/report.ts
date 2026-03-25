import type { QaIssue, QaReviewReport, ReviewRequest } from "../../../shared/contracts/src/index.js";
import { QaReviewReportSchema } from "../../../shared/contracts/src/index.js";
import type { LlmReviewResult, ReviewIssueDraft } from "./internalTypes.js";
import { calculateScorecard, determineStatus } from "./scoring.js";

function dedupeIssues(issueDrafts: ReviewIssueDraft[]): ReviewIssueDraft[] {
  const seen = new Set<string>();
  const result: ReviewIssueDraft[] = [];

  for (const issue of issueDrafts) {
    const key = `${issue.severity}|${issue.criterion}|${issue.title}|${issue.evidence}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(issue);
  }

  return result;
}

function assignIds(issueDrafts: ReviewIssueDraft[]): QaIssue[] {
  return issueDrafts.map((issue, index) => ({
    id: `qa-${String(index + 1).padStart(3, "0")}`,
    ...issue
  }));
}

export function buildQaReviewReport(params: {
  request: ReviewRequest;
  ruleIssues: ReviewIssueDraft[];
  llmResult?: LlmReviewResult;
  missingInputs: Array<"product" | "engineering" | "finance">;
  degradedReason?: string;
}): QaReviewReport {
  const issues = assignIds(dedupeIssues([...params.ruleIssues, ...(params.llmResult?.issues ?? [])]));
  const scorecard = calculateScorecard(issues);
  const status = determineStatus(issues, params.missingInputs);

  const summaryParts = [
    `QA review completed with status ${status.toUpperCase()}.`,
    `Detected ${issues.length} issue(s) across rule-based and semantic review.`,
    params.llmResult ? `LLM review summary: ${params.llmResult.summary}` : "LLM review was not used."
  ];

  if (params.degradedReason) {
    summaryParts.push(`Live review failed and rule-based output was returned. Reason: ${params.degradedReason}`);
  }

  const report = {
    status,
    summary: summaryParts.join(" "),
    scorecard,
    issues,
    missingInputs: params.missingInputs,
    generatedAt: new Date().toISOString()
  };

  return QaReviewReportSchema.parse(report);
}

export function renderMarkdownReport(report: QaReviewReport): string {
  const scoreLines = [
    `- Clarity: ${report.scorecard.clarity}/20`,
    `- Consistency: ${report.scorecard.consistency}/20`,
    `- Completeness: ${report.scorecard.completeness}/20`,
    `- Feasibility: ${report.scorecard.feasibility}/20`,
    `- Alignment: ${report.scorecard.alignment}/20`,
    `- Total: ${report.scorecard.total}/100`
  ];

  const issueLines = report.issues.length
    ? report.issues
        .map(
          (issue) =>
            `### ${issue.id} ${issue.severity.toUpperCase()} - ${issue.title}\nCriterion: ${issue.criterion}\nSource Agents: ${issue.sourceAgents.join(", ")}\nEvidence: ${issue.evidence}\nRecommendation: ${issue.recommendation}`
        )
        .join("\n\n")
    : "No issues were detected.";

  return [
    "# QA Review Report",
    "",
    `Status: **${report.status.toUpperCase()}**`,
    "",
    "## Summary",
    report.summary,
    "",
    "## Scorecard",
    ...scoreLines,
    "",
    "## Missing Inputs",
    report.missingInputs.length ? report.missingInputs.join(", ") : "None",
    "",
    "## Issues",
    issueLines
  ].join("\n");
}
