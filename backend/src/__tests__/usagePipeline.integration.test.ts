/**
 * Integration test: Usage Recording → Cost Summary Aggregation
 *
 * Tests the full usage logging pipeline:
 *   1. recordUsageEvent()    — appends to session + shared JSONL (usageLogger.ts)
 *   2. refreshCostSummary()  — recomputes cost_summary.json from usage.jsonl
 *   3. readCostSummary()     — reads the aggregated snapshot
 *
 * Uses a real temp filesystem. No mocks.
 * Verifies that token costs are recorded accurately and aggregated
 * correctly across sessions and models.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  recordUsageEvent,
  readCostSummary,
  ensureUsageFiles,
  ensureSessionUsageFile,
  type UsageEvent,
} from "../usageLogger.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    ts: "2026-04-26T00:00:00Z",
    session: "product",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    input_tokens: 1_000,
    output_tokens: 200,
    estimated_cost_usd: 0.002,
    ...overrides,
  };
}

function sharedUsagePath(folderPath: string) {
  return path.join(folderPath, "CoAgent_workspace", "_shared", "usage.jsonl");
}

function sessionUsagePath(folderPath: string, sessionName: string) {
  return path.join(folderPath, "CoAgent_workspace", "sessions", sessionName, "usage.jsonl");
}

function readJsonlLines(filePath: string): UsageEvent[] {
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map(line => JSON.parse(line));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coagent-usage-"));
  ensureUsageFiles(tmpDir);
  ensureSessionUsageFile(tmpDir, "product");
  ensureSessionUsageFile(tmpDir, "engineering");
  ensureSessionUsageFile(tmpDir, "marketing");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("usage event recording", () => {
  it("appends the event to the session-level usage.jsonl", () => {
    recordUsageEvent(tmpDir, "product", makeEvent());

    const lines = readJsonlLines(sessionUsagePath(tmpDir, "product"));
    expect(lines).toHaveLength(1);
    expect(lines[0].session).toBe("product");
    expect(lines[0].model).toBe("claude-haiku-4-5");
    expect(lines[0].estimated_cost_usd).toBe(0.002);
  });

  it("appends the event to the shared workspace usage.jsonl", () => {
    recordUsageEvent(tmpDir, "product", makeEvent());

    const lines = readJsonlLines(sharedUsagePath(tmpDir));
    expect(lines).toHaveLength(1);
    expect(lines[0].session).toBe("product");
  });

  it("normalises total_tokens when not provided", () => {
    // Event without total_tokens — usageLogger should compute it
    const event = makeEvent({
      input_tokens: 1_000,
      output_tokens: 200,
      cache_read_tokens: 500,
      cache_write_tokens: 100,
      total_tokens: undefined,
    });

    recordUsageEvent(tmpDir, "product", event);

    const lines = readJsonlLines(sharedUsagePath(tmpDir));
    // total_tokens = input + output + cache_read + cache_write = 1800
    expect(lines[0].total_tokens).toBe(1_800);
  });

  it("preserves total_tokens when already provided", () => {
    recordUsageEvent(tmpDir, "product", makeEvent({ total_tokens: 9_999 }));

    const lines = readJsonlLines(sharedUsagePath(tmpDir));
    expect(lines[0].total_tokens).toBe(9_999);
  });
});

describe("cost summary refresh after recording", () => {
  it("creates cost_summary.json immediately after recording", () => {
    const summaryPath = path.join(tmpDir, "CoAgent_workspace", "_shared", "cost_summary.json");
    // File exists from ensureUsageFiles (zeroed out), overwritten after recordUsageEvent
    recordUsageEvent(tmpDir, "product", makeEvent({ estimated_cost_usd: 0.005 }));

    const summary = readCostSummary(tmpDir);
    expect(summary).not.toBeNull();
    expect(summary!.workspace_total_usd).toBeCloseTo(0.005);
  });

  it("tracks cost by session", () => {
    recordUsageEvent(tmpDir, "product", makeEvent({ estimated_cost_usd: 0.010 }));

    const summary = readCostSummary(tmpDir);
    expect(summary!.by_session["product"]).toBeDefined();
    expect(summary!.by_session["product"].cost_usd).toBeCloseTo(0.010);
    expect(summary!.by_session["product"].provider).toBe("anthropic");
  });

  it("tracks cost by model", () => {
    recordUsageEvent(tmpDir, "product", makeEvent({ model: "claude-haiku-4-5", estimated_cost_usd: 0.003 }));

    const summary = readCostSummary(tmpDir);
    expect(summary!.by_model["claude-haiku-4-5"]).toBeDefined();
    expect(summary!.by_model["claude-haiku-4-5"].cost_usd).toBeCloseTo(0.003);
  });
});

describe("cost aggregation across multiple events", () => {
  it("accumulates costs from multiple calls by the same session", () => {
    recordUsageEvent(tmpDir, "product", makeEvent({ estimated_cost_usd: 0.001 }));
    recordUsageEvent(tmpDir, "product", makeEvent({ estimated_cost_usd: 0.002 }));
    recordUsageEvent(tmpDir, "product", makeEvent({ estimated_cost_usd: 0.003 }));

    const summary = readCostSummary(tmpDir);
    expect(summary!.workspace_total_usd).toBeCloseTo(0.006);
    expect(summary!.by_session["product"].cost_usd).toBeCloseTo(0.006);
  });

  it("aggregates costs across multiple sessions independently", () => {
    recordUsageEvent(tmpDir, "product",     makeEvent({ session: "product",     estimated_cost_usd: 0.010 }));
    recordUsageEvent(tmpDir, "engineering", makeEvent({ session: "engineering", estimated_cost_usd: 0.020 }));
    recordUsageEvent(tmpDir, "marketing",   makeEvent({ session: "marketing",   estimated_cost_usd: 0.005 }));

    const summary = readCostSummary(tmpDir);

    // Workspace total = sum of all sessions
    expect(summary!.workspace_total_usd).toBeCloseTo(0.035);

    // Each session tracked separately
    expect(summary!.by_session["product"].cost_usd).toBeCloseTo(0.010);
    expect(summary!.by_session["engineering"].cost_usd).toBeCloseTo(0.020);
    expect(summary!.by_session["marketing"].cost_usd).toBeCloseTo(0.005);
  });

  it("aggregates costs across different models", () => {
    recordUsageEvent(tmpDir, "product", makeEvent({
      model: "claude-haiku-4-5",
      estimated_cost_usd: 0.001,
    }));
    recordUsageEvent(tmpDir, "product", makeEvent({
      model: "claude-sonnet-4-6",
      estimated_cost_usd: 0.050,
    }));

    const summary = readCostSummary(tmpDir);
    expect(summary!.by_model["claude-haiku-4-5"].cost_usd).toBeCloseTo(0.001);
    expect(summary!.by_model["claude-sonnet-4-6"].cost_usd).toBeCloseTo(0.050);
    // Workspace total spans both models
    expect(summary!.workspace_total_usd).toBeCloseTo(0.051);
  });

  it("accumulates token counts alongside costs", () => {
    recordUsageEvent(tmpDir, "product", makeEvent({ input_tokens: 1_000, output_tokens: 200, total_tokens: 1_200, estimated_cost_usd: 0.001 }));
    recordUsageEvent(tmpDir, "product", makeEvent({ input_tokens: 2_000, output_tokens: 400, total_tokens: 2_400, estimated_cost_usd: 0.002 }));

    const summary = readCostSummary(tmpDir);
    expect(summary!.workspace_total_tokens).toBe(3_600);
    expect(summary!.by_session["product"].tokens).toBe(3_600);
  });
});

describe("shared JSONL as source of truth", () => {
  it("shared usage.jsonl contains events from all sessions", () => {
    recordUsageEvent(tmpDir, "product",     makeEvent({ session: "product" }));
    recordUsageEvent(tmpDir, "engineering", makeEvent({ session: "engineering" }));

    const lines = readJsonlLines(sharedUsagePath(tmpDir));
    expect(lines).toHaveLength(2);
    expect(lines.map(l => l.session)).toEqual(["product", "engineering"]);
  });

  it("session JSONL contains only that session's events", () => {
    recordUsageEvent(tmpDir, "product",     makeEvent({ session: "product" }));
    recordUsageEvent(tmpDir, "engineering", makeEvent({ session: "engineering" }));

    const productLines = readJsonlLines(sessionUsagePath(tmpDir, "product"));
    const engineeringLines = readJsonlLines(sessionUsagePath(tmpDir, "engineering"));

    expect(productLines).toHaveLength(1);
    expect(productLines[0].session).toBe("product");

    expect(engineeringLines).toHaveLength(1);
    expect(engineeringLines[0].session).toBe("engineering");
  });
});
