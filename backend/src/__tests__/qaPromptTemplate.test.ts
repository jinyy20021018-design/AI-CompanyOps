import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ensureWorkspace } from "../workspace.js";
import { createSessionFolder } from "../sessionLifecycle.js";

function mkTmpWorkspaceRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coagent-qa-prompt-"));
}

describe("QA prompt template integrity", () => {
  it("seeds QA prompt with shared artifact workflow and blocker command", () => {
    const folder = mkTmpWorkspaceRoot();
    try {
      ensureWorkspace(folder);
      const qaPromptPath = path.join(folder, "CoAgent_workspace", "_shared", "agents", "qa-prompt.md");
      const content = fs.readFileSync(qaPromptPath, "utf-8");

      expect(content).toContain("$COAGENT_SHARED_DIR/artifacts/engineering/tech-plan.md");
      expect(content).toContain("$COAGENT_SHARED_DIR/artifacts/product/prd.md");
      expect(content).toContain('coagent send --to "role:coordinator" --type blocker --msg');
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("regenerates missing department prompt templates before creating QA session", () => {
    const folder = mkTmpWorkspaceRoot();
    try {
      ensureWorkspace(folder);
      const qaPromptPath = path.join(folder, "CoAgent_workspace", "_shared", "agents", "qa-prompt.md");
      fs.rmSync(qaPromptPath, { force: true });

      const created = createSessionFolder(folder, "abcd1234", "qa", "role");
      const claudePath = path.join(created.sessionDir, "CLAUDE.md");
      const content = fs.readFileSync(claudePath, "utf-8");

      expect(fs.existsSync(qaPromptPath)).toBe(true);
      expect(content).toContain("$COAGENT_SHARED_DIR/artifacts/engineering/tech-plan.md");
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
