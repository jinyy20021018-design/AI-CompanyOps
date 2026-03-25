import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { z } from "zod";
import type { ReviewRequest } from "../../../../shared/contracts/src/index.js";
import { buildCrossAgentAuditorPrompt } from "../prompts/crossAgentAuditor.js";
import { buildArtifactReviewerPrompt } from "../prompts/artifactReviewer.js";
import type { LlmReviewResult, NormalizedArtifact, NormalizedArtifacts, ReviewRuntimeConfig } from "../internalTypes.js";

const LlmIssueSchema = z.object({
  severity: z.enum(["blocker", "major", "minor", "info"]),
  criterion: z.enum(["clarity", "consistency", "completeness", "feasibility", "alignment"]),
  sourceAgents: z.array(z.enum(["product", "engineering", "finance"])).min(1),
  title: z.string().min(1),
  evidence: z.string().min(1),
  recommendation: z.string().min(1)
});

const LlmReviewSchema = z.object({
  summary: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  issues: z.array(LlmIssueSchema)
});

function extractAssistantText(messages: unknown[]): string {
  const assistant = [...messages].reverse().find((message) => {
    return typeof message === "object" && message !== null && "role" in message && (message as { role?: string }).role === "assistant";
  }) as { content?: unknown } | undefined;

  if (!assistant) {
    return "";
  }

  const { content } = assistant;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .flatMap((item) => {
        if (typeof item !== "object" || item === null) {
          return [];
        }
        if ("type" in item && (item as { type?: string }).type === "text" && "text" in item) {
          return [String((item as { text: unknown }).text)];
        }
        return [];
      })
      .join("\n")
      .trim();
  }

  return "";
}

function extractJson(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Unable to extract JSON payload from LLM response.");
}

async function runJsonPrompt(prompt: string, runtime: ReviewRuntimeConfig): Promise<LlmReviewResult> {
  if (!runtime.llmProvider || !runtime.llmModel) {
    throw new Error("Missing QA_LLM_PROVIDER or QA_LLM_MODEL for live mode.");
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: "You are a strict QA reviewer. Return valid JSON only.",
      model: getModel(runtime.llmProvider as never, runtime.llmModel as never),
      thinkingLevel: "low",
      tools: [],
      messages: []
    }
  });

  await agent.prompt(prompt);
  const rawText = extractAssistantText(agent.state.messages as unknown[]);
  const parsed = LlmReviewSchema.parse(JSON.parse(extractJson(rawText)));

  return {
    summary: parsed.summary,
    confidence: parsed.confidence,
    issues: parsed.issues
  };
}

async function reviewArtifact(userRequest: string, artifact: NormalizedArtifact, runtime: ReviewRuntimeConfig): Promise<LlmReviewResult> {
  return runJsonPrompt(buildArtifactReviewerPrompt(userRequest, artifact), runtime);
}

export async function runLiveReview(
  request: ReviewRequest,
  artifacts: NormalizedArtifacts,
  runtime: ReviewRuntimeConfig
): Promise<LlmReviewResult> {
  const artifactResults: LlmReviewResult[] = [];

  for (const artifact of [artifacts.product, artifacts.engineering, artifacts.finance]) {
    if (!artifact) {
      continue;
    }
    artifactResults.push(await reviewArtifact(request.userRequest, artifact, runtime));
  }

  const crossAgentResult = await runJsonPrompt(buildCrossAgentAuditorPrompt(request.userRequest, artifacts), runtime);

  return {
    summary: [artifactResults.map((result) => result.summary).join(" "), crossAgentResult.summary].join(" ").trim(),
    confidence: crossAgentResult.confidence,
    issues: [...artifactResults.flatMap((result) => result.issues), ...crossAgentResult.issues]
  };
}
