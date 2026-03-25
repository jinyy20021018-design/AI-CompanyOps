import { readFile } from "node:fs/promises";
import { IssueSeveritySchema, ReviewCriterionSchema } from "../../../shared-contracts/src/index.js";
import type { ReviewRequest } from "../../../shared-contracts/src/index.js";
import type { LlmReviewResult, NormalizedArtifacts, ReviewIssueDraft } from "../internalTypes.js";

function inferScenario(request: ReviewRequest, artifacts: NormalizedArtifacts): string {
  const missingCount = ["product", "engineering", "finance"].filter((key) => !request.artifacts[key as keyof typeof request.artifacts]).length;
  const combinedText = [artifacts.product?.lowerText, artifacts.engineering?.lowerText, artifacts.finance?.lowerText]
    .filter(Boolean)
    .join("\n");

  if (missingCount >= 2 || combinedText.length < 300) {
    return "missing-sections";
  }

  if (combinedText.includes("kiosk") || combinedText.includes("gym operators") || combinedText.includes("no mobile application")) {
    return "conflict";
  }

  return "happy-path";
}

function normalizeDraft(issue: Omit<ReviewIssueDraft, "sourceAgents"> & { sourceAgents: string[] }): ReviewIssueDraft {
  const severity = IssueSeveritySchema.parse(issue.severity);
  const criterion = ReviewCriterionSchema.parse(issue.criterion);
  const sourceAgents = issue.sourceAgents.filter((agent): agent is ReviewIssueDraft["sourceAgents"][number] =>
    ["product", "engineering", "finance"].includes(agent)
  );

  return {
    severity,
    criterion,
    sourceAgents: sourceAgents.length > 0 ? sourceAgents : ["product"],
    title: issue.title,
    evidence: issue.evidence,
    recommendation: issue.recommendation
  };
}

export async function runMockReview(request: ReviewRequest, artifacts: NormalizedArtifacts): Promise<LlmReviewResult> {
  const scenario = inferScenario(request, artifacts);
  const fileUrl = new URL(`../../../../fixtures/mock-llm/${scenario}.json`, import.meta.url);
  const raw = await readFile(fileUrl, "utf8");
  const parsed = JSON.parse(raw) as {
    summary: string;
    confidence: "low" | "medium" | "high";
    issues: Array<{
      severity: "blocker" | "major" | "minor" | "info";
      criterion: "clarity" | "consistency" | "completeness" | "feasibility" | "alignment";
      sourceAgents: string[];
      title: string;
      evidence: string;
      recommendation: string;
    }>;
  };

  return {
    summary: parsed.summary,
    confidence: parsed.confidence,
    issues: parsed.issues.map((issue) => normalizeDraft(issue))
  };
}
