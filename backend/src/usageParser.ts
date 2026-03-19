/**
 * Scan Claude Code's session JSONL files (~/.claude/projects/) to aggregate
 * token usage and estimate costs.
 *
 * Each assistant turn in those files contains `message.usage` with:
 *   input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
 * plus `message.model`.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CostSummary } from "./usageLogger.js";

// ── Pricing per million tokens ──────────────────────────────────────────────
const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-4-5":   { input: 1,  output: 5,  cacheWrite: 1.25,  cacheRead: 0.10 },
  "claude-sonnet-4-6":  { input: 3,  output: 15, cacheWrite: 3.75,  cacheRead: 0.30 },
  "claude-opus-4-6":    { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
};

function matchPricing(model: string) {
  if (PRICING[model]) return PRICING[model];
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  if (model.includes("haiku"))  return PRICING["claude-haiku-4-5"];
  if (model.includes("sonnet")) return PRICING["claude-sonnet-4-6"];
  if (model.includes("opus"))   return PRICING["claude-opus-4-6"];
  return PRICING["claude-sonnet-4-6"];
}

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  const p = matchPricing(model);
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheWriteTokens * p.cacheWrite +
      cacheReadTokens * p.cacheRead) / 1_000_000
  );
}

// ── Path helpers ────────────────────────────────────────────────────────────

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const CLAUDE_SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");

/** Convert a CWD path to Claude's project directory name: replace `/`, `_`, spaces, and `.` with `-`. */
export function cwdToClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[\/_ .]/g, "-");
}

// ── PID → Claude sessionId mapping ──────────────────────────────────────────

type ClaudeSessionInfo = {
  pid: number;
  sessionId: string;
  cwd: string;
};

/**
 * Build a map from Claude sessionId → terminal sessionName.
 *
 * Uses ~/.claude/sessions/<pid>.json to resolve PID → Claude sessionId,
 * then maps that to the terminal registry's sessionName via the provided
 * pid→sessionName mapping.
 */
function buildSessionIdMap(pidToSessionName: Map<number, string>): Map<string, string> {
  const map = new Map<string, string>();
  if (pidToSessionName.size === 0) return map;

  for (const [pid, sessionName] of pidToSessionName) {
    const sessionFile = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
    try {
      const info: ClaudeSessionInfo = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      if (info.sessionId) {
        map.set(info.sessionId, sessionName);
      }
    } catch {
      // PID file may not exist (e.g. codex terminals, or already cleaned up)
    }
  }
  return map;
}

// ── Scanner ─────────────────────────────────────────────────────────────────

type SessionAgg = {
  provider: string;
  cost_usd: number;
  tokens: number;
};

type ModelAgg = {
  cost_usd: number;
  tokens: number;
};

/**
 * Scan Claude's JSONL session files for a workspace folder.
 *
 * @param folderPath - The workspace folder path
 * @param pidToSessionName - Map of terminal PIDs to their session names (from terminal registry)
 */
export function scanClaudeUsage(
  folderPath: string,
  pidToSessionName: Map<number, string>,
): CostSummary {
  const prefix = cwdToClaudeProjectDir(folderPath);
  const bySession: Record<string, SessionAgg> = {};
  const byModel: Record<string, ModelAgg> = {};
  let totalUsd = 0;
  let totalTokens = 0;

  // Build Claude sessionId → terminal sessionName mapping
  const sessionIdToName = buildSessionIdMap(pidToSessionName);

  // Find all matching project dirs
  let projectDirs: string[] = [];
  try {
    const allDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
    projectDirs = allDirs.filter((d) => d === prefix || d.startsWith(prefix + "-"));
  } catch {
    // ~/.claude/projects may not exist
  }

  for (const dirName of projectDirs) {
    const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);
    let jsonlFiles: string[] = [];
    try {
      jsonlFiles = fs
        .readdirSync(dirPath)
        .filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    // For coordinator subdirs, derive label from the dir name
    const isWorkspaceRoot = dirName === prefix;
    const dirSessionLabel = isWorkspaceRoot ? null : deriveSessionLabel(dirName, prefix);

    for (const file of jsonlFiles) {
      // The JSONL filename (without extension) is the Claude sessionId
      const claudeSessionId = file.replace(".jsonl", "");

      // Determine session label for this file:
      // 1. If we have a PID mapping for this Claude session, use the terminal's sessionName
      // 2. If it's a coordinator subdir, use the derived label
      // 3. Otherwise fall back to "workspace"
      const sessionLabel =
        sessionIdToName.get(claudeSessionId) ??
        dirSessionLabel ??
        "workspace";

      const filePath = path.join(dirPath, file);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        if (obj.type !== "assistant" || !obj.message?.usage) continue;

        const usage = obj.message.usage;
        const model: string = obj.message.model ?? "unknown";
        const inputTokens: number = usage.input_tokens ?? 0;
        const outputTokens: number = usage.output_tokens ?? 0;
        const cacheWriteTokens: number = usage.cache_creation_input_tokens ?? 0;
        const cacheReadTokens: number = usage.cache_read_input_tokens ?? 0;
        const tokens = inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens;
        const cost = estimateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);

        totalUsd += cost;
        totalTokens += tokens;

        if (!bySession[sessionLabel]) {
          bySession[sessionLabel] = { provider: "claude", cost_usd: 0, tokens: 0 };
        }
        bySession[sessionLabel].cost_usd += cost;
        bySession[sessionLabel].tokens += tokens;

        if (!byModel[model]) {
          byModel[model] = { cost_usd: 0, tokens: 0 };
        }
        byModel[model].cost_usd += cost;
        byModel[model].tokens += tokens;
      }
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    workspace_total_usd: totalUsd,
    workspace_total_tokens: totalTokens,
    by_session: bySession,
    by_model: byModel,
  };
}

/**
 * Derive a human-readable session label from the Claude project dir name.
 * Used for coordinator subdirs where we can't use PID mapping.
 */
function deriveSessionLabel(dirName: string, prefix: string): string {
  const suffix = dirName.slice(prefix.length + 1);
  // e.g. "CoAgent-workspace-sessions-2026-03-16-18-22-coordinator-885d"
  const sessionsIdx = suffix.indexOf("sessions-");
  if (sessionsIdx !== -1) {
    return suffix.slice(sessionsIdx + "sessions-".length);
  }
  return suffix;
}
