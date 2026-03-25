import type { AgentName } from "../../../../shared/contracts/src/index.js";
import type { NormalizedArtifact, NormalizedArtifacts, ReviewBundle, ReviewIssueDraft } from "../internalTypes.js";
import { dedupeStrings, extractBulletItems, extractKeywords, findSectionContent } from "../utils.js";

function hasOverlap(first: string[], secondText: string): boolean {
  return first.some((item) => secondText.includes(item.toLowerCase()));
}

function buildAlignmentIssue(sourceAgents: AgentName[], title: string, evidence: string, recommendation: string): ReviewIssueDraft {
  return {
    severity: "major",
    criterion: "alignment",
    sourceAgents,
    title,
    evidence,
    recommendation
  };
}

function buildConsistencyIssue(sourceAgents: AgentName[], title: string, evidence: string, recommendation: string): ReviewIssueDraft {
  return {
    severity: "major",
    criterion: "consistency",
    sourceAgents,
    title,
    evidence,
    recommendation
  };
}

function evaluateRequestAlignment(userRequest: string, artifact: NormalizedArtifact): ReviewIssueDraft[] {
  const requestKeywords = extractKeywords(userRequest, 8);
  const overlap = requestKeywords.filter((keyword) => artifact.lowerText.includes(keyword));
  if (overlap.length > 0) {
    return [];
  }

  return [
    buildAlignmentIssue(
      [artifact.agent],
      `${artifact.agent} artifact is weakly aligned with the original user request`,
      `The ${artifact.agent} artifact does not reuse the core request keywords (${requestKeywords.join(", ")}), which suggests scope drift.`,
      `Restate the original business objective and ensure the ${artifact.agent} document addresses the same product concept.`
    )
  ];
}

function evaluateProductEngineering(product: NormalizedArtifact, engineering: NormalizedArtifact): ReviewIssueDraft[] {
  const featureText = findSectionContent(product.text, ["Core Features", "Features"]);
  const features = dedupeStrings(extractBulletItems(featureText).map((item) => item.toLowerCase()));
  if (features.length === 0) {
    return [];
  }

  const unsupported = features.filter((feature) => !hasOverlap(feature.split(/\s+/), engineering.lowerText));
  const issues: ReviewIssueDraft[] = [];

  if (unsupported.length > 0) {
    issues.push(
      buildConsistencyIssue(
        ["product", "engineering"],
        "Engineering artifact does not clearly implement all product features",
        `The following product features lack a visible implementation path in the engineering artifact: ${unsupported.join(", ")}.`,
        "Add explicit engineering coverage for the unsupported product features or revise the product scope."
      )
    );
  }

  if (/mobile/.test(product.lowerText) && /no mobile application/.test(engineering.lowerText)) {
    issues.push(
      buildConsistencyIssue(
        ["product", "engineering"],
        "Engineering delivery model conflicts with product channel assumptions",
        "The product artifact assumes a mobile experience, while the engineering artifact explicitly states there is no mobile application.",
        "Align the technical delivery model with the product channel strategy before final proposal integration."
      )
    );
  }

  if (/notification/.test(product.lowerText) && /no push notification support/.test(engineering.lowerText)) {
    issues.push(
      buildConsistencyIssue(
        ["product", "engineering"],
        "Notification feature is contradicted by engineering constraints",
        "The product artifact includes reminder notifications, but the engineering artifact states there is no push notification support.",
        "Revise the architecture or remove notification commitments from the product requirements."
      )
    );
  }

  return issues;
}

function evaluateEngineeringFinance(engineering: NormalizedArtifact, finance: NormalizedArtifact): ReviewIssueDraft[] {
  const costKeywords = [
    "cloud",
    "hosting",
    "database",
    "api",
    "model",
    "llm",
    "notification",
    "storage",
    "gpu"
  ].filter((keyword) => engineering.lowerText.includes(keyword));
  const missingInFinance = costKeywords.filter((keyword) => !finance.lowerText.includes(keyword));

  if (missingInFinance.length === 0) {
    return [];
  }

  return [
    buildConsistencyIssue(
      ["engineering", "finance"],
      "Finance artifact does not explain all engineering cost drivers",
      `The engineering artifact references cost drivers that are not reflected in finance: ${missingInFinance.join(", ")}.`,
      "Add the missing technical cost drivers to the finance report or explain why they are out of scope."
    )
  ];
}

function evaluateProductFinance(product: NormalizedArtifact, finance: NormalizedArtifact): ReviewIssueDraft[] {
  const productAudience = findSectionContent(product.text, ["User Segment", "Target User", "Persona"]);
  const financeAudience = findSectionContent(finance.text, ["Target Market", "Market"]);
  if (!productAudience || !financeAudience) {
    return [];
  }

  const productKeywords = extractKeywords(productAudience, 6);
  const financeKeywords = extractKeywords(financeAudience, 6);
  const overlap = productKeywords.filter((keyword) => financeKeywords.includes(keyword));

  if (overlap.length > 0) {
    return [];
  }

  return [
    buildAlignmentIssue(
      ["product", "finance"],
      "Product and finance artifacts target different customer groups",
      `Product user segment keywords (${productKeywords.join(", ")}) do not overlap with finance market keywords (${financeKeywords.join(", ")}).`,
      "Align the target market assumptions across product and finance before consolidating the proposal."
    )
  ];
}

export function reviewCrossAgentConsistency(userRequest: string, artifacts: NormalizedArtifacts): ReviewBundle {
  const issues: ReviewIssueDraft[] = [];
  const notes: string[] = [];

  for (const artifact of [artifacts.product, artifacts.engineering, artifacts.finance]) {
    if (!artifact) {
      continue;
    }
    issues.push(...evaluateRequestAlignment(userRequest, artifact));
  }

  if (artifacts.product && artifacts.engineering) {
    issues.push(...evaluateProductEngineering(artifacts.product, artifacts.engineering));
  }

  if (artifacts.engineering && artifacts.finance) {
    issues.push(...evaluateEngineeringFinance(artifacts.engineering, artifacts.finance));
  }

  if (artifacts.product && artifacts.finance) {
    issues.push(...evaluateProductFinance(artifacts.product, artifacts.finance));
  }

  if (issues.length > 0) {
    notes.push("Cross-agent review identified alignment or consistency gaps.");
  }

  return { issues, notes };
}
