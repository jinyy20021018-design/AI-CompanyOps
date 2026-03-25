import { describe, expect, it } from "vitest";
import happyPath from "../fixtures/happy-path.request.json" with { type: "json" };
import missingSections from "../fixtures/missing-sections.request.json" with { type: "json" };
import { ReviewRequestSchema } from "../packages/shared-contracts/src/index.js";
import { reviewQaRequest } from "../packages/qa-agent/src/index.js";
import { normalizeArtifacts } from "../packages/qa-agent/src/normalize.js";
import { reviewIndividualArtifacts } from "../packages/qa-agent/src/rules/individual.js";

const happyRequest = ReviewRequestSchema.parse(happyPath);
const missingRequest = ReviewRequestSchema.parse(missingSections);

describe("qa-agent core", () => {
  it("normalizes artifacts into lower-cased reviewable text", () => {
    const normalized = normalizeArtifacts(happyRequest.artifacts);
    expect(normalized.product?.lowerText).toContain("busy professionals");
    expect(normalized.product?.sections).toContain("user segment");
  });

  it("flags missing required sections in sparse artifacts", () => {
    const normalized = normalizeArtifacts(missingRequest.artifacts);
    const bundle = reviewIndividualArtifacts(normalized);
    expect(bundle.issues.some((issue) => issue.title.includes("Missing required"))).toBe(true);
  });

  it("returns fail when multiple critical artifacts are missing", async () => {
    const report = await reviewQaRequest(missingRequest, {});
    expect(report.status).toBe("fail");
    expect(report.missingInputs).toEqual(["engineering", "finance"]);
  });

  it("returns pass or revise for the happy path sample with mock review", async () => {
    const report = await reviewQaRequest(happyRequest, {});
    expect(["pass", "revise"]).toContain(report.status);
    expect(report.issues.length).toBeGreaterThan(0);
  });
});
