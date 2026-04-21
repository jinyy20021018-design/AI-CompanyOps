import fs from "node:fs";
import path from "node:path";
import { ensureSessionUsageFile } from "./usageLogger.js";
import type { TerminalRegistryEntry, SessionHistoryEntry } from "./protocol.js";

/** Create a session folder and return its path + short name */
export function createSessionFolder(folderPath: string, terminalId: string, sessionType: string, mode?: "quick" | "role"): { sessionDir: string; sessionName: string } {
  const now = new Date();

  // All 6 core agents get stable, permanent session names per folder
  const STABLE_SESSIONS = new Set(["coordinator", "product", "engineering", "marketing", "qa", "finance"]);
  let sessionName: string;
  if (STABLE_SESSIONS.has(sessionType)) {
    sessionName = sessionType;
  } else {
    const date = now.toISOString().slice(0, 10);
    const time = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
    const shortId = terminalId.slice(0, 4);
    sessionName = `${date}_${time}_${sessionType}_${shortId}`;
  }
  const sessionDir = path.join(folderPath, "CoAgent_workspace", "sessions", sessionName);

  fs.mkdirSync(path.join(sessionDir, "artifacts"), { recursive: true });

  ensureSessionUsageFile(folderPath, sessionName);

  // Write session.json (always overwrite — tracks current terminal instance)
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify({
    terminalId,
    type: sessionType,
    mode: mode ?? "quick",
    startedAt: now.toISOString(),
    endedAt: null,
    exitCode: null,
    folderName: sessionName,
  }, null, 2));

  // Create notes.md and inbox.jsonl only if they don't already exist (preserve across restarts)
  const notesPath = path.join(sessionDir, "notes.md");
  if (!fs.existsSync(notesPath)) fs.writeFileSync(notesPath, "");
  const inboxPath = path.join(sessionDir, "inbox.jsonl");
  if (!fs.existsSync(inboxPath)) fs.writeFileSync(inboxPath, "");

  const sharedDir = path.join(folderPath, "CoAgent_workspace", "_shared");

  if (sessionType === "coordinator") {
    // Write coordinator CLAUDE.md directly into coordinator session dir
    const coordinatorPromptSrc = path.join(sharedDir, "coordinator-prompt.md");
    if (fs.existsSync(coordinatorPromptSrc)) {
      fs.copyFileSync(coordinatorPromptSrc, path.join(sessionDir, "CLAUDE.md"));
    } else {
      fs.writeFileSync(path.join(sessionDir, "CLAUDE.md"), `# You are the CEO

You coordinate 5 department heads: Product, Engineering, Marketing, QA, Finance.
They are already running as separate agents. Do NOT spawn new workers — your departments are already active.

## CRITICAL: How to send messages
You MUST use the \`coagent send\` command to communicate. NEVER write to inbox files directly.
NEVER use python/cat/echo to write to inbox.jsonl. ONLY use this exact command format:
\`\`\`bash
coagent send --to "name:Product" --type task_assign --msg "your message here"
\`\`\`
If \`coagent\` is not found, use the full path: \`$COAGENT_SHARED_DIR/bin/coagent\`

## Your departments
- **Product** — PRD, feature definition, prioritization (Phase 1)
- **Engineering** — architecture, tech stack, dev plan (Phase 2)
- **Marketing** — GTM strategy, positioning, growth (Phase 2)
- **QA** — test strategy, risk analysis, quality (Phase 3)
- **Finance** — budget, cost modeling, ROI (Phase 3)

## Phased dispatch protocol
When you receive a request from the user, decompose it into department tasks and dispatch in phases:

### Phase 1 — Product starts first
\`\`\`bash
coagent send --to "name:Product" --type task_assign --msg "Define requirements for: [user request]. Write PRD to artifacts/prd.md."
\`\`\`
Update status board, then enter listen loop:
\`\`\`bash
while true; do coagent inbox; sleep 5; done
\`\`\`

### Phase 2 — after Product reports done
\`\`\`bash
coagent send --to "name:Engineering" --type task_assign --msg "Design architecture for: [user request]. Product PRD is at [path from Product's handoff]."
coagent send --to "name:Marketing" --type task_assign --msg "Create GTM strategy for: [user request]. Product PRD is at [path from Product's handoff]."
\`\`\`

### Phase 3 — after Engineering AND Marketing report done
\`\`\`bash
coagent send --to "name:QA" --type task_assign --msg "Create test strategy for: [user request]. Architecture is at [path from Engineering's handoff]."
coagent send --to "name:Finance" --type task_assign --msg "Budget analysis for: [user request]. Tech plan at [eng path], marketing plan at [mkt path]."
\`\`\`

## Status board
After each phase transition or department completion, update your status board:
\`\`\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/status-board.md" << 'STATUSEOF'
# Project Status Board
Task: [user's original request]

| Department   | Phase | Status      | Last Update           |
|-------------|-------|-------------|-----------------------|
| Product     | 1     | [status]    | [summary]             |
| Engineering | 2     | [status]    | [summary]             |
| Marketing   | 2     | [status]    | [summary]             |
| QA          | 3     | [status]    | [summary]             |
| Finance     | 3     | [status]    | [summary]             |
STATUSEOF
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/status-board.md" --desc "CEO Status Board"
\`\`\`

## Final synthesis
After ALL departments report done:
1. Read all department artifacts
2. Synthesize into a final report:
\`\`\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/final-report.md" << 'EOF'
# Final Report
[synthesize all department outputs into a cohesive plan]
EOF
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/final-report.md" --desc "Final synthesized report"
\`\`\`

## How to listen
After dispatching tasks or sending messages:
\`\`\`bash
while true; do coagent inbox; sleep 5; done
\`\`\`
When you receive a handoff — process it, advance to next phase if ready.
When you receive a question — answer it.
When you receive a blocker — help resolve it or reassign.

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`
`);
    }
    try {
      fs.copyFileSync(path.join(sharedDir, "coordinator-agent.md"), path.join(sessionDir, "agent.md"));
    } catch {}
  } else if (STABLE_SESSIONS.has(sessionType) && sessionType !== "coordinator") {
    // Department agent — load role-specific prompt from _shared/agents/
    const deptPromptSrc = path.join(sharedDir, "agents", `${sessionType}-prompt.md`);
    const deptClaudeMd = path.join(sessionDir, "CLAUDE.md");
    if (fs.existsSync(deptPromptSrc)) {
      fs.copyFileSync(deptPromptSrc, deptClaudeMd);
    } else {
      // Fallback if template not seeded yet
      let prompt = `# ${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)} Department Agent
You are the ${sessionType} department head.

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`

## Workflow
1. Check inbox for task assignments from CEO
2. Do the work. Save outputs to \`$COAGENT_SESSION_DIR/artifacts/\`
3. Report back: \`coagent send --to "role:coordinator" --type handoff --msg "Done: [summary]"\`
4. Enter listen loop: \`while true; do coagent inbox; sleep 5; done\`
`;
      if (sessionType === "engineering") {
        prompt += `
## App UI Preview (required)
After writing your architecture document, also create a self-contained HTML mockup of the app's main screen:
\`\`\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/app-preview.html" << 'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>App Preview</title>
<style>
  /* Write realistic app UI styles inline here */
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; }
</style>
</head>
<body>
  <!-- Write the app's main screen UI here, showing key features -->
</body>
</html>
HTMLEOF
coagent artifact --type preview --path "$COAGENT_SESSION_DIR/artifacts/app-preview.html" --desc "App UI Preview"
\`\`\`
Make the mockup realistic — use the actual app name and feature set from the PRD. Style it properly with inline CSS. Show at least the main dashboard or home screen.
`;
      }
      fs.writeFileSync(deptClaudeMd, prompt);
    }
  } else {
    // Ephemeral worker CLAUDE.md stub
    const workerClaudeMd = path.join(sessionDir, "CLAUDE.md");
    if (!fs.existsSync(workerClaudeMd)) {
      fs.writeFileSync(workerClaudeMd, `# Worker Agent
You are a worker terminal in a multi-agent workspace.

## On startup
1. \`coagent inbox\` — check for assigned tasks
2. \`coagent context\` — project goals

## Workflow
1. Check inbox for your task assignment
2. Do the work. Save all outputs to \`$COAGENT_SESSION_DIR/artifacts/\`.
3. When done, report back to coordinator:
   \`\`\`bash
   coagent send --to "role:coordinator" --type status_update --msg "Done: [summary] — artifacts at $COAGENT_SESSION_DIR/artifacts/"
   \`\`\`
4. Then enter the **wait loop** — keep checking inbox every 30 seconds:
   \`\`\`bash
   while true; do sleep 30 && coagent inbox; done
   \`\`\`
5. When coordinator sends a \`task_assign\` message → apply the revision and report back again.
6. When coordinator sends "approved" or "closed" → exit the loop and stop.

## Saving artifacts
\`\`\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/report.md" << 'EOF'
# Report
...content...
EOF
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/report.md" --desc "Brief description"
\`\`\`

## Rules
- Never stop until coordinator says "approved" or "closed"
- All outputs go to \`$COAGENT_SESSION_DIR/artifacts/\`
- Always report back after completing or revising
`);
    }
  }

  return { sessionDir, sessionName };
}

/** Update state.json to add/remove active session */
export function updateActiveSession(folderPath: string, sessionName: string, action: "add" | "remove"): void {
  const stateFile = path.join(folderPath, "CoAgent_workspace", "_shared", "state.json");
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    if (action === "add") {
      if (!state.activeSessions.includes(sessionName)) {
        state.activeSessions.push(sessionName);
      }
    } else {
      state.activeSessions = state.activeSessions.filter((s: string) => s !== sessionName);
    }
    state.updatedAt = new Date().toISOString();
    state.updatedBy = sessionName;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch {}
}

/** Finalize session on exit (Stop hook) */
export function finalizeSession(sessionDir: string, exitCode: number): void {
  // Update session.json
  const sessionFile = path.join(sessionDir, "session.json");
  try {
    const meta = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    meta.endedAt = new Date().toISOString();
    meta.exitCode = exitCode;
    fs.writeFileSync(sessionFile, JSON.stringify(meta, null, 2));
  } catch {}

  // Stop hook: append session-end timestamp to notes.md/memory.md
  const endTimestamp = `\n---\nSession ended: ${new Date().toISOString()} (exit code: ${exitCode})\n`;
  const memoryMdPath = path.join(sessionDir, "memory.md");
  const notesMdPath = path.join(sessionDir, "notes.md");
  try {
    if (fs.existsSync(memoryMdPath)) {
      fs.appendFileSync(memoryMdPath, endTimestamp);
    }
    fs.appendFileSync(notesMdPath, endTimestamp);
  } catch {}

  // PreCompact hook: backup memory files
  const backupsDir = path.join(sessionDir, "backups");
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    if (fs.existsSync(notesMdPath)) {
      fs.copyFileSync(notesMdPath, path.join(backupsDir, `notes_${ts}.md`));
    }
    if (fs.existsSync(memoryMdPath)) {
      fs.copyFileSync(memoryMdPath, path.join(backupsDir, `memory_${ts}.md`));
    }
  } catch {}

  // Write summary.json
  const summaryFile = path.join(sessionDir, "summary.json");
  try {
    const meta = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    fs.writeFileSync(summaryFile, JSON.stringify({
      session: meta.folderName,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      exitCode: meta.exitCode,
      keyFindings: [],
      filesCreated: [],
      filesModified: [],
      tasksCompleted: [],
      handoffNotes: "",
    }, null, 2));
  } catch {}
}

/** Scan session folders and return history entries */
export function scanSessionHistory(folderPath: string, runningTerminals: TerminalRegistryEntry[]): SessionHistoryEntry[] {
  const sessionsDir = path.join(folderPath, "CoAgent_workspace", "sessions");
  try {
    const dirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const runningMap = new Map<string, string>();
    for (const t of runningTerminals) {
      runningMap.set(t.sessionName, t.terminalId);
    }

    const entries: SessionHistoryEntry[] = [];
    for (const dirName of dirs) {
      const sessionJsonPath = path.join(sessionsDir, dirName, "session.json");
      try {
        const meta = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
        const isRunning = runningMap.has(dirName);
        entries.push({
          sessionName: dirName,
          sessionType: meta.type ?? "shell",
          startedAt: meta.startedAt ?? "",
          endedAt: meta.endedAt ?? null,
          exitCode: meta.exitCode ?? null,
          isRunning,
          terminalId: isRunning ? runningMap.get(dirName) : undefined,
          mode: meta.mode,
          tag: meta.tag,
        });
      } catch {
        // Skip invalid sessions
      }
    }

    // Sort newest first
    entries.sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
    return entries;
  } catch {
    return [];
  }
}

/** Write recent session context to CLAUDE.md instead of injecting into PTY */
export function writeSessionContext(sessionDir: string): void {
  const memoryPath = path.join(sessionDir, "memory.md");
  const notesPath = path.join(sessionDir, "notes.md");
  const claudeMdPath = path.join(sessionDir, "CLAUDE.md");

  const contextFile = fs.existsSync(memoryPath) ? memoryPath : notesPath;
  try {
    const content = fs.readFileSync(contextFile, "utf-8").trim();
    if (!content) return;

    const lines = content.split("\n");
    const last15 = lines.slice(-15).join("\n");

    const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, "utf-8") : "";
    // Don't duplicate — only add if not already present
    if (existing.includes("## Recent Context")) return;

    fs.writeFileSync(claudeMdPath, existing + `\n\n## Recent Context\n\n${last15}\n`);
  } catch {}
}
