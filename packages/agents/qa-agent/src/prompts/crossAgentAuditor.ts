import type { NormalizedArtifacts } from "../internalTypes.js";

export function buildCrossAgentAuditorPrompt(userRequest: string, artifacts: NormalizedArtifacts): string {
  return [
    "You are a QA Agent auditing multiple departmental outputs before CEO-level integration.",
    "Focus on contradictions, unsupported claims, missing links, and scope drift across product, engineering, and finance.",
    "Return strict JSON with this shape:",
    '{"summary":"string","confidence":"low|medium|high","issues":[{"severity":"blocker|major|minor|info","criterion":"clarity|consistency|completeness|feasibility|alignment","sourceAgents":["product|engineering|finance"],"title":"string","evidence":"string","recommendation":"string"}]}',
    `User request:\n${userRequest}`,
    `Product artifact:\n${artifacts.product?.text ?? "MISSING"}`,
    `Engineering artifact:\n${artifacts.engineering?.text ?? "MISSING"}`,
    `Finance artifact:\n${artifacts.finance?.text ?? "MISSING"}`
  ].join("\n\n");
}
