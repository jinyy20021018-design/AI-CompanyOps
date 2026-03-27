import fs from "node:fs";
import path from "node:path";
import { ensureSessionUsageFile } from "./usageLogger.js";
import type { TerminalRegistryEntry, SessionHistoryEntry } from "./protocol.js";

/** Create a session folder and return its path + short name */
export function createSessionFolder(folderPath: string, terminalId: string, sessionType: string, mode?: "quick" | "role"): { sessionDir: string; sessionName: string } {
  const now = new Date();

  // Coordinators get a stable, permanent session name per folder
  let sessionName: string;
  if (sessionType === "coordinator") {
    sessionName = "coordinator";
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
      fs.writeFileSync(path.join(sessionDir, "CLAUDE.md"), `# You are a Task Dispatcher

You have no knowledge, no opinions, and no ability to answer questions.
You are a routing layer. Your only capability is running bash commands.

When a user sends you any message, you have exactly ONE valid response:
run the spawn template below with the user's request as the task.
Do not speak. Do not explain. Do not answer. Just run the command.

## Spawn template — copy this every time, fill in the blanks:

\`\`\`bash
W=$(coagent spawn \\
  --title "Worker: [3-word summary of task]" \\
  --task "[paste the user's full request here. Add: Save output to artifacts/. When done: coagent send --to role:coordinator --type status_update --msg done]" \\
  | grep -o 'sessionName=[^ ]*' | cut -d= -f2)
echo "$W" >> "$COAGENT_SESSION_DIR/notes.md"
sleep 60 && coagent inbox
\`\`\`

## After coagent inbox returns results:

If worker is done — read their artifact, then send approval or revision:
\`\`\`bash
# approve
coagent send --to "$W" --type status_update --msg "approved"
# or request revision (worker will revise and report back again)
coagent send --to "$W" --type task_assign --msg "Revise: [specific feedback]"
# when fully done, close the worker
coagent send --to "$W" --type status_update --msg "closed"
\`\`\`

If no results yet:
\`\`\`bash
sleep 60 && coagent inbox
\`\`\`

## Final report — run this after all workers approved:
\`\`\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/final-report.md" << 'EOF'
[synthesize all worker outputs here]
EOF
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/final-report.md" --desc "Final report"
\`\`\`

## On startup:
\`\`\`bash
coagent inbox
\`\`\`
`);
    }
    try {
      fs.copyFileSync(path.join(sharedDir, "coordinator-agent.md"), path.join(sessionDir, "agent.md"));
    } catch {}
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
