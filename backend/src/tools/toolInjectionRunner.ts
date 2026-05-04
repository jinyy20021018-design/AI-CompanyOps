import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toolRegistry, type ToolName } from "./toolRegistry.js";
import type { InjectedToolResult, ToolCall, ToolTarget } from "./toolTypes.js";
import { writeAgentEvent, writeSourceLedger, writeJsonl } from "./sourceLedger.js";
import { buildMarketEvidence, buildCompetitorMatrix } from "../agents/market/MarketAgent.js";
import { renderMarketingGtmMarkdown } from "../agents/marketing/MarketingPlanBuilder.js";
import { buildFinanceModelFromToolResults, renderAssumptionsYaml, renderFinanceMarkdown } from "../agents/finance/FinanceModelBuilder.js";

export type ToolInjectionInput = {
  folderPath: string;
  target: ToolTarget;
  projectContext?: string;
  taskText: string;
  availableArtifacts?: Record<string, string>;
  sessionDir?: string;
};

const running = new Set<string>();

function workspaceDir(folderPath: string): string {
  return path.join(folderPath, "CoAgent_workspace");
}

function sharedDir(folderPath: string): string {
  return path.join(workspaceDir(folderPath), "_shared");
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<InjectedToolResult>): Promise<InjectedToolResult[]> {
  const results: InjectedToolResult[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractUrls(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s"'<>)]{4,}/gi) ?? []).map((url) => url.replace(/[.,;]+$/, "")))].slice(0, 5);
}

function extractCiks(text: string): string[] {
  return [...new Set(text.match(/\bCIK[:\s-]*([0-9]{6,10})\b/gi)?.map((m) => m.replace(/\D/g, "")) ?? [])].slice(0, 3);
}

function extractSymbols(text: string): string[] {
  return [...new Set(text.match(/\$[A-Z]{1,5}\b/g)?.map((m) => m.slice(1)) ?? [])].slice(0, 4);
}

function buildToolCalls(target: ToolTarget, taskText: string, projectContext?: string): ToolCall[] {
  const text = `${taskText}\n${projectContext ?? ""}`;
  if (target === "market") {
    return [
      { toolName: "web_search", input: { query: `${taskText.slice(0, 180)} market competitors pricing benchmark`, maxResults: 5 } },
      { toolName: "competitor_page_fetch", input: { urls: extractUrls(text), extract: "pricing" } },
      { toolName: "world_bank_indicator", input: { country: "US", indicators: ["NY.GDP.MKTP.CD", "SP.POP.TOTL", "IT.NET.USER.ZS"] } },
    ];
  }
  return [
    { toolName: "exchange_rate", input: { base: "USD", symbols: ["EUR", "CNY", "SGD", "GBP"] } },
    { toolName: "fred_series", input: { seriesIds: ["FEDFUNDS", "CPIAUCSL", "DGS10"] } },
    { toolName: "world_bank_indicator", input: { country: "US", indicators: ["NY.GDP.MKTP.CD", "SP.POP.TOTL"] } },
    { toolName: "sec_edgar_company_facts", input: { ciks: extractCiks(text) } },
    { toolName: "alpha_vantage", input: { symbols: extractSymbols(text) } },
  ];
}

function disabledTools(): Set<string> {
  return new Set((process.env.COAGENT_DISABLED_TOOLS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean));
}

function skippedResult(toolName: string, provider: string, reason: string): InjectedToolResult {
  return {
    tool: toolName,
    status: "skipped",
    provider,
    retrievedAt: new Date().toISOString(),
    reason,
    sources: [],
  };
}

function writeScratchpadStatus(folderPath: string, target: ToolTarget, results: InjectedToolResult[], sessionDir?: string): void {
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed" || r.status === "timeout").length;
  writeJsonl(path.join(sharedDir(folderPath), "scratchpad.jsonl"), {
    ts: new Date().toISOString(),
    from: "system",
    to: target === "market" ? "name:Marketing" : "name:Finance",
    tag: "tool_injection",
    msg: `Tool injection completed for ${target}: ${ok} fulfilled, ${skipped} skipped, ${failed} failed/timeout. External data is optional; continue if incomplete.`,
    id: crypto.randomUUID(),
    msgType: "status_update",
    status: "sent",
  });
  if (target === "market") {
    const evidencePath = "$COAGENT_SHARED_DIR/artifacts/market/market-evidence.json";
    writeJsonl(path.join(sharedDir(folderPath), "scratchpad.jsonl"), {
      ts: new Date().toISOString(),
      from: "system",
      to: "name:Marketing",
      tag: "market_evidence",
      msg: `Market evidence ready at ${evidencePath}. Use fulfilled evidence if available; treat skipped/failed/timeout tools as data gaps.`,
      id: crypto.randomUUID(),
      msgType: "handoff",
      status: "sent",
      artifactPath: evidencePath,
    });
    writeJsonl(path.join(sharedDir(folderPath), "scratchpad.jsonl"), {
      ts: new Date().toISOString(),
      from: "system",
      to: "name:Finance",
      tag: "market_evidence",
      msg: `Market evidence ready at ${evidencePath}. Finance should read this when its formal task_assign arrives; do not treat this notice as a finance task.`,
      id: crypto.randomUUID(),
      msgType: "status_update",
      status: "sent",
      artifactPath: evidencePath,
    });
  }
  if ((process.env.COAGENT_DOMAIN_AGENTS ?? "legacy") === "native" && sessionDir) {
    const artifactName = target === "market" ? "gtm.md" : "financial-model.md";
    const artifactPath = path.join(sessionDir, "artifacts", artifactName);
    if (fs.existsSync(artifactPath)) {
      writeJsonl(path.join(sharedDir(folderPath), "scratchpad.jsonl"), {
        ts: new Date().toISOString(),
        from: target === "market" ? "marketing" : "finance",
        to: "role:coordinator",
        tag: target === "market" ? "marketing_native" : "finance_native",
        msg: target === "market"
          ? `Done: native GTM at ${artifactPath}`
          : `Done: native financial model at ${artifactPath}`,
        id: crypto.randomUUID(),
        msgType: "handoff",
        status: "sent",
        artifactPath,
      });
      if (target === "market") {
        writeJsonl(path.join(sharedDir(folderPath), "scratchpad.jsonl"), {
          ts: new Date().toISOString(),
          from: "marketing",
          to: "name:Finance",
          tag: "marketing_native",
          msg: `Native GTM and budget assumptions ready: ${artifactPath}`,
          id: crypto.randomUUID(),
          msgType: "handoff",
          status: "sent",
          artifactPath,
        });
      }
    }
  }
}

function registerSharedArtifact(folderPath: string, target: ToolTarget, filePath: string, description: string): void {
  writeJsonl(path.join(sharedDir(folderPath), "artifacts.jsonl"), {
    ts: new Date().toISOString(),
    session: `system-${target}`,
    type: "data",
    path: filePath,
    sharedPath: filePath,
    sourcePath: filePath,
    description,
  });
}

function registerSessionArtifact(folderPath: string, target: ToolTarget, sessionDir: string, filePath: string, description: string): void {
  writeJsonl(path.join(sharedDir(folderPath), "artifacts.jsonl"), {
    ts: new Date().toISOString(),
    session: path.basename(sessionDir) || `system-${target}`,
    type: "data",
    path: filePath,
    sharedPath: filePath,
    sourcePath: filePath,
    description,
  });
}

function writeSessionArtifacts(folderPath: string, target: ToolTarget, results: InjectedToolResult[], contextText: string, sessionDir?: string): void {
  if (!sessionDir) return;
  const artifactsDir = path.join(sessionDir, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  if (target === "market") {
    const evidence = buildMarketEvidence(results);
    const competitorMatrix = buildCompetitorMatrix(results);
    const evidencePath = path.join(artifactsDir, "market-evidence.json");
    const matrixPath = path.join(artifactsDir, "competitor-matrix.json");
    const researchPath = path.join(artifactsDir, "market-research.md");
    writeJson(evidencePath, evidence);
    writeJson(matrixPath, competitorMatrix);
    fs.writeFileSync(researchPath, [
      "# Market Research",
      "",
      "Supplemental market intelligence generated by concurrent tool injection.",
      "",
      `Fulfilled tools: ${results.filter((r) => r.status === "fulfilled").map((r) => r.tool).join(", ") || "none"}`,
      "",
      "This file is not a replacement for gtm.md.",
    ].join("\n"));
    registerSessionArtifact(folderPath, target, sessionDir, evidencePath, "Market evidence");
    registerSessionArtifact(folderPath, target, sessionDir, matrixPath, "Competitor matrix");
    registerSessionArtifact(folderPath, target, sessionDir, researchPath, "Market research summary");
    if ((process.env.COAGENT_DOMAIN_AGENTS ?? "legacy") === "native") {
      const gtmPath = path.join(artifactsDir, "gtm.md");
      fs.writeFileSync(gtmPath, renderMarketingGtmMarkdown({
        taskText: contextText.split("\n")[0] ?? "",
        contextText,
        evidence,
        competitorMatrix,
        results,
      }));
      registerSessionArtifact(folderPath, target, sessionDir, gtmPath, "Native go-to-market strategy");
    }
    return;
  }

  const model = buildFinanceModelFromToolResults(results, contextText);
  const modelPath = path.join(artifactsDir, "financial-model.json");
  const assumptionsPath = path.join(artifactsDir, "assumptions.yaml");
  const sensitivityPath = path.join(artifactsDir, "sensitivity-analysis.json");
  writeJson(modelPath, model);
  fs.writeFileSync(assumptionsPath, renderAssumptionsYaml(model));
  writeJson(sensitivityPath, model.sensitivityAnalysis);
  registerSessionArtifact(folderPath, target, sessionDir, modelPath, "Structured financial model");
  registerSessionArtifact(folderPath, target, sessionDir, assumptionsPath, "Financial assumptions");
  registerSessionArtifact(folderPath, target, sessionDir, sensitivityPath, "Sensitivity analysis");

  if ((process.env.COAGENT_DOMAIN_AGENTS ?? "legacy") === "native") {
    const markdownPath = path.join(artifactsDir, "financial-model.md");
    fs.writeFileSync(markdownPath, renderFinanceMarkdown(model));
    registerSessionArtifact(folderPath, target, sessionDir, markdownPath, "Native financial model narrative");
  }
}

function writeTargetArtifacts(folderPath: string, target: ToolTarget, results: InjectedToolResult[], contextText: string, sessionDir?: string): void {
  const base = path.join(sharedDir(folderPath), "artifacts", target);
  const toolResultsPath = path.join(base, "tool-injection-results.json");
  writeJson(toolResultsPath, {
    target,
    generatedAt: new Date().toISOString(),
    results,
  });
  registerSharedArtifact(folderPath, target, toolResultsPath, `${target} tool injection results`);
  if (target === "market") {
    const evidencePath = path.join(base, "market-evidence.json");
    const matrixPath = path.join(base, "competitor-matrix.json");
    const researchPath = path.join(base, "market-research.md");
    writeJson(evidencePath, buildMarketEvidence(results));
    writeJson(matrixPath, buildCompetitorMatrix(results));
    fs.writeFileSync(researchPath, [
      "# Market Research",
      "",
      "Generated from concurrent tool injection. Missing or failed tools are data gaps, not blockers.",
      "",
      `Fulfilled tools: ${results.filter((r) => r.status === "fulfilled").map((r) => r.tool).join(", ") || "none"}`,
    ].join("\n"));
    registerSharedArtifact(folderPath, target, evidencePath, "Market evidence");
    registerSharedArtifact(folderPath, target, matrixPath, "Competitor matrix");
    registerSharedArtifact(folderPath, target, researchPath, "Market research summary");
  } else {
    const financePath = path.join(base, "external-finance-data.json");
    writeJson(financePath, {
      generatedAt: new Date().toISOString(),
      results,
      modelSeed: buildFinanceModelFromToolResults(results, contextText),
    });
    registerSharedArtifact(folderPath, target, financePath, "External finance data");
  }
  writeSessionArtifacts(folderPath, target, results, contextText, sessionDir);
}

export async function runToolInjection(input: ToolInjectionInput): Promise<InjectedToolResult[]> {
  const mode = process.env.COAGENT_DOMAIN_AGENTS ?? "legacy";
  const enabled = process.env.COAGENT_TOOL_INJECTION_ENABLED ?? "1";
  if (enabled === "0") {
    console.log("[tool-injection] skipped: disabled", "target=", input.target, "mode=", mode);
    return [];
  }
  if (mode === "legacy") {
    console.log("[tool-injection] skipped: legacy mode", "target=", input.target);
    return [];
  }

  const key = `${input.folderPath}:${input.target}:${input.taskText.slice(0, 160)}`;
  if (running.has(key)) {
    console.log("[tool-injection] skipped: duplicate in-flight", "target=", input.target);
    return [];
  }
  running.add(key);

  const wdir = workspaceDir(input.folderPath);
  const requestId = crypto.randomUUID();
  const calls = buildToolCalls(input.target, input.taskText, input.projectContext);
  const disabled = disabledTools();
  const concurrency = readPositiveIntEnv("COAGENT_TOOL_INJECTION_CONCURRENCY", 8);
  const timeoutOverride = process.env.COAGENT_TOOL_TIMEOUT_MS ? readPositiveIntEnv("COAGENT_TOOL_TIMEOUT_MS", 12000) : null;
  console.log(
    "[tool-injection] started",
    "target=", input.target,
    "requestId=", requestId,
    "mode=", mode,
    "concurrency=", concurrency,
    "tools=", calls.map((c) => c.toolName).join(","),
  );
  writeAgentEvent(wdir, { type: "tool_injection.started", target: input.target, requestId, calls: calls.map((c) => c.toolName) });

  try {
    const results = await runWithConcurrency(calls, concurrency, async (call): Promise<InjectedToolResult> => {
      const tool = toolRegistry[call.toolName as ToolName];
      if (!tool) {
        console.warn("[tool-injection] skipped unknown tool", "target=", input.target, "tool=", call.toolName, "requestId=", requestId);
        return skippedResult(call.toolName, "unknown", "disabled");
      }
      if (disabled.has(call.toolName)) {
        console.log("[tool-injection] skipped disabled tool", "target=", input.target, "tool=", tool.name, "provider=", tool.provider, "requestId=", requestId);
        return skippedResult(tool.name, tool.provider, "disabled");
      }
      const availability = tool.availability();
      if (!availability.available) {
        console.log("[tool-injection] skipped unavailable tool", "target=", input.target, "tool=", tool.name, "provider=", tool.provider, "reason=", availability.reason, "requestId=", requestId);
        return skippedResult(tool.name, tool.provider, availability.reason);
      }
      const timeoutMs = timeoutOverride ?? tool.defaultTimeoutMs;
      try {
        return await withTimeout(tool.execute(call.input, {
          folderPath: input.folderPath,
          workspaceDir: wdir,
          agentName: input.target,
          requestId,
        }), timeoutMs, () => ({
          tool: tool.name,
          status: "timeout",
          provider: tool.provider,
          retrievedAt: new Date().toISOString(),
          reason: `timeout_after_${timeoutMs}ms`,
          sources: [],
        }));
      } catch (err) {
        return {
          tool: tool.name,
          status: "failed",
          provider: tool.provider,
          retrievedAt: new Date().toISOString(),
          reason: err instanceof Error ? err.message : String(err),
          sources: [],
        };
      }
    });

    for (const result of results) {
      writeSourceLedger(wdir, { type: "tool_result", target: input.target, requestId, result });
    }
    writeTargetArtifacts(input.folderPath, input.target, results, `${input.taskText}\n${input.projectContext ?? ""}`, input.sessionDir);
    writeAgentEvent(wdir, { type: "tool_injection.completed", target: input.target, requestId, results });
    writeScratchpadStatus(input.folderPath, input.target, results, input.sessionDir);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const timeout = results.filter((r) => r.status === "timeout").length;
    console.log(
      "[tool-injection] completed",
      "target=", input.target,
      "requestId=", requestId,
      "fulfilled=", fulfilled,
      "skipped=", skipped,
      "failed=", failed,
      "timeout=", timeout,
      "artifacts=written",
    );
    return results;
  } finally {
    running.delete(key);
  }
}
