import fs from "node:fs";
import path from "node:path";

export function writeJsonl(filePath: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

export function writeSourceLedger(workspaceDir: string, entry: unknown): void {
  writeJsonl(path.join(workspaceDir, "_shared", "source-ledger.jsonl"), {
    ...(typeof entry === "object" && entry !== null ? entry : { entry }),
    loggedAt: new Date().toISOString(),
  });
}

export function writeAgentEvent(workspaceDir: string, entry: unknown): void {
  writeJsonl(path.join(workspaceDir, "_shared", "agent-events.jsonl"), {
    ...(typeof entry === "object" && entry !== null ? entry : { entry }),
    loggedAt: new Date().toISOString(),
  });
}
