import type { z } from "zod";
import type {
  AgentArtifactSchema,
  AgentNameSchema,
  ArtifactFormatSchema,
  OutputFormatSchema,
  QaIssueSchema,
  QaReviewReportSchema,
  QaScorecardSchema,
  ReviewCriterionSchema,
  ReviewModeSchema,
  ReviewRequestSchema,
  ReviewStatusSchema
} from "./schemas.js";

export type AgentName = z.infer<typeof AgentNameSchema>;
export type ArtifactFormat = z.infer<typeof ArtifactFormatSchema>;
export type ReviewMode = z.infer<typeof ReviewModeSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type ReviewCriterion = z.infer<typeof ReviewCriterionSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type QaIssue = z.infer<typeof QaIssueSchema>;
export type QaScorecard = z.infer<typeof QaScorecardSchema>;
export type QaReviewReport = z.infer<typeof QaReviewReportSchema>;
