import type {
  AgentArtifact,
  AgentName,
  ArtifactFormat,
  QaIssue,
  ReviewCriterion
} from "../../shared-contracts/src/index.js";

export interface NormalizedArtifact {
  agent: AgentName;
  format: ArtifactFormat;
  version?: string;
  rawContent: string;
  text: string;
  lowerText: string;
  sections: string[];
}

export type ReviewIssueDraft = Omit<QaIssue, "id">;

export interface ReviewBundle {
  issues: ReviewIssueDraft[];
  notes: string[];
}

export interface LlmReviewResult {
  summary: string;
  issues: ReviewIssueDraft[];
  confidence: "low" | "medium" | "high";
}

export interface ReviewRuntimeConfig {
  llmProvider?: string;
  llmModel?: string;
}

export interface NormalizedArtifacts {
  product?: NormalizedArtifact;
  engineering?: NormalizedArtifact;
  finance?: NormalizedArtifact;
}

export interface RequiredSection {
  key: string;
  criterion: ReviewCriterion;
  patterns: RegExp[];
}

export type ArtifactMap = Record<AgentName, AgentArtifact | undefined>;
