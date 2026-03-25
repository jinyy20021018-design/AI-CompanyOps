import type { AgentName } from "../../../../shared/contracts/src/index.js";
import type {
  NormalizedArtifact,
  RequiredSection,
  ReviewBundle,
  ReviewIssueDraft
} from "../internalTypes.js";

const REQUIRED_SECTIONS: Record<AgentName, RequiredSection[]> = {
  product: [
    { key: "user segment", criterion: "alignment", patterns: [/user segment/i, /target user/i, /persona/i] },
    { key: "core features", criterion: "completeness", patterns: [/core features/i, /^#+\s*features/i] },
    { key: "success criteria", criterion: "completeness", patterns: [/success criteria/i, /success metrics/i] },
    { key: "acceptance criteria", criterion: "completeness", patterns: [/acceptance criteria/i, /acceptance/i] }
  ],
  engineering: [
    { key: "architecture", criterion: "completeness", patterns: [/architecture/i, /system design/i] },
    { key: "components/modules", criterion: "completeness", patterns: [/components/i, /modules/i] },
    { key: "data flow/api", criterion: "completeness", patterns: [/data flow/i, /api/i] },
    { key: "technical risks/constraints", criterion: "feasibility", patterns: [/risk/i, /constraint/i] }
  ],
  finance: [
    { key: "target market", criterion: "alignment", patterns: [/target market/i, /market/i] },
    { key: "costs", criterion: "completeness", patterns: [/cost/i, /budget/i] },
    { key: "revenue assumptions", criterion: "feasibility", patterns: [/revenue/i, /pricing/i, /assumption/i] },
    { key: "roi or break-even", criterion: "feasibility", patterns: [/roi/i, /break-even/i, /break even/i] }
  ]
};

function makeMissingSectionIssue(artifact: NormalizedArtifact, section: RequiredSection): ReviewIssueDraft {
  return {
    severity: "major",
    criterion: section.criterion,
    sourceAgents: [artifact.agent],
    title: `Missing required ${section.key} section in ${artifact.agent} artifact`,
    evidence: `The ${artifact.agent} artifact does not clearly include a section or heading for ${section.key}.`,
    recommendation: `Add a dedicated ${section.key} section so the CEO Agent can trace this artifact against the QA rubric.`
  };
}

function makeClarityIssue(artifact: NormalizedArtifact): ReviewIssueDraft {
  return {
    severity: "major",
    criterion: "clarity",
    sourceAgents: [artifact.agent],
    title: `${artifact.agent} artifact is too brief for reliable review`,
    evidence: `The ${artifact.agent} artifact contains very limited detail and does not provide enough structured content for QA validation.`,
    recommendation: `Expand the ${artifact.agent} output with explicit sections, rationale, and operational details before integration.`
  };
}

export function reviewIndividualArtifact(artifact: NormalizedArtifact): ReviewBundle {
  const issues: ReviewIssueDraft[] = [];
  const notes: string[] = [];
  const requiredSections = REQUIRED_SECTIONS[artifact.agent];

  if (artifact.text.length < 120 || artifact.sections.length < 2) {
    issues.push(makeClarityIssue(artifact));
    notes.push(`${artifact.agent} artifact triggered a clarity warning due to low structure.`);
  }

  for (const section of requiredSections) {
    const found = section.patterns.some((pattern) => pattern.test(artifact.text));
    if (!found) {
      issues.push(makeMissingSectionIssue(artifact, section));
    }
  }

  return { issues, notes };
}

export function reviewIndividualArtifacts(artifacts: {
  product?: NormalizedArtifact;
  engineering?: NormalizedArtifact;
  finance?: NormalizedArtifact;
}): ReviewBundle {
  const bundles = [artifacts.product, artifacts.engineering, artifacts.finance]
    .filter((artifact): artifact is NormalizedArtifact => Boolean(artifact))
    .map((artifact) => reviewIndividualArtifact(artifact));

  return {
    issues: bundles.flatMap((bundle) => bundle.issues),
    notes: bundles.flatMap((bundle) => bundle.notes)
  };
}
