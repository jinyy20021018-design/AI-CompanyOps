import { z } from "zod";
import {
  AGENT_NAMES,
  ARTIFACT_FORMATS,
  ISSUE_SEVERITIES,
  OUTPUT_FORMATS,
  REVIEW_CRITERIA,
  REVIEW_MODES,
  REVIEW_STATUSES
} from "./constants.js";

export const AgentNameSchema = z.enum(AGENT_NAMES);
export const ArtifactFormatSchema = z.enum(ARTIFACT_FORMATS);
export const ReviewModeSchema = z.enum(REVIEW_MODES);
export const OutputFormatSchema = z.enum(OUTPUT_FORMATS);
export const IssueSeveritySchema = z.enum(ISSUE_SEVERITIES);
export const ReviewCriterionSchema = z.enum(REVIEW_CRITERIA);
export const ReviewStatusSchema = z.enum(REVIEW_STATUSES);

export const AgentArtifactSchema = z.object({
  agent: AgentNameSchema,
  content: z.string().min(1),
  format: ArtifactFormatSchema,
  version: z.string().min(1).optional()
});

export const ReviewOptionsSchema = z.object({
  mode: ReviewModeSchema.optional(),
  outputFormat: OutputFormatSchema.optional()
});

export const ReviewRequestSchema = z.object({
  userRequest: z.string().min(1),
  artifacts: z.object({
    product: AgentArtifactSchema.optional(),
    engineering: AgentArtifactSchema.optional(),
    finance: AgentArtifactSchema.optional()
  }),
  options: ReviewOptionsSchema.optional()
});

export const QaIssueSchema = z.object({
  id: z.string().min(1),
  severity: IssueSeveritySchema,
  criterion: ReviewCriterionSchema,
  sourceAgents: z.array(AgentNameSchema).min(1),
  title: z.string().min(1),
  evidence: z.string().min(1),
  recommendation: z.string().min(1)
});

export const QaScorecardSchema = z.object({
  clarity: z.number().min(0).max(20),
  consistency: z.number().min(0).max(20),
  completeness: z.number().min(0).max(20),
  feasibility: z.number().min(0).max(20),
  alignment: z.number().min(0).max(20),
  total: z.number().min(0).max(100)
});

export const QaReviewReportSchema = z.object({
  status: ReviewStatusSchema,
  summary: z.string().min(1),
  scorecard: QaScorecardSchema,
  issues: z.array(QaIssueSchema),
  missingInputs: z.array(AgentNameSchema),
  generatedAt: z.string().datetime()
});
