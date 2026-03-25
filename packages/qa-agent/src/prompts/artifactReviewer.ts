import type { AgentName } from "../../../shared-contracts/src/index.js";
import type { NormalizedArtifact } from "../internalTypes.js";

export function buildArtifactReviewerPrompt(userRequest: string, artifact: NormalizedArtifact): string {
  return [
    "Review the following agent artifact for QA purposes.",
    "Evaluate clarity, consistency, completeness, feasibility, and alignment with the user request.",
    "Return strict JSON with this shape:",
    '{"summary":"string","confidence":"low|medium|high","issues":[{"severity":"blocker|major|minor|info","criterion":"clarity|consistency|completeness|feasibility|alignment","sourceAgents":["product|engineering|finance"],"title":"string","evidence":"string","recommendation":"string"}]}',
    `User request:\n${userRequest}`,
    `Artifact agent: ${artifact.agent as AgentName}`,
    `Artifact content:\n${artifact.text}`
  ].join("\n\n");
}
