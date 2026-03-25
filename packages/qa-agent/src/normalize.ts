import type { AgentArtifact } from "../../shared-contracts/src/index.js";
import type { NormalizedArtifact, NormalizedArtifacts } from "./internalTypes.js";
import { cleanText, getSectionHeadings } from "./utils.js";

function normalizeJsonContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

export function normalizeArtifact(artifact: AgentArtifact): NormalizedArtifact {
  const rawContent = artifact.format === "json" ? normalizeJsonContent(artifact.content) : artifact.content;
  const text = cleanText(rawContent);

  return {
    agent: artifact.agent,
    format: artifact.format,
    version: artifact.version,
    rawContent,
    text,
    lowerText: text.toLowerCase(),
    sections: getSectionHeadings(text)
  };
}

export function normalizeArtifacts(artifacts: {
  product?: AgentArtifact;
  engineering?: AgentArtifact;
  finance?: AgentArtifact;
}): NormalizedArtifacts {
  return {
    product: artifacts.product ? normalizeArtifact(artifacts.product) : undefined,
    engineering: artifacts.engineering ? normalizeArtifact(artifacts.engineering) : undefined,
    finance: artifacts.finance ? normalizeArtifact(artifacts.finance) : undefined
  };
}
