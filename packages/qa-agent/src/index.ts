import { ReviewRequestSchema } from "../../shared-contracts/src/index.js";
import type { QaReviewReport, ReviewRequest } from "../../shared-contracts/src/index.js";
import type {
  LlmReviewResult,
  NormalizedArtifacts,
  ReviewIssueDraft,
  ReviewRuntimeConfig
} from "./internalTypes.js";
import { runLiveReview } from "./llm/liveReviewer.js";
import { runMockReview } from "./llm/mockReviewer.js";
import { normalizeArtifacts } from "./normalize.js";
import { buildQaReviewReport, renderMarkdownReport } from "./report.js";
import { reviewCrossAgentConsistency } from "./rules/crossAgent.js";
import { reviewIndividualArtifacts } from "./rules/individual.js";

function collectMissingInputs(artifacts: ReviewRequest["artifacts"]): Array<"product" | "engineering" | "finance"> {
  const missing: Array<"product" | "engineering" | "finance"> = [];
  if (!artifacts.product) {
    missing.push("product");
  }
  if (!artifacts.engineering) {
    missing.push("engineering");
  }
  if (!artifacts.finance) {
    missing.push("finance");
  }
  return missing;
}

function buildMissingInputIssues(missingInputs: Array<"product" | "engineering" | "finance">): ReviewIssueDraft[] {
  if (missingInputs.length === 0) {
    return [];
  }

  if (missingInputs.length >= 2) {
    return [
      {
        severity: "blocker",
        criterion: "completeness",
        sourceAgents: ["product", "engineering", "finance"],
        title: "Multiple critical agent outputs are missing",
        evidence: `The following required artifacts are missing: ${missingInputs.join(", ")}.`,
        recommendation: "Provide the missing departmental outputs before the CEO Agent attempts final consolidation."
      }
    ];
  }

  return [
    {
      severity: "major",
      criterion: "completeness",
      sourceAgents: missingInputs,
      title: "One required agent output is missing",
      evidence: `The following required artifact is missing: ${missingInputs[0]}.`,
      recommendation: "Provide the missing artifact so the QA Agent can complete a full cross-agent review."
    }
  ];
}

async function runSemanticReview(
  request: ReviewRequest,
  artifacts: NormalizedArtifacts,
  runtime: ReviewRuntimeConfig
): Promise<{ llmResult?: LlmReviewResult; degradedReason?: string }> {
  const mode = request.options?.mode ?? "mock";
  if (mode === "mock") {
    return { llmResult: await runMockReview(request, artifacts) };
  }

  try {
    return { llmResult: await runLiveReview(request, artifacts, runtime) };
  } catch (error) {
    const degradedReason = error instanceof Error ? error.message : "Unknown live review error.";
    return { degradedReason };
  }
}

export async function reviewQaRequest(input: unknown, runtime: ReviewRuntimeConfig = {}): Promise<QaReviewReport> {
  const request = ReviewRequestSchema.parse(input);
  const normalizedArtifacts = normalizeArtifacts(request.artifacts);
  const missingInputs = collectMissingInputs(request.artifacts);
  const missingIssues = buildMissingInputIssues(missingInputs);
  const individualBundle = reviewIndividualArtifacts(normalizedArtifacts);
  const crossBundle = reviewCrossAgentConsistency(request.userRequest, normalizedArtifacts);
  const { llmResult, degradedReason } = await runSemanticReview(request, normalizedArtifacts, runtime);

  return buildQaReviewReport({
    request,
    ruleIssues: [...missingIssues, ...individualBundle.issues, ...crossBundle.issues],
    llmResult,
    missingInputs,
    degradedReason
  });
}

export { normalizeArtifacts, renderMarkdownReport };
