import { describe, expect, it } from "vitest";
import conflictPath from "../fixtures/conflict.request.json" with { type: "json" };
import missingSections from "../fixtures/missing-sections.request.json" with { type: "json" };
import { runCli } from "../apps/qa-entry/src/cli.js";
import { buildServer } from "../apps/qa-entry/src/server.js";
import { loadEnv } from "../apps/qa-entry/src/loadEnv.js";
import { ReviewRequestSchema } from "../packages/shared/contracts/src/index.js";

const conflictRequest = ReviewRequestSchema.parse(conflictPath);
const missingRequest = ReviewRequestSchema.parse(missingSections);

describe("qa-agent integration", () => {
  it("CLI returns JSON output in mock mode", async () => {
    const result = await runCli(["--input", "./fixtures/happy-path.request.json", "--format", "json", "--mode", "mock"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).status).toBeTruthy();
  });

  it("CLI returns Markdown output in mock mode", async () => {
    const result = await runCli(["--input", "./fixtures/happy-path.request.json", "--format", "markdown", "--mode", "mock"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# QA Review Report");
  });

  it("API returns a structured review report", async () => {
    const server = buildServer(loadEnv());
    const response = await server.inject({
      method: "POST",
      url: "/qa/review",
      payload: conflictRequest
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("revise");
    await server.close();
  });

  it("API marks missing critical artifacts as fail", async () => {
    const server = buildServer(loadEnv());
    const response = await server.inject({
      method: "POST",
      url: "/qa/review",
      payload: missingRequest
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("fail");
    await server.close();
  });

  it("live mode degrades gracefully when provider config is absent", async () => {
    const payload = {
      ...conflictRequest,
      options: {
        mode: "live",
        outputFormat: "json"
      }
    };
    const server = buildServer({ port: 3000 });
    const response = await server.inject({
      method: "POST",
      url: "/qa/review",
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().summary).toContain("Live review failed and rule-based output was returned");
    await server.close();
  });
});
