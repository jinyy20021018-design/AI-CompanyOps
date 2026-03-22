import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Test terminal:demote logic (session.json revert)
// Extracted from the handler in index.ts

function demoteSession(sessionDir: string): { mode: string; promoted: boolean } {
  const sessionJsonPath = path.join(sessionDir, "session.json");
  const sjson = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
  sjson.mode = "quick";
  sjson.promoted = false;
  delete sjson.promotedAt;
  fs.writeFileSync(sessionJsonPath, JSON.stringify(sjson, null, 2));
  return sjson;
}

describe("terminal:demote handler", () => {
  it("reverts mode to quick and promoted to false", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "demote-test-"));
    const sessionJson = path.join(tmpDir, "session.json");

    // Write a promoted session.json
    fs.writeFileSync(sessionJson, JSON.stringify({
      terminalId: "test-123",
      type: "claude",
      mode: "role",
      promoted: true,
      promotedAt: "2026-03-20T12:00:00Z",
      startedAt: "2026-03-20T11:00:00Z",
      endedAt: null,
      exitCode: null,
    }, null, 2));

    const result = demoteSession(tmpDir);

    expect(result.mode).toBe("quick");
    expect(result.promoted).toBe(false);
    expect(result).not.toHaveProperty("promotedAt");

    // Verify file was actually written
    const reread = JSON.parse(fs.readFileSync(sessionJson, "utf-8"));
    expect(reread.mode).toBe("quick");
    expect(reread.promoted).toBe(false);
    expect(reread.promotedAt).toBeUndefined();

    // Other fields preserved
    expect(reread.terminalId).toBe("test-123");
    expect(reread.startedAt).toBe("2026-03-20T11:00:00Z");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("works on a session that was never promoted (no-op)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "demote-test-"));
    const sessionJson = path.join(tmpDir, "session.json");

    fs.writeFileSync(sessionJson, JSON.stringify({
      terminalId: "test-456",
      type: "claude",
      mode: "quick",
      promoted: false,
      startedAt: "2026-03-20T11:00:00Z",
    }, null, 2));

    const result = demoteSession(tmpDir);
    expect(result.mode).toBe("quick");
    expect(result.promoted).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
