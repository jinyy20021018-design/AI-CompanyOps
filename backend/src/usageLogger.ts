/**
 * Record costs per completed model call; idle/task-finish only refresh summaries.
 */
import fs from "node:fs";
import path from "node:path";

export type UsageEvent = {
  ts: string;
  session: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  total_tokens?: number;
  estimated_cost_usd: number;
  task_id?: string;
  note?: string;
  pricing_version?: string;
};

export type CostSummary = {
  updatedAt: string;
  workspace_total_usd: number;
  workspace_total_tokens: number;
  by_session: Record<string, { provider: string; cost_usd: number; tokens: number }>;
  by_model: Record<string, { cost_usd: number; tokens: number }>;
};

function workspacePath(folderPath: string): string {
  return path.join(folderPath, "CoAgent_workspace");
}

function sharedUsagePath(folderPath: string): string {
  return path.join(workspacePath(folderPath), "_shared", "usage.jsonl");
}

function sharedSummaryPath(folderPath: string): string {
  return path.join(workspacePath(folderPath), "_shared", "cost_summary.json");
}

function sessionUsagePath(folderPath: string, sessionName: string): string {
  return path.join(workspacePath(folderPath), "sessions", sessionName, "usage.jsonl");
}

function normalizeEvent(e: UsageEvent): UsageEvent {
  const total =
    e.total_tokens ??
    (e.input_tokens + e.output_tokens + (e.cache_read_tokens ?? 0) + (e.cache_write_tokens ?? 0));
  return { ...e, total_tokens: total };
}

function appendLine(filePath: string, line: string): void {
  fs.appendFileSync(filePath, line + "\n", "utf-8");
}

/** Append usage event to both session and shared ledgers; then refresh cost_summary. */
export function recordUsageEvent(
  folderPath: string,
  sessionName: string,
  event: UsageEvent
): void {
  const normalized = normalizeEvent(event);
  const line = JSON.stringify(normalized);

  const sessionPath = sessionUsagePath(folderPath, sessionName);
  const sharedPath = sharedUsagePath(folderPath);

  if (fs.existsSync(sessionPath)) {
    appendLine(sessionPath, line);
  }
  appendLine(sharedPath, line);

  refreshCostSummary(folderPath);
}

/** Recompute cost_summary.json from usage.jsonl. usage.jsonl = source of truth. */
export function refreshCostSummary(folderPath: string): void {
  const usagePath = sharedUsagePath(folderPath);
  const summaryPath = sharedSummaryPath(folderPath);

  const bySession: CostSummary["by_session"] = {};
  const byModel: CostSummary["by_model"] = {};
  let workspaceTotalUsd = 0;
  let workspaceTotalTokens = 0;

  if (!fs.existsSync(usagePath)) {
    const summary: CostSummary = {
      updatedAt: new Date().toISOString(),
      workspace_total_usd: 0,
      workspace_total_tokens: 0,
      by_session: {},
      by_model: {},
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
    return;
  }

  const content = fs.readFileSync(usagePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  for (const raw of lines) {
    try {
      const e: UsageEvent = JSON.parse(raw);
      const cost = e.estimated_cost_usd ?? 0;
      const tokens = e.total_tokens ?? e.input_tokens + e.output_tokens;

      workspaceTotalUsd += cost;
      workspaceTotalTokens += tokens;

      if (!bySession[e.session]) {
        bySession[e.session] = { provider: e.provider, cost_usd: 0, tokens: 0 };
      }
      bySession[e.session].cost_usd += cost;
      bySession[e.session].tokens += tokens;

      if (!byModel[e.model]) {
        byModel[e.model] = { cost_usd: 0, tokens: 0 };
      }
      byModel[e.model].cost_usd += cost;
      byModel[e.model].tokens += tokens;
    } catch {
      // skip malformed lines
    }
  }

  const summary: CostSummary = {
    updatedAt: new Date().toISOString(),
    workspace_total_usd: workspaceTotalUsd,
    workspace_total_tokens: workspaceTotalTokens,
    by_session: bySession,
    by_model: byModel,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
}

/** Read cost_summary.json if it exists. */
export function readCostSummary(folderPath: string): CostSummary | null {
  const summaryPath = sharedSummaryPath(folderPath);
  if (!fs.existsSync(summaryPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  } catch {
    return null;
  }
}

/** Ensure _shared/usage.jsonl and _shared/cost_summary.json exist. */
export function ensureUsageFiles(folderPath: string): void {
  const shared = path.join(workspacePath(folderPath), "_shared");
  fs.mkdirSync(shared, { recursive: true });

  const usagePath = sharedUsagePath(folderPath);
  if (!fs.existsSync(usagePath)) {
    fs.writeFileSync(usagePath, "", "utf-8");
  }

  const summaryPath = sharedSummaryPath(folderPath);
  if (!fs.existsSync(summaryPath)) {
    const summary: CostSummary = {
      updatedAt: new Date().toISOString(),
      workspace_total_usd: 0,
      workspace_total_tokens: 0,
      by_session: {},
      by_model: {},
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  }
}

/** Ensure session usage.jsonl exists. */
export function ensureSessionUsageFile(folderPath: string, sessionName: string): void {
  const sessionDir = path.join(workspacePath(folderPath), "sessions", sessionName);
  fs.mkdirSync(sessionDir, { recursive: true });
  const usagePath = sessionUsagePath(folderPath, sessionName);
  if (!fs.existsSync(usagePath)) {
    fs.writeFileSync(usagePath, "", "utf-8");
  }
}
