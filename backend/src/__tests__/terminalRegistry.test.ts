import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalRegistry, type TerminalRegistryEntry } from "../terminalRegistry.js";

function makeFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coagent-registry-"));
}

function makeEntry(overrides: Partial<TerminalRegistryEntry> = {}): TerminalRegistryEntry {
  return {
    terminalId: "term-1",
    pathId: "old-folder",
    sessionName: "coordinator",
    sessionDir: "/tmp/session",
    sessionType: "coordinator",
    role: "coordinator",
    title: "CEO",
    x: 0,
    y: 0,
    width: 500,
    height: 320,
    pid: 12345,
    startedAt: "2026-05-01T00:00:00.000Z",
    status: "running",
    mode: "role",
    provider: "claude",
    persistence: "persistent",
    ...overrides,
  };
}

describe("TerminalRegistry", () => {
  it("normalizes restored entries to the current folder id", () => {
    const folder = makeFolder();
    const registry = new TerminalRegistry();
    registry.register(folder, makeEntry());

    registry.normalizePathId(folder, "current-folder");

    expect(registry.load(folder)[0].pathId).toBe("current-folder");
  });

  it("revives an exited entry when a container with the terminal id is still running", () => {
    const folder = makeFolder();
    const registry = new TerminalRegistry();
    registry.register(folder, makeEntry({
      status: "exited",
      exitedAt: "2026-05-01T00:01:00.000Z",
      exitCode: -1,
    }));

    registry.pruneStale(folder, { isAlive: (entry) => entry.terminalId === "term-1" });

    const entry = registry.load(folder)[0];
    expect(entry.status).toBe("running");
    expect(entry.exitedAt).toBeUndefined();
    expect(entry.exitCode).toBeUndefined();
  });
});
