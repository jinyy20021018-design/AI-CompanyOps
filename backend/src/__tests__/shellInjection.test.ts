import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Test that jq --arg safely encodes all dangerous content.
// The key insight: jq --arg reads values AFTER shell expansion,
// so the test must pass values via environment variables or stdin
// to avoid shell interpretation in the test itself.

function jqEncodeViaEnv(value: string): string {
  // Pass the dangerous value via an environment variable so the shell never interprets it
  return execSync(
    `jq -n -c --arg msg "$MSG" '{msg:$msg}'`,
    { encoding: "utf-8", env: { ...process.env, MSG: value } }
  ).trim();
}

describe("coagent CLI shell injection prevention", () => {
  it("jq safely encodes double quotes in message content", () => {
    const parsed = JSON.parse(jqEncodeViaEnv('He said "hello"'));
    expect(parsed.msg).toBe('He said "hello"');
  });

  it("jq safely encodes backslashes", () => {
    const parsed = JSON.parse(jqEncodeViaEnv("path\\to\\file"));
    expect(parsed.msg).toBe("path\\to\\file");
  });

  it("jq safely encodes dollar sign + parens (command substitution)", () => {
    const parsed = JSON.parse(jqEncodeViaEnv("$(rm -rf /)"));
    expect(parsed.msg).toBe("$(rm -rf /)");
  });

  it("jq safely encodes backticks (legacy command substitution)", () => {
    const parsed = JSON.parse(jqEncodeViaEnv("`whoami`"));
    expect(parsed.msg).toBe("`whoami`");
  });

  it("jq safely encodes newlines", () => {
    const parsed = JSON.parse(jqEncodeViaEnv("line1\nline2"));
    expect(parsed.msg).toBe("line1\nline2");
  });

  it("jq safely encodes tabs and control characters", () => {
    const parsed = JSON.parse(jqEncodeViaEnv("col1\tcol2"));
    expect(parsed.msg).toBe("col1\tcol2");
  });

  it("produces valid JSON for a full message with dangerous content", () => {
    const dangerous = 'He said "hello" and ran `whoami` then $(echo pwned)';
    const result = execSync(
      `jq -n -c --arg ts "2026-03-22" --arg from "worker" --arg to "*" --arg tag "status" --arg msg "$MSG" --arg id "msg-1" --arg msgType "chat" '{ts:$ts,from:$from,to:$to,tag:$tag,msg:$msg,id:$id,msgType:$msgType,status:"sent"}'`,
      { encoding: "utf-8", env: { ...process.env, MSG: dangerous } }
    ).trim();
    const parsed = JSON.parse(result);
    expect(parsed.msg).toContain("`whoami`");
    expect(parsed.msg).toContain("$(echo pwned)");
    expect(parsed.status).toBe("sent");
  });

  it("the coagent send pattern writes valid JSONL without executing injection", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coagent-test-"));
    const scratchpad = path.join(tmpDir, "scratchpad.jsonl");
    fs.writeFileSync(scratchpad, "");

    try {
      // Simulate: MSG='$(echo INJECTED)' passed as env var, jq uses --arg "$MSG"
      execSync(
        `jq -n -c --arg ts "2026-03-22" --arg from "test" --arg to "*" --arg tag "s" --arg msg "$MSG" --arg id "t" --arg msgType "chat" '{ts:$ts,from:$from,to:$to,tag:$tag,msg:$msg,id:$id,msgType:$msgType,status:"sent"}' >> "${scratchpad}"`,
        { encoding: "utf-8", env: { ...process.env, MSG: "$(echo INJECTED)" } }
      );

      const content = fs.readFileSync(scratchpad, "utf-8").trim();
      const parsed = JSON.parse(content);
      expect(parsed.msg).toBe("$(echo INJECTED)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
