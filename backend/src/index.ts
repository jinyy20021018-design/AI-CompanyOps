import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { FolderRegistry } from "./folderRegistry.js";
import { PtyManager } from "./ptyManager.js";
import {
  ensureUsageFiles,
  ensureSessionUsageFile,
  recordUsageEvent,
  readCostSummary,
  refreshCostSummary,
  type UsageEvent,
} from "./usageLogger.js";
import type { ClientMessage, ServerMessage, DirEntry } from "./protocol.js";
import { ScratchpadWatcher, type ScratchpadMessage } from "./scratchpadWatcher.js";

const PORT = 3001;
const registry = new FolderRegistry();
const ptyManager = new PtyManager();
const scratchpadWatcher = new ScratchpadWatcher();

// Track which sharedDirs are being watched and how many terminals reference them
const watchedDirCounts = new Map<string, number>();

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/usage") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { sessionDir, event } = JSON.parse(body) as { sessionDir: string; event: UsageEvent };
        if (!sessionDir || !event) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "sessionDir and event required" }));
          return;
        }
        const sessionName = path.basename(sessionDir);
        const workspace = path.dirname(path.dirname(sessionDir));
        const folderPath = path.dirname(workspace);
        recordUsageEvent(folderPath, sessionName, event);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Invalid JSON" }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, sock, head) => {
  if (req.url === "/" || req.url?.startsWith("/?")) {
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit("connection", ws, req));
  } else {
    sock.destroy();
  }
});

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Ensure CoAgent_workspace and _shared/ structure exist */
function ensureWorkspace(folderPath: string): void {
  const workspace = path.join(folderPath, "CoAgent_workspace");
  const shared = path.join(workspace, "_shared");
  const sessions = path.join(workspace, "sessions");

  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(sessions, { recursive: true });

  // Seed _shared/ files if they don't exist
  const contextFile = path.join(shared, "context.md");
  if (!fs.existsSync(contextFile)) {
    fs.writeFileSync(contextFile, "# Project Context\n\nDescribe project goals, environment, and key paths here.\n");
  }

  const stateFile = path.join(shared, "state.json");
  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify({
      updatedAt: new Date().toISOString(),
      updatedBy: "system",
      activeSessions: [],
      currentGoal: "",
      blockers: [],
      recentDecisions: [],
      keyFiles: [],
    }, null, 2));
  }

  // Usage tracking (usage.jsonl = source of truth, cost_summary = snapshot)
  ensureUsageFiles(folderPath);

  // Create empty JSONL files if missing
  for (const name of ["tasks.jsonl", "artifacts.jsonl", "scratchpad.jsonl", "decisions.jsonl", "memory.jsonl"]) {
    const filePath = path.join(shared, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "");
    }
  }

  // Seed AGENT_POLICY.md
  const policyFile = path.join(shared, "AGENT_POLICY.md");
  if (!fs.existsSync(policyFile)) {
    fs.writeFileSync(policyFile, `# CoAgent Workspace

Multi-agent workspace. Multiple terminals may be active.

## On startup
1. Read \`_shared/state.json\` — current workspace state
2. Read \`_shared/context.md\` — project goals
3. Read \`_shared/tasks.jsonl\` — check what others are doing
4. Check \`$COAGENT_SESSION_DIR/inbox.jsonl\` — read any messages sent to you

## Core rules
- Do not directly edit \`state.json\` — emit events, backend updates state
- Write raw output to logs, coordination to shared events, conclusions to summaries
- Claim tasks before starting work
- Register artifacts so others can find them
- Keep shared writes structured (JSONL append-only)

## Your identity
- Session dir: $COAGENT_SESSION_DIR
- Session name: $COAGENT_SESSION_NAME
- Shared dir: $COAGENT_SHARED_DIR

## Inbox
Your inbox is at \`$COAGENT_SESSION_DIR/inbox.jsonl\`. Messages from other agents are automatically delivered here.
Check it periodically and at startup. Each line is a JSON object with: ts, from, to, tag, msg, ref.

## Learning about other agents' work
- Read \`_shared/scratchpad.jsonl\` to see the full message history across all agents
- Read other sessions' \`notes.md\` or \`summary.json\` in \`sessions/\` to understand prior work
- Check \`_shared/tasks.jsonl\` for task ownership and status

## Action skills (read when needed)
Skills are in \`_shared/skills/\`. Read the relevant one before performing that action:
- \`start-task.md\` — claiming and starting a task
- \`send-message.md\` — messaging another agent
- \`check-inbox.md\` — reading and processing your inbox
- \`register-artifact.md\` — registering a reusable output
- \`write-decision.md\` — logging a project decision
- \`write-memory.md\` — writing durable conclusions
- \`end-session.md\` — summarizing and handing off

## Cost tracking
Any LLM-backed action must emit a structured usage event with provider, model, token counts, and estimated cost.
Do not rely on raw terminal output for cost accounting. state.json and output.jsonl are NOT the source of truth for usage.
`);
  }

  // Seed skills/
  const skillsDir = path.join(shared, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const skills: Record<string, string> = {
    "start-task.md": `# Start Task
1. Read \`tasks.jsonl\` to check no one else owns this task
2. Append: {"id":"t{n}","ts":"...","title":"...","status":"in_progress","owner":"$COAGENT_SESSION_NAME"}
3. When done: append status update with result
4. If blocked: append with status "blocked" and reason
`,
    "send-message.md": `# Send Message
Append to \`scratchpad.jsonl\`:
{"ts":"...","from":"$COAGENT_SESSION_NAME","to":"*","tag":"finding|status|request|handoff","msg":"...","ref":null}
- to: "*" for broadcast, or specific session name
- tags: finding (discovery), status (update), request (need help), handoff (passing work)
- Messages are auto-delivered to the recipient's \`inbox.jsonl\` by the backend
`,
    "check-inbox.md": `# Check Inbox
1. Read \`$COAGENT_SESSION_DIR/inbox.jsonl\`
2. Each line is a JSON message: {"ts":"...","from":"...","to":"...","tag":"...","msg":"...","ref":null}
3. Process messages — respond to requests, acknowledge findings, act on handoffs
4. To reply, use the send-message skill with the sender's session name as "to"
`,
    "register-artifact.md": `# Register Artifact
1. Save file in your \`artifacts/\` folder
2. Append to \`_shared/artifacts.jsonl\`:
{"ts":"...","session":"$COAGENT_SESSION_NAME","type":"code|report|config","path":"sessions/.../artifacts/filename","description":"..."}
`,
    "write-decision.md": `# Write Decision
Append to \`decisions.jsonl\` only when a rule, default, or tradeoff is resolved:
{"id":"d{n}","ts":"...","session":"$COAGENT_SESSION_NAME","decision":"...","rationale":"..."}
Do not log casual observations here.
`,
    "write-memory.md": `# Write Memory
Append to \`memory.jsonl\` only for durable conclusions, patterns, learnings:
{"ts":"...","session":"$COAGENT_SESSION_NAME","type":"learning|pattern|constraint","content":"..."}
Not for raw data or temporary notes. Ask: "Would a new agent need this fact next week?"
`,
    "record-usage.md": `# Record Usage
After each completed LLM/API call, POST to http://localhost:3001/usage:
{"sessionDir":"$COAGENT_SESSION_DIR","event":{"ts":"...","session":"$COAGENT_SESSION_NAME","provider":"anthropic|openai|...","model":"...","input_tokens":N,"output_tokens":N,"estimated_cost_usd":0.01,"pricing_version":"..."}}
`,
    "end-session.md": `# End Session
Before exiting or handing off:
1. Write \`summary.json\` in your session folder with: key findings, files touched, tasks completed, handoff notes
2. Append any durable learnings to \`_shared/memory.jsonl\`
3. If handing off: send message via \`scratchpad.jsonl\` with tag "handoff"
`,
  };

  for (const [filename, content] of Object.entries(skills)) {
    const skillPath = path.join(skillsDir, filename);
    if (!fs.existsSync(skillPath)) {
      fs.writeFileSync(skillPath, content);
    }
  }

  // Seed _shared/coordinator-agent.md (identity + behavioral config for the coordinator)
  const coordinatorAgentFile = path.join(shared, "coordinator-agent.md");
  if (!fs.existsSync(coordinatorAgentFile)) {
    fs.writeFileSync(coordinatorAgentFile, `# Coordinator Agent

## Identity
- **Role**: Workspace Coordinator
- **Mode**: Observer-first — only act when explicitly asked
- **Session type**: coordinator

## Personality
- Concise, structured, no fluff
- Use bullet points and tables
- Reference session names and task IDs directly
- Proactively surface blockers and stalled work

## Status report format
When asked "what's happening?" or on startup, produce:

### Active Sessions
| Session | Type | Status | Current Work |
|---------|------|--------|-------------|
| ... | ... | ... | ... |

### Tasks
- [in_progress] task title — owner
- [blocked] task title — owner — reason

### Recent Messages
- from → to: summary

### Blockers
- description (session affected)

### Recommendations
- Next steps or suggested actions

## Boundaries
- Never modify \`_shared/state.json\`, \`tasks.jsonl\`, or \`scratchpad.jsonl\` directly
- Never claim or work on tasks — delegate to worker terminals
- Never write code or create files outside your session directory
- If asked to do worker-level tasks, suggest spawning a new Claude or Codex terminal instead
`);
  }

  // Seed _shared/coordinator-prompt.md
  const coordinatorPromptFile = path.join(shared, "coordinator-prompt.md");
  if (!fs.existsSync(coordinatorPromptFile)) {
    fs.writeFileSync(coordinatorPromptFile, `# Coordinator
You are the workspace coordinator. Observe, summarize, advise.

## On startup
1. Read \`_shared/state.json\` — active sessions, blockers, current goal
2. Read \`_shared/tasks.jsonl\` — task ownership and status
3. Read \`_shared/scratchpad.jsonl\` — recent inter-agent messages
4. Read \`_shared/artifacts.jsonl\` — registered outputs
5. Read \`_shared/context.md\` — project goals

## Default mode: OBSERVE
- Summarize what each active session is doing
- Report blockers and stalled tasks
- Highlight recent decisions and artifacts
- Answer: "What's happening?", "What's blocked?", "What did terminal X change?"

## When asked to ACT
- Recommend task priorities
- Suggest spawning new terminals for specific work
- Draft task descriptions for other agents
- Only dispatch/create tasks when user explicitly asks

## Rules
- Do NOT modify shared state files directly
- Do NOT work on tasks yourself — you are the observer, not a worker
- Keep answers concise — bullet points preferred
- Reference specific session names and task IDs
`);
  }

  // Seed CoAgent_workspace/CLAUDE.md (Claude CLI auto-reads this)
  const claudeMdFile = path.join(workspace, "CLAUDE.md");
  if (!fs.existsSync(claudeMdFile)) {
    fs.writeFileSync(claudeMdFile, `# CoAgent Workspace

Multi-agent workspace. Multiple terminals may be active.

## On startup
1. Read \`_shared/state.json\` — current workspace state
2. Read \`_shared/context.md\` — project goals
3. Read \`_shared/tasks.jsonl\` — check what others are doing
4. Check \`$COAGENT_SESSION_DIR/inbox.jsonl\` — read any messages sent to you

## Core rules
- Do not directly edit \`state.json\` — emit events, backend updates state
- Write raw output to logs, coordination to shared events, conclusions to summaries
- Claim tasks before starting work
- Register artifacts so others can find them
- Keep shared writes structured (JSONL append-only)

## Your identity
- Session dir: $COAGENT_SESSION_DIR
- Session name: $COAGENT_SESSION_NAME
- Shared dir: $COAGENT_SHARED_DIR

## Inbox
Your inbox is at \`$COAGENT_SESSION_DIR/inbox.jsonl\`. Messages from other agents are automatically delivered here.
Check it periodically and at startup. Each line is a JSON message with: ts, from, to, tag, msg, ref.

## Learning about other agents' work
- Read \`_shared/scratchpad.jsonl\` to see the full message history across all agents
- Read other sessions' \`notes.md\` or \`summary.json\` in \`sessions/\` to understand prior work
- Check \`_shared/tasks.jsonl\` for task ownership and status

## Action skills (read when needed)
Skills are in \`_shared/skills/\`. Read the relevant one before performing that action:
- \`start-task.md\` — claiming and starting a task
- \`send-message.md\` — messaging another agent
- \`check-inbox.md\` — reading and processing your inbox
- \`register-artifact.md\` — registering a reusable output
- \`write-decision.md\` — logging a project decision
- \`write-memory.md\` — writing durable conclusions
- \`end-session.md\` — summarizing and handing off

## Cost tracking
Any LLM-backed action must emit a structured usage event with provider, model, token counts, and estimated cost.
`);
  }
}

/** Create a session folder and return its path + short name */
function createSessionFolder(folderPath: string, terminalId: string, sessionType: string): { sessionDir: string; sessionName: string } {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
  const shortId = terminalId.slice(0, 4);
  const sessionName = `${date}_${time}_${sessionType}_${shortId}`;
  const sessionDir = path.join(folderPath, "CoAgent_workspace", "sessions", sessionName);

  fs.mkdirSync(path.join(sessionDir, "artifacts"), { recursive: true });

  ensureSessionUsageFile(folderPath, sessionName);

  // Write session.json
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify({
    terminalId,
    type: sessionType,
    startedAt: now.toISOString(),
    endedAt: null,
    exitCode: null,
    folderName: sessionName,
  }, null, 2));

  // Create empty notes.md and inbox.jsonl
  fs.writeFileSync(path.join(sessionDir, "notes.md"), "");
  fs.writeFileSync(path.join(sessionDir, "inbox.jsonl"), "");

  // Copy coordinator files into coordinator session dir
  if (sessionType === "coordinator") {
    const sharedDir = path.join(folderPath, "CoAgent_workspace", "_shared");
    try {
      fs.copyFileSync(path.join(sharedDir, "coordinator-prompt.md"), path.join(sessionDir, "CLAUDE.md"));
    } catch {}
    try {
      fs.copyFileSync(path.join(sharedDir, "coordinator-agent.md"), path.join(sessionDir, "agent.md"));
    } catch {}
  }

  return { sessionDir, sessionName };
}

/** Update state.json to add/remove active session */
function updateActiveSession(folderPath: string, sessionName: string, action: "add" | "remove"): void {
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

/** Finalize session on exit */
function finalizeSession(sessionDir: string, exitCode: number): void {
  // Update session.json
  const sessionFile = path.join(sessionDir, "session.json");
  try {
    const meta = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    meta.endedAt = new Date().toISOString();
    meta.exitCode = exitCode;
    fs.writeFileSync(sessionFile, JSON.stringify(meta, null, 2));
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

// Track session metadata for cleanup
const sessionMeta = new Map<string, { folderPath: string; sessionName: string; sessionDir: string }>();

wss.on("connection", (ws: WebSocket) => {
  console.log("Client connected");

  ws.on("message", (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "folder:list": {
        const folders = registry.list();
        for (const f of folders) {
          ensureWorkspace(f.path);
        }
        send(ws, { type: "folder:list", folders });
        break;
      }

      case "folder:add": {
        try {
          const folder = registry.add(msg.path);
          ensureWorkspace(folder.path);
          send(ws, { type: "folder:added", folder });
        } catch (err) {
          send(ws, {
            type: "folder:error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
        break;
      }

      case "folder:remove": {
        registry.remove(msg.pathId);
        send(ws, { type: "folder:removed", pathId: msg.pathId });
        break;
      }

      case "fs:readdir": {
        try {
          const dirents = fs.readdirSync(msg.path, { withFileTypes: true });
          const entries: DirEntry[] = dirents
            .filter((d) => !d.name.startsWith("."))
            .map((d) => {
              const fullPath = path.join(msg.path, d.name);
              const entry: DirEntry = { name: d.name, isDir: d.isDirectory() };
              if (d.isDirectory()) {
                try {
                  entry.childCount = fs.readdirSync(fullPath).filter((n) => !n.startsWith(".")).length;
                } catch { entry.childCount = 0; }
              } else {
                try {
                  const stat = fs.statSync(fullPath);
                  const m = stat.mtime;
                  const day = String(m.getDate()).padStart(2, "0");
                  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m.getMonth()];
                  const h = String(m.getHours()).padStart(2, "0");
                  const min = String(m.getMinutes()).padStart(2, "0");
                  entry.mtime = `${day} ${mon} ${h}:${min}`;
                } catch {}
              }
              return entry;
            })
            .sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
          send(ws, { type: "fs:readdir", path: msg.path, entries });
        } catch (err) {
          send(ws, {
            type: "fs:error",
            path: msg.path,
            message: err instanceof Error ? err.message : "Failed to read directory",
          });
        }
        break;
      }

      case "terminal:create": {
        const folder = registry.resolve(msg.pathId);
        if (!folder) {
          send(ws, {
            type: "terminal:error",
            terminalId: "",
            message: "Unknown folder ID",
          });
          return;
        }

        try {
          const sessionType = msg.sessionType || "shell";

          // Pre-generate terminal ID to use in folder naming
          const tempId = crypto.randomUUID();
          const { sessionDir, sessionName } = createSessionFolder(folder.path, tempId, sessionType);

          const sharedDir = path.join(folder.path, "CoAgent_workspace", "_shared");
          const session = ptyManager.create(
            msg.pathId,
            folder.path,
            folder.label,
            sessionDir,
            (terminalId, data) => send(ws, { type: "terminal:output", terminalId, data }),
            (terminalId, exitCode) => {
              // Finalize session
              const meta = sessionMeta.get(terminalId);
              if (meta) {
                finalizeSession(meta.sessionDir, exitCode);
                refreshCostSummary(meta.folderPath);
                updateActiveSession(meta.folderPath, meta.sessionName, "remove");
                // Decrement watcher ref count
                const sd = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
                const remaining = (watchedDirCounts.get(sd) ?? 1) - 1;
                if (remaining <= 0) {
                  scratchpadWatcher.unwatch(sd);
                  watchedDirCounts.delete(sd);
                } else {
                  watchedDirCounts.set(sd, remaining);
                }
                sessionMeta.delete(terminalId);
              }
              send(ws, { type: "terminal:exit", terminalId, exitCode });
            },
            {
              COAGENT_SHARED_DIR: sharedDir,
              COAGENT_SESSION_NAME: sessionName,
            }
          );

          // Track session metadata
          sessionMeta.set(session.id, { folderPath: folder.path, sessionName, sessionDir });

          // Update session.json with actual terminalId (ptyManager generates its own)
          const sessionJsonPath = path.join(sessionDir, "session.json");
          try {
            const sjson = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
            sjson.terminalId = session.id;
            sjson.pid = session.pid;
            fs.writeFileSync(sessionJsonPath, JSON.stringify(sjson, null, 2));
          } catch {}

          // Register as active session
          updateActiveSession(folder.path, sessionName, "add");

          // Start watching scratchpad for this folder if not already
          const count = watchedDirCounts.get(sharedDir) ?? 0;
          if (count === 0) {
            scratchpadWatcher.watch(sharedDir, (scratchMsg: ScratchpadMessage) => {
              // Route message to target sessions' inboxes
              for (const [tid, meta] of sessionMeta.entries()) {
                const metaShared = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
                if (metaShared !== sharedDir) continue;
                // Deliver if broadcast or targeted to this session
                if (scratchMsg.to === "*" || scratchMsg.to === meta.sessionName) {
                  // Don't deliver to sender
                  if (scratchMsg.from === meta.sessionName) continue;
                  // Append to session inbox
                  const inboxPath = path.join(meta.sessionDir, "inbox.jsonl");
                  try {
                    fs.appendFileSync(inboxPath, JSON.stringify(scratchMsg) + "\n");
                  } catch {}
                  // Send WS notification
                  send(ws, {
                    type: "message:new",
                    terminalId: tid,
                    from: scratchMsg.from,
                    tag: scratchMsg.tag,
                    preview: scratchMsg.msg.slice(0, 80),
                  });
                }
              }
            });
          }
          watchedDirCounts.set(sharedDir, count + 1);

          send(ws, {
            type: "terminal:created",
            terminalId: session.id,
            pathId: msg.pathId,
            x: msg.x,
            y: msg.y,
            sessionType,
            sessionName,
          });
        } catch (err) {
          send(ws, {
            type: "terminal:error",
            terminalId: "",
            message: err instanceof Error ? err.message : "Failed to create terminal",
          });
        }
        break;
      }

      case "terminal:input": {
        ptyManager.write(msg.terminalId, msg.data);
        break;
      }

      case "terminal:resize": {
        ptyManager.resize(msg.terminalId, msg.cols, msg.rows);
        break;
      }

      case "terminal:close": {
        ptyManager.kill(msg.terminalId);
        break;
      }

      case "usage:cost_request": {
        const folder = registry.resolve(msg.pathId);
        if (folder) {
          const summary = readCostSummary(folder.path) ?? {
            updatedAt: new Date().toISOString(),
            workspace_total_usd: 0,
            workspace_total_tokens: 0,
            by_session: {},
            by_model: {},
          };
          send(ws, { type: "usage:cost_summary", pathId: msg.pathId, summary });
        }
        break;
      }

      case "usage:record": {
        const folder = registry.resolve(msg.pathId);
        const meta = sessionMeta.get(msg.terminalId);
        if (folder && meta) {
          recordUsageEvent(meta.folderPath, meta.sessionName, msg.event as UsageEvent);
          const summary = readCostSummary(meta.folderPath);
          if (summary) {
            send(ws, { type: "usage:cost_summary", pathId: msg.pathId, summary });
          }
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  scratchpadWatcher.unwatchAll();
  ptyManager.killAll();
  wss.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Terminal Canvas backend listening on ws://localhost:${PORT} (HTTP POST /usage for usage recording)`);
});
