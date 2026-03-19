import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { FolderRegistry } from "./folderRegistry.js";
import { PtyManager } from "./ptyManager.js";
import { TerminalRegistry } from "./terminalRegistry.js";
import {
  ensureUsageFiles,
  ensureSessionUsageFile,
  recordUsageEvent,
  readCostSummary,
  refreshCostSummary,
  type UsageEvent,
} from "./usageLogger.js";
import type { ClientMessage, ServerMessage, DirEntry, TerminalRegistryEntry, SessionHistoryEntry, ArtifactFileInfo } from "./protocol.js";
import { ScratchpadWatcher, type ScratchpadMessage } from "./scratchpadWatcher.js";
import { ArtifactWatcher } from "./artifactWatcher.js";
import { scanClaudeUsage } from "./usageParser.js";

const PORT = 3001;
const registry = new FolderRegistry();
const ptyManager = new PtyManager();
const terminalRegistry = new TerminalRegistry();
const scratchpadWatcher = new ScratchpadWatcher();
const artifactWatcher = new ArtifactWatcher();

// Track which sharedDirs are being watched and how many terminals reference them
const watchedDirCounts = new Map<string, number>();

// Pending notifications for busy terminals (queued until idle)
const pendingNotifications = new Map<string, ScratchpadMessage[]>();

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

// Snapshot existing Claude session files for a given CWD before spawning a terminal.
// Returns the set of pre-existing JSONL filenames so we can detect the new one later.
function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[\/_ .]/g, "-");
}

function snapshotClaudeSessions(cwd: string): Set<string> {
  try {
    const encoded = encodeClaudeProjectDir(cwd);
    const projectDir = path.join(os.homedir(), ".claude", "projects", encoded);
    if (!fs.existsSync(projectDir)) return new Set();
    return new Set(fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl")));
  } catch {
    return new Set();
  }
}

// Poll for a new JSONL file that appeared after the snapshot was taken.
// Calls onFound(uuid) when found. Gives up after ~30 seconds.
function watchForNewClaudeSession(
  cwd: string,
  beforeFiles: Set<string>,
  onFound: (uuid: string) => void
): void {
  const encoded = encodeClaudeProjectDir(cwd);
  const projectDir = path.join(os.homedir(), ".claude", "projects", encoded);
  let attempts = 0;
  const poll = () => {
    attempts++;
    try {
      if (fs.existsSync(projectDir)) {
        const current = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
        const newFile = current.find((f) => !beforeFiles.has(f));
        if (newFile) { onFound(newFile.replace(".jsonl", "")); return; }
      }
    } catch {}
    if (attempts < 15) setTimeout(poll, 2000);
  };
  setTimeout(poll, 2000);
}

// Backfill claudeSessionId for registry entries that predate the UUID-capture logic.
// Reads ~/.claude/history.jsonl and matches each entry by CWD + nearest timestamp.
function backfillClaudeSessionIds(folderPath: string, entries: TerminalRegistryEntry[]): void {
  const historyPath = path.join(os.homedir(), ".claude", "history.jsonl");
  if (!fs.existsSync(historyPath)) return;

  let history: Array<{ sessionId: string; project: string; timestamp: number }> = [];
  try {
    history = fs.readFileSync(historyPath, "utf-8")
      .split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.sessionId && e.project && e.timestamp);
  } catch { return; }

  // De-duplicate existing claudeSessionId assignments — if two entries share the same UUID,
  // clear it from all but the earliest one so the backfill can re-assign correctly.
  const seenIds = new Map<string, TerminalRegistryEntry>();
  for (const entry of [...entries].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())) {
    if (!entry.claudeSessionId) continue;
    if (seenIds.has(entry.claudeSessionId)) {
      terminalRegistry.update(folderPath, entry.terminalId, { claudeSessionId: undefined });
      entry.claudeSessionId = undefined;
    } else {
      seenIds.set(entry.claudeSessionId, entry);
    }
  }

  // Compute after de-dup so newly-cleared entries are included
  const needsBackfill = entries.filter((e) => !e.claudeSessionId && e.provider !== "codex");
  if (needsBackfill.length === 0) return;

  const usedSessionIds = new Set(entries.filter((e) => e.claudeSessionId).map((e) => e.claudeSessionId!));

  // Sort by startedAt so earlier terminals get first pick of closest sessions
  const sorted = [...needsBackfill].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  for (const entry of sorted) {
    // All session types now run from sessionDir as cwd.
    // Also try folderPath as a fallback for pre-migration entries.
    const startTs = new Date(entry.startedAt).getTime();
    // Try sessionDir first (current cwd); fall back to folderPath for pre-migration entries
    const candidates = [entry.sessionDir, folderPath];
    let match: { sessionId: string; delta: number } | undefined;
    for (const cwd of candidates) {
      match = history
        .filter((e) => e.project === cwd && !usedSessionIds.has(e.sessionId))
        .map((e) => ({ sessionId: e.sessionId, delta: Math.abs(e.timestamp - startTs) }))
        .sort((a, b) => a.delta - b.delta)[0];
      if (match) break;
    }

    // Accept if within 24h of when the terminal started
    if (match && match.delta < 24 * 60 * 60 * 1000) {
      terminalRegistry.update(folderPath, entry.terminalId, { claudeSessionId: match.sessionId });
      entry.claudeSessionId = match.sessionId;
      usedSessionIds.add(match.sessionId);
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/** Ensure CoAgent_workspace and _shared/ structure exist */
function ensureWorkspace(folderPath: string): void {
  const workspace = path.join(folderPath, "CoAgent_workspace");
  const shared = path.join(workspace, "_shared");
  const sessions = path.join(workspace, "sessions");

  const memoryDir = path.join(shared, "memory");
  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(sessions, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });

  // Seed shared.md (team whiteboard)
  const sharedMdFile = path.join(memoryDir, "shared.md");
  if (!fs.existsSync(sharedMdFile)) {
    fs.writeFileSync(sharedMdFile, "# Team Whiteboard\nAppend-only. Only the coordinator may summarize/rewrite.\n");
  }

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
Use the \`coagent\` CLI for all workspace operations — it handles JSON formatting and timestamps automatically.

## On startup
1. \`coagent state\` — current workspace state
2. \`coagent context\` — project goals
3. \`coagent tasks\` — check what others are doing
4. \`coagent inbox\` — read any messages sent to you

## Core rules
- Do not directly edit \`state.json\` — emit events, backend updates state
- Use \`coagent\` commands instead of raw echo/JSON — it validates and formats correctly
- Claim tasks before starting work
- Save deliverables to \`$COAGENT_SESSION_DIR/artifacts/\` — that is the ONLY place the UI shows files

## Saving artifacts
Any file meant for human review (reports, summaries, outputs) must go in your artifacts directory:
\`\`\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/report.md" << 'EOF'
...content...
EOF
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/report.md" --desc "What this is"
\`\`\`

## Your identity
- Session dir: $COAGENT_SESSION_DIR
- Session name: $COAGENT_SESSION_NAME
- Shared dir: $COAGENT_SHARED_DIR

## Inbox
Your inbox is at \`$COAGENT_SESSION_DIR/inbox.jsonl\`. Messages from other agents are automatically delivered here.
Check it periodically: \`coagent inbox\`

## Learning about other agents' work
- \`coagent tasks\` — task ownership and status
- \`coagent sessions\` — active terminal registry
- Read \`_shared/scratchpad.jsonl\` to see full message history across all agents
- Read other sessions' \`notes.md\` or \`summary.json\` in \`sessions/\` to understand prior work

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

  // Seed _shared/bin/coagent CLI helper
  const binDir = path.join(shared, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const coagentBin = path.join(binDir, "coagent");
  // Always overwrite to keep in sync with backend
  fs.writeFileSync(coagentBin, `#!/usr/bin/env bash
set -euo pipefail

SHARED_DIR="\${COAGENT_SHARED_DIR:?COAGENT_SHARED_DIR not set}"
SESSION_NAME="\${COAGENT_SESSION_NAME:?COAGENT_SESSION_NAME not set}"
SESSION_DIR="\${COAGENT_SESSION_DIR:-}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

cmd="\${1:-help}"
shift || true

case "$cmd" in

# ── send message ──────────────────────────────────────────────
send)
  TO="*"; TAG="status"; MSG=""; REF=""; MSGTYPE="chat"; TASKID=""; ARTPATH=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --to)  TO="$2"; shift 2;;
      --tag) TAG="$2"; shift 2;;
      --msg) MSG="$2"; shift 2;;
      --ref) REF="$2"; shift 2;;
      --type) MSGTYPE="$2"; shift 2;;
      --task-id) TASKID="$2"; shift 2;;
      --artifact) ARTPATH="$2"; shift 2;;
      *) echo "Unknown flag: $1" >&2; exit 1;;
    esac
  done
  if [[ -z "$MSG" ]]; then echo "Usage: coagent send --msg \\"...\\" [--to \\"*\\"] [--tag status] [--type chat] [--ref \\"\\"]" >&2; exit 1; fi
  MSGID="$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "msg-$(date +%s)-$$")"
  printf '{"ts":"%s","from":"%s","to":"%s","tag":"%s","msg":"%s","ref":%s,"id":"%s","msgType":"%s","status":"sent"%s%s}\\n' \\
    "$(ts)" "$SESSION_NAME" "$TO" "$TAG" \\
    "$(printf '%s' "$MSG" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" \\
    "\${REF:+\\"$REF\\"}\${REF:-null}" \\
    "$MSGID" "$MSGTYPE" \\
    "\${TASKID:+,\\"taskId\\":\\"$TASKID\\"}" \\
    "\${ARTPATH:+,\\"artifactPath\\":\\"$ARTPATH\\"}" >> "$SHARED_DIR/scratchpad.jsonl"
  echo "Message sent (id: $MSGID)."
  ;;

# ── acknowledge message ───────────────────────────────────────
ack)
  MSGID=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) MSGID="$2"; shift 2;;
      *) shift;;
    esac
  done
  if [[ -z "$MSGID" ]]; then echo "Usage: coagent ack --id MESSAGE_ID" >&2; exit 1; fi
  printf '{"ts":"%s","from":"%s","to":"*","tag":"ack","msg":"Acknowledged %s","msgType":"status_update","ref":"%s","status":"acknowledged"}\\n' \\
    "$(ts)" "$SESSION_NAME" "$MSGID" "$MSGID" >> "$SHARED_DIR/scratchpad.jsonl"
  echo "Message $MSGID acknowledged."
  ;;

# ── task operations ───────────────────────────────────────────
task)
  SUB="\${1:-}"; shift || true
  case "$SUB" in
    start)
      ID=""; TITLE=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --id) ID="$2"; shift 2;;
          --title) TITLE="$2"; shift 2;;
          *) shift;;
        esac
      done
      if [[ -z "$ID" || -z "$TITLE" ]]; then echo "Usage: coagent task start --id ID --title TITLE" >&2; exit 1; fi
      printf '{"id":"%s","ts":"%s","title":"%s","status":"in_progress","owner":"%s"}\\n' \\
        "$ID" "$(ts)" "$(printf '%s' "$TITLE" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" "$SESSION_NAME" >> "$SHARED_DIR/tasks.jsonl"
      echo "Task $ID started."
      ;;
    done)
      ID=""; RESULT=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --id) ID="$2"; shift 2;;
          --result) RESULT="$2"; shift 2;;
          *) shift;;
        esac
      done
      if [[ -z "$ID" ]]; then echo "Usage: coagent task done --id ID [--result TEXT]" >&2; exit 1; fi
      printf '{"id":"%s","ts":"%s","status":"done","owner":"%s","result":"%s"}\\n' \\
        "$ID" "$(ts)" "$SESSION_NAME" "$(printf '%s' "$RESULT" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" >> "$SHARED_DIR/tasks.jsonl"
      echo "Task $ID done."
      ;;
    blocked)
      ID=""; REASON=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --id) ID="$2"; shift 2;;
          --reason) REASON="$2"; shift 2;;
          *) shift;;
        esac
      done
      if [[ -z "$ID" ]]; then echo "Usage: coagent task blocked --id ID [--reason TEXT]" >&2; exit 1; fi
      printf '{"id":"%s","ts":"%s","status":"blocked","owner":"%s","reason":"%s"}\\n' \\
        "$ID" "$(ts)" "$SESSION_NAME" "$(printf '%s' "$REASON" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" >> "$SHARED_DIR/tasks.jsonl"
      echo "Task $ID blocked."
      ;;
    *) echo "Usage: coagent task {start|done|blocked} ..." >&2; exit 1;;
  esac
  ;;

# ── artifact ──────────────────────────────────────────────────
artifact)
  TYPE="code"; APATH=""; DESC=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type) TYPE="$2"; shift 2;;
      --path) APATH="$2"; shift 2;;
      --desc) DESC="$2"; shift 2;;
      *) shift;;
    esac
  done
  if [[ -z "$APATH" || -z "$DESC" ]]; then echo "Usage: coagent artifact --path PATH --desc DESC [--type code]" >&2; exit 1; fi
  # Copy the file into the session artifacts dir so the UI can display it
  ARTIFACTS_DIR="$COAGENT_SESSION_DIR/artifacts"
  mkdir -p "$ARTIFACTS_DIR"
  FNAME="$(basename "$APATH")"
  DEST="$ARTIFACTS_DIR/$FNAME"
  if [[ "$APATH" != "$DEST" && -f "$APATH" ]]; then
    cp "$APATH" "$DEST"
  fi
  printf '{"ts":"%s","session":"%s","type":"%s","path":"%s","description":"%s"}\\n' \\
    "$(ts)" "$SESSION_NAME" "$TYPE" \\
    "$(printf '%s' "$APATH" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" \\
    "$(printf '%s' "$DESC" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" >> "$SHARED_DIR/artifacts.jsonl"
  echo "Artifact registered: $DEST"
  ;;

# ── decision ──────────────────────────────────────────────────
decision)
  DECISION=""; RATIONALE=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --decision) DECISION="$2"; shift 2;;
      --rationale) RATIONALE="$2"; shift 2;;
      *) shift;;
    esac
  done
  if [[ -z "$DECISION" ]]; then echo "Usage: coagent decision --decision TEXT [--rationale TEXT]" >&2; exit 1; fi
  # Auto-increment decision ID
  COUNT=$(wc -l < "$SHARED_DIR/decisions.jsonl" 2>/dev/null | tr -d ' ')
  DID="d$((COUNT + 1))"
  printf '{"id":"%s","ts":"%s","session":"%s","decision":"%s","rationale":"%s"}\\n' \\
    "$DID" "$(ts)" "$SESSION_NAME" \\
    "$(printf '%s' "$DECISION" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" \\
    "$(printf '%s' "$RATIONALE" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" >> "$SHARED_DIR/decisions.jsonl"
  echo "Decision $DID logged."
  ;;

# ── memory ────────────────────────────────────────────────────
memory)
  TYPE="learning"; CONTENT=""; TARGET="jsonl"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type) TYPE="$2"; shift 2;;
      --content) CONTENT="$2"; shift 2;;
      --shared) TARGET="shared"; shift;;
      *) shift;;
    esac
  done
  if [[ -z "$CONTENT" ]]; then echo "Usage: coagent memory --content TEXT [--type learning] [--shared]" >&2; exit 1; fi
  # Always write to memory.jsonl
  printf '{"ts":"%s","session":"%s","type":"%s","content":"%s"}\\n' \\
    "$(ts)" "$SESSION_NAME" "$TYPE" \\
    "$(printf '%s' "$CONTENT" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')" >> "$SHARED_DIR/memory.jsonl"
  # Write to shared.md only if promoted (has memory.md)
  if [[ "$TARGET" == "shared" ]]; then
    if [[ -n "$SESSION_DIR" && -f "$SESSION_DIR/memory.md" ]]; then
      printf '\\n- [%s] (%s) %s' "$(ts)" "$SESSION_NAME" "$CONTENT" >> "$SHARED_DIR/memory/shared.md"
      echo "Memory saved to shared whiteboard."
    else
      echo "Error: Only promoted agents can write to shared memory. Get promoted first." >&2
      exit 1
    fi
  else
    echo "Memory saved."
  fi
  ;;

# ── read operations ───────────────────────────────────────────
inbox)
  if [[ "\${1:-}" == "--count" ]]; then
    if [[ -n "$SESSION_DIR" && -f "$SESSION_DIR/inbox.jsonl" ]]; then
      wc -l < "$SESSION_DIR/inbox.jsonl" | tr -d ' '
    else
      echo "0"
    fi
  else
    if [[ -n "$SESSION_DIR" && -f "$SESSION_DIR/inbox.jsonl" ]]; then
      cat "$SESSION_DIR/inbox.jsonl"
    else
      echo "No inbox messages."
    fi
  fi
  ;;

state)
  cat "$SHARED_DIR/state.json" 2>/dev/null || echo "{}"
  ;;

tasks)
  cat "$SHARED_DIR/tasks.jsonl" 2>/dev/null || echo "No tasks."
  ;;

context)
  cat "$SHARED_DIR/context.md" 2>/dev/null || echo "No context file."
  ;;

sessions)
  if [[ -f "$SHARED_DIR/terminal-registry.json" ]]; then
    # Show a readable summary: title (or sessionName), role, status
    python3 -c "
import json, sys
try:
    entries = json.load(open('$SHARED_DIR/terminal-registry.json'))
    for e in entries:
        name = e.get('title') or e.get('sessionName','?')
        role = e.get('role','?')
        status = e.get('status','?')
        session = e.get('sessionName','?')
        print(f'  {name:<20} role={role:<12} status={status:<8} session={session}')
except: pass
" 2>/dev/null || cat "$SHARED_DIR/terminal-registry.json"
  else
    echo "[]"
  fi
  ;;

# ── workers (coordinator view of all worker activity) ────────
workers)
  SESSIONS_DIR="$(dirname "$SHARED_DIR")/sessions"
  if [[ -d "$SESSIONS_DIR" ]]; then
    for dir in "$SESSIONS_DIR"/*/; do
      SNAME=$(basename "$dir")
      [[ "$SNAME" == "coordinator" ]] && continue
      # Show session name and last few lines of output
      echo "=== $SNAME ==="
      if [[ -f "$dir/output.jsonl" ]]; then
        tail -3 "$dir/output.jsonl" 2>/dev/null | while IFS= read -r line; do
          echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('data',''),end='')" 2>/dev/null
        done
      else
        echo "  (no output yet)"
      fi
      echo ""
    done
  else
    echo "No sessions directory found."
  fi
  ;;

# ── help ──────────────────────────────────────────────────────
help|*)
  cat <<'HELP'
coagent — workspace CLI for multi-agent coordination

Write commands:
  send     --msg TEXT [--to "*"] [--tag status] [--type chat] [--task-id ID] [--artifact PATH]
  ack      --id MESSAGE_ID
  task     start --id ID --title TEXT
  task     done  --id ID [--result TEXT]
  task     blocked --id ID [--reason TEXT]
  artifact --path PATH --desc TEXT [--type code]
  decision --decision TEXT [--rationale TEXT]
  memory   --content TEXT [--type learning] [--shared]

Read commands:
  inbox [--count]  Read your inbox (--count for unread count only)
  state      Read workspace state.json
  tasks      Read all tasks
  context    Read project context.md
  sessions   List terminal registry entries
  workers    Show recent output from all worker sessions

Message types (--type): chat, task_assign, status_update, question, handoff, artifact_ready, blocker
Routing (--to): "*" broadcast, "session_name", "role:coordinator", "role:worker", "name:agent-name"
HELP
  ;;
esac
`);
  fs.chmodSync(coagentBin, 0o755);

  // Seed skills/
  const skillsDir = path.join(shared, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const skills: Record<string, string> = {
    "start-task.md": `# Start Task
\`\`\`bash
coagent task start --id t1 --title "Task description"
coagent task done --id t1 --result "Completed successfully"
coagent task blocked --id t1 --reason "Waiting on API keys"
\`\`\`
1. Check existing tasks first: \`coagent tasks\`
2. Pick a unique ID (t1, t2, ...) not already in use
3. When done or blocked, update with the appropriate subcommand
`,
    "send-message.md": `# Send Message
\`\`\`bash
coagent send --to "*" --tag status --msg "Your message here"
coagent send --to "session_name" --tag request --msg "Need help with X"
\`\`\`
- to: "*" for broadcast, or specific session name
- Tags: finding (discovery), status (update), request (need help), handoff (passing work)
- Messages are auto-delivered to the recipient's inbox by the backend
`,
    "check-inbox.md": `# Check Inbox
\`\`\`bash
coagent inbox
\`\`\`
Each line is a JSON message with: ts, from, to, tag, msg, ref.
Process messages — respond to requests, acknowledge findings, act on handoffs.
To reply: \`coagent send --to "sender_session_name" --tag status --msg "Reply"\`
`,
    "register-artifact.md": `# Register Artifact
1. Save file in your \`artifacts/\` folder
2. Register it:
\`\`\`bash
coagent artifact --type code --path "sessions/.../artifacts/filename" --desc "Auth module"
\`\`\`
Types: code, report, config
`,
    "write-decision.md": `# Write Decision
\`\`\`bash
coagent decision --decision "Use JWT tokens" --rationale "Simpler than sessions for stateless API"
\`\`\`
Only log when a rule, default, or tradeoff is resolved. Not for casual observations.
`,
    "write-memory.md": `# Write Memory
\`\`\`bash
coagent memory --type learning --content "Redis needs auth in prod"
\`\`\`
Types: learning, pattern, constraint
Only for durable conclusions. Ask: "Would a new agent need this fact next week?"
`,
    "record-usage.md": `# Record Usage
After each completed LLM/API call, POST to http://localhost:3001/usage:
{"sessionDir":"$COAGENT_SESSION_DIR","event":{"ts":"...","session":"$COAGENT_SESSION_NAME","provider":"anthropic|openai|...","model":"...","input_tokens":N,"output_tokens":N,"estimated_cost_usd":0.01,"pricing_version":"..."}}
`,
    "end-session.md": `# End Session
Before exiting or handing off:
1. Write \`summary.json\` in your session folder with: key findings, files touched, tasks completed, handoff notes
2. Save durable learnings: \`coagent memory --content "..."\`
3. If handing off: \`coagent send --to "*" --tag handoff --msg "Handing off X to next agent"\`
`,
    "orient.md": `# Orient
Run these commands to understand current workspace state:
\`\`\`bash
coagent context    # Project goals
coagent state      # Workspace state
coagent tasks      # Task board
coagent inbox      # Your messages
coagent sessions   # Active terminals
\`\`\`
If promoted, also read your \`memory.md\` for persistent context.
Read \`$COAGENT_SHARED_DIR/memory/shared.md\` for team-wide context.
`,
    "blocked.md": `# Report Blocker
1. Mark the task as blocked:
\`\`\`bash
coagent task blocked --id TASK_ID --reason "Description of blocker"
\`\`\`
2. Alert the coordinator:
\`\`\`bash
coagent send --to "role:coordinator" --type blocker --msg "Blocked on TASK_ID: reason"
\`\`\`
`,
    "handoff.md": `# Handoff Task
1. Complete or save your current work
2. Update task status: \`coagent task done --id ID --result "Progress so far"\`
3. Save durable learnings: \`coagent memory --content "Key findings..."\`
4. Notify the recipient:
\`\`\`bash
coagent send --to "recipient_name" --type handoff --task-id TASK_ID --msg "Handing off: context and next steps"
\`\`\`
`,
    "promote.md": `# Promote Terminal
Promotion converts an ephemeral terminal into a persistent named agent.

What happens on promotion:
1. Session folder is renamed to the agent name
2. notes.md content is moved to memory.md (persistent memory)
3. notes.md is reset for fresh scratchpad use
4. CLAUDE.md is rewritten with full identity (name, role, coworkers)
5. Coordinator is notified via scratchpad
6. Terminal becomes persistent and survives restarts

To promote: ask the user or coordinator to promote you.
`,
  };

  for (const [filename, content] of Object.entries(skills)) {
    const skillPath = path.join(skillsDir, filename);
    if (!fs.existsSync(skillPath)) {
      fs.writeFileSync(skillPath, content);
    }
  }

  // Seed .claude/commands/ for native slash commands
  const claudeCommandsDir = path.join(workspace, ".claude", "commands");
  fs.mkdirSync(claudeCommandsDir, { recursive: true });

  const slashCommands: Record<string, string> = {
    "orient.md": `Run the following commands and present the results as a structured briefing:
1. \`coagent context\`
2. \`coagent state\`
3. \`coagent tasks\`
4. \`coagent inbox\`
5. \`coagent sessions\`
If you have a memory.md file, read it too. Then read \`$COAGENT_SHARED_DIR/memory/shared.md\` for team context.
Present findings as: Active Sessions, Tasks, Messages, Blockers, Recommendations.`,
    "msg.md": `Send a message to another agent. Usage: /msg <recipient> <message>
Run: \`coagent send --to "$ARGUMENTS" --type chat --msg "..."\`
For urgent: \`coagent send --to "recipient" --type blocker --msg "..."\``,
    "remember.md": `Save something to memory. Usage: /remember <content>
1. Append to your notes.md: the content provided
2. If promoted, also run: \`coagent memory --content "$ARGUMENTS" --shared\`
3. Otherwise just run: \`coagent memory --content "$ARGUMENTS"\``,
    "blocked.md": `Report a blocker. Usage: /blocked <task-id> <reason>
1. Run: \`coagent task blocked --id TASK_ID --reason "reason"\`
2. Run: \`coagent send --to "role:coordinator" --type blocker --msg "Blocked on TASK_ID: reason"\``,
    "handoff.md": `Hand off work to another agent. Usage: /handoff <recipient> <context>
1. Save progress to notes/memory
2. Run: \`coagent send --to "recipient" --type handoff --msg "context and next steps"\`
3. Update task status if applicable`,
    "promote.md": `Promote this terminal to a named persistent agent. Usage: /promote <name> [role]
This will rename the session, create memory.md, rewrite CLAUDE.md with full identity, and notify the coordinator.`,
  };

  for (const [filename, content] of Object.entries(slashCommands)) {
    const cmdPath = path.join(claudeCommandsDir, filename);
    if (!fs.existsSync(cmdPath)) {
      fs.writeFileSync(cmdPath, content);
    }
  }

  // Seed .claude/hooks/check-inbox.sh (Stop hook for inbox notification)
  const hooksDir = path.join(workspace, ".claude", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const checkInboxScript = path.join(hooksDir, "check-inbox.sh");
  fs.writeFileSync(checkInboxScript, `#!/usr/bin/env bash
COUNT=$(coagent inbox --count 2>/dev/null || echo "0")
if [[ "$COUNT" -gt 0 ]]; then
  echo "You have $COUNT message(s) in your inbox. Run \\\`coagent inbox\\\` to read them."
fi
`);
  fs.chmodSync(checkInboxScript, 0o755);

  // Seed .claude/hooks/auto-report.sh (Stop hook for workers to report progress to coordinator)
  const autoReportScript = path.join(hooksDir, "auto-report.sh");
  fs.writeFileSync(autoReportScript, `#!/usr/bin/env bash
# Workers auto-report their latest activity to the coordinator after each response.
# This lets the coordinator stay aware of what all workers are doing.
# Only runs for non-coordinator sessions.

SESSION_NAME="\${COAGENT_SESSION_NAME:-}"
SHARED_DIR="\${COAGENT_SHARED_DIR:-}"
SESSION_DIR="\${COAGENT_SESSION_DIR:-}"

# Skip if coordinator or env not set
if [[ -z "$SESSION_NAME" || -z "$SHARED_DIR" || "$SESSION_NAME" == "coordinator" ]]; then
  exit 0
fi

# Read the last tool result from the stop hook input (stdin contains the assistant's last message summary)
# We use the recent output log to get a brief summary of what happened
LAST_LINES=""
if [[ -f "$SESSION_DIR/output.jsonl" ]]; then
  # Get last few data chunks to reconstruct recent terminal text
  LAST_LINES=$(tail -5 "$SESSION_DIR/output.jsonl" 2>/dev/null | while IFS= read -r line; do
    echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('data',''),end='')" 2>/dev/null
  done | tr '\\n' ' ' | sed 's/  */ /g' | tail -c 200)
fi

if [[ -n "$LAST_LINES" ]]; then
  # Send a status_update to the coordinator with a brief summary
  coagent send --to "role:coordinator" --type status_update --tag progress --msg "[$SESSION_NAME] latest: $LAST_LINES" 2>/dev/null || true
fi
`);
  fs.chmodSync(autoReportScript, 0o755);

  // Seed .claude/settings.local.json with Stop + Notification hooks
  const claudeDir = path.join(workspace, ".claude");
  const settingsLocalPath = path.join(claudeDir, "settings.local.json");
  // Always overwrite to keep hooks in sync
  fs.writeFileSync(settingsLocalPath, JSON.stringify({
    hooks: {
      Stop: [
        { type: "command", command: `bash ${checkInboxScript}` },
        { type: "command", command: `bash ${autoReportScript}` },
      ],
      Notification: [{
        matcher: "idle_prompt",
        hooks: [{ type: "command", command: `bash ${checkInboxScript}` }],
      }],
    },
  }, null, 2));

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
  if (true) { // always overwrite to keep instructions current
    fs.writeFileSync(coordinatorPromptFile, `# Coordinator
You are the workspace coordinator. Observe, summarize, advise, and maintain team memory.
Use the \`coagent\` CLI for all workspace operations.

## On startup
1. \`coagent state\` — active sessions, blockers, current goal
2. \`coagent tasks\` — task ownership and status
3. \`coagent inbox\` — messages sent to you
4. \`coagent sessions\` — active terminal registry
5. \`coagent context\` — project goals

## Default mode: OBSERVE
- Summarize what each active session is doing
- Report blockers and stalled tasks
- Highlight recent decisions and artifacts

## How to see what workers are doing
Workers automatically send you progress updates after each response. Check your inbox:
\\\`coagent inbox\\\`

To see who is active right now:
\\\`coagent sessions\\\`

To read the full message history across all agents:
\\\`cat $COAGENT_SHARED_DIR/scratchpad.jsonl\\\`

To read a specific worker's output log:
\\\`tail -20 $COAGENT_SHARED_DIR/../sessions/<session-name>/output.jsonl\\\`

**When asked about what a worker did**, always check your inbox first — workers auto-report their progress there.

## Processing worker results
When a worker sends you a status_update or task completion message:
1. Read and acknowledge the message: \`coagent ack --id MESSAGE_ID\`
2. Extract key findings, decisions, and learnings
3. Update the team whiteboard with important results:
   \`\`\`bash
   coagent memory --content "FINDING: summary of what was learned" --shared
   \`\`\`
4. If the result is a decision, log it:
   \`\`\`bash
   coagent decision --decision "What was decided" --rationale "Why"
   \`\`\`
5. Reply to the worker with feedback or next steps:
   \`\`\`bash
   coagent send --to "worker-name" --type status_update --msg "Acknowledged. Next: ..."
   \`\`\`

## When asked to ACT
- Recommend task priorities
- Suggest spawning new terminals for specific work
- Draft task descriptions for other agents
- Only dispatch/create tasks when user explicitly asks

## Saving artifacts (summaries, reports, analyses)
When you produce a summary, workspace report, or analysis meant for human review:
1. Save the file to your artifacts directory:
   \`\`\`bash
   cat > "$COAGENT_SESSION_DIR/artifacts/summary.md" << 'EOF'
   # Summary
   ...content...
   EOF
   \`\`\`
2. Register it:
   \`\`\`bash
   coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/summary.md" --desc "Brief description"
   \`\`\`
Only files in \`$COAGENT_SESSION_DIR/artifacts/\` are shown to the user.

## Rules
- Do NOT work on tasks yourself — you are the observer, not a worker
- Keep answers concise — bullet points preferred
- Reference specific session names and task IDs
- Always check inbox when prompted — workers report results there
`);
  }

  // Seed CoAgent_workspace/CLAUDE.md (Claude CLI auto-reads this)
  const claudeMdFile = path.join(workspace, "CLAUDE.md");
  if (true) { // always overwrite to keep instructions current
    fs.writeFileSync(claudeMdFile, `# CoAgent Workspace

Multi-agent workspace. Multiple terminals may be active.
Use the \`coagent\` CLI for all workspace operations — it handles JSON formatting and timestamps automatically.

## On startup
1. \`coagent state\` — current workspace state
2. \`coagent context\` — project goals
3. \`coagent tasks\` — check what others are doing
4. \`coagent inbox\` — read any messages sent to you

## Core rules
- Do not directly edit \`state.json\` — emit events, backend updates state
- Use \`coagent\` commands instead of raw echo/JSON — it validates and formats correctly
- Claim tasks before starting work
- Save deliverables to \`$COAGENT_SESSION_DIR/artifacts/\` — that is the ONLY place the UI shows files

## Saving artifacts
Any file meant for human review (reports, summaries, outputs) must go in your artifacts directory:
\`\`\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/report.md" << 'EOF'
...content...
EOF
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/report.md" --desc "What this is"
\`\`\`

## Your identity
- Session dir: $COAGENT_SESSION_DIR (your working directory — saves go here by default)
- Project folder: $COAGENT_FOLDER_PATH (the user's project)
- Session name: $COAGENT_SESSION_NAME
- Shared dir: $COAGENT_SHARED_DIR

## Working on the project
You start in your session dir. To run commands against the user's project:
\`\`\`bash
cd "$COAGENT_FOLDER_PATH"   # go to the project
# run your commands, analysis, etc.
cd "$COAGENT_SESSION_DIR"   # return when done
\`\`\`
Always save output files to \`$COAGENT_SESSION_DIR/artifacts/\` so they appear in the UI.

## Inbox
Your inbox is at \`$COAGENT_SESSION_DIR/inbox.jsonl\`. Messages from other agents are automatically delivered here.
Check it periodically: \`coagent inbox\`

## Quick reference
\`\`\`bash
# Send messages
coagent send --to "*" --tag status --msg "Working on auth"
coagent send --to "session_name" --tag request --msg "Need help"

# Tasks
coagent task start --id t1 --title "Fix login"
coagent task done --id t1 --result "Fixed in auth.ts"
coagent task blocked --id t1 --reason "Waiting on API keys"

# Other writes
coagent artifact --type code --path "path/to/file" --desc "Auth module"
coagent decision --decision "Use JWT" --rationale "Simpler than sessions"
coagent memory --type learning --content "Redis needs auth in prod"

# Read operations
coagent inbox | coagent state | coagent tasks | coagent context | coagent sessions
\`\`\`

## Detailed skills (read when needed)
Skills are in \`_shared/skills/\`. Read the relevant one for detailed usage:
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
function createSessionFolder(folderPath: string, terminalId: string, sessionType: string, mode?: "quick" | "role"): { sessionDir: string; sessionName: string } {
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
      fs.writeFileSync(path.join(sessionDir, "CLAUDE.md"), `# Coordinator
You are the workspace coordinator. Observe, summarize, advise.
Use the \`coagent\` CLI for all workspace reads.

## On startup
1. \`coagent state\` — active sessions, blockers, current goal
2. \`coagent tasks\` — task ownership and status
3. \`coagent inbox\` — messages sent to you
4. \`coagent sessions\` — active terminal registry
5. \`coagent context\` — project goals

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

## Saving artifacts (summaries, reports, analyses)
When you produce a summary, workspace report, or analysis meant for human review:
1. Save the file to your artifacts directory:
   \`\`\`bash
   cat > "$COAGENT_SESSION_DIR/artifacts/summary.md" << 'EOF'
   # Summary
   ...content...
   EOF
   \`\`\`
2. Register it:
   \`\`\`bash
   coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/summary.md" --desc "Brief description"
   \`\`\`
Only files in \`$COAGENT_SESSION_DIR/artifacts/\` are shown to the user.

## Rules
- Do NOT modify shared state files directly
- Do NOT work on tasks yourself — you are the observer, not a worker
- Keep answers concise — bullet points preferred
- Reference specific session names and task IDs
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
3. \`coagent tasks\` — current task board
4. \`coagent sessions\` — who else is active

## Workflow
1. Check your inbox for a task assignment
2. Claim it: \`coagent task start --id ID --title "..."\`
3. Do the work
4. When done, **always** report results to the coordinator:
   \`\`\`bash
   coagent task done --id ID --result "Summary of what was done"
   coagent send --to "role:coordinator" --type status_update --msg "Completed ID: brief summary of findings and results"
   \`\`\`
5. If blocked: \`coagent send --to "role:coordinator" --type blocker --msg "Blocked on ID: reason"\`

## Saving artifacts (reports, outputs, deliverables)
When your task produces a report, analysis, or any file meant for human review:
1. Save the file inside your artifacts directory:
   \`\`\`bash
   cat > "$COAGENT_SESSION_DIR/artifacts/report.md" << 'EOF'
   # Report
   ...content...
   EOF
   \`\`\`
2. Register it so the coordinator can find it:
   \`\`\`bash
   coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/report.md" --desc "Brief description"
   \`\`\`

Only files saved to \`$COAGENT_SESSION_DIR/artifacts/\` are shown to the user. Everything else stays internal.

## Rules
- Always report back to coordinator when your task is complete
- Include key findings, decisions made, and files touched in your report
- Save important learnings: \`coagent memory --content "..."\`
- Your notes are in \`notes.md\`
- You cannot write to shared memory until promoted
`);
    }
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

/** Finalize session on exit (Stop hook) */
function finalizeSession(sessionDir: string, exitCode: number): void {
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
function scanSessionHistory(folderPath: string, runningTerminals: TerminalRegistryEntry[]): SessionHistoryEntry[] {
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

/** SessionStart hook: inject last N lines of memory/notes into terminal */
function injectSessionContext(terminalId: string, sessionDir: string): void {
  const memoryPath = path.join(sessionDir, "memory.md");
  const notesPath = path.join(sessionDir, "notes.md");
  const contextFile = fs.existsSync(memoryPath) ? memoryPath : notesPath;
  try {
    const content = fs.readFileSync(contextFile, "utf-8").trim();
    if (content) {
      const lines = content.split("\n");
      const last30 = lines.slice(-30).join("\n");
      // Write a comment into the PTY so Claude sees context
      setTimeout(() => {
        ptyManager.write(terminalId, `# Previous session context (last ${Math.min(lines.length, 30)} lines):\n# ${last30.replace(/\n/g, "\n# ")}\n`);
      }, 500);
    }
  } catch {}
}

// Track session metadata for cleanup
const sessionMeta = new Map<string, { folderPath: string; sessionName: string; sessionDir: string }>();

// Prune stale registry entries on startup
for (const folder of registry.list()) {
  try {
    terminalRegistry.pruneStale(folder.path);
  } catch {}
}

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

      case "folder:update_preset": {
        const updated = registry.updatePreset(msg.pathId, {
          defaultProvider: msg.defaultProvider,
          defaultMode: msg.defaultMode,
          defaultRole: msg.defaultRole,
        });
        if (updated) {
          send(ws, { type: "folder:preset_updated", pathId: msg.pathId, folder: updated });
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
          const provider = msg.provider ?? "claude";
          const mode = msg.mode ?? "quick";
          const role = msg.role;
          const sessionType = role === "coordinator" ? "coordinator" : (msg.sessionType || provider);
          const persistence = mode === "role" ? "persistent" : "ephemeral";

          // Clean up stale coordinator entries before spawning a new one
          if (sessionType === "coordinator") {
            terminalRegistry.removeStaleCoordinators(folder.path);
          }

          // Pre-generate terminal ID to use in folder naming
          const tempId = crypto.randomUUID();
          const { sessionDir, sessionName } = createSessionFolder(folder.path, tempId, sessionType, mode);

          const sharedDir = path.join(folder.path, "CoAgent_workspace", "_shared");
          // All session types run from their sessionDir so relative paths (e.g. artifacts/) resolve correctly.
          // Workers access the project folder via COAGENT_FOLDER_PATH.
          const cwd = sessionDir;

          // Snapshot existing Claude sessions before spawning so we can identify the new UUID
          const claudeSessionsBefore = snapshotClaudeSessions(cwd);

          const session = ptyManager.create(
            msg.pathId,
            cwd,
            folder.label,
            sessionDir,
            (terminalId, data) => {
              send(ws, { type: "terminal:output", terminalId, data });
            },
            (terminalId, exitCode) => {
              // Finalize session
              const meta = sessionMeta.get(terminalId);
              if (meta) {
                finalizeSession(meta.sessionDir, exitCode);
                refreshCostSummary(meta.folderPath);
                updateActiveSession(meta.folderPath, meta.sessionName, "remove");
                // Mark exited in terminal registry
                terminalRegistry.markExited(meta.folderPath, terminalId, exitCode);
                // Stop watching artifacts
                artifactWatcher.unwatch(path.join(meta.sessionDir, "artifacts"));
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
              COAGENT_FOLDER_PATH: folder.path,
              PATH: `${path.join(sharedDir, "bin")}:${process.env.PATH}`,
            }
          );

          // Track session metadata
          sessionMeta.set(session.id, { folderPath: folder.path, sessionName, sessionDir });

          const tag = sessionType === "coordinator" ? "coordinator" : (role ?? sessionType);

          // Update session.json with actual terminalId (ptyManager generates its own)
          const sessionJsonPath = path.join(sessionDir, "session.json");
          try {
            const sjson = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
            sjson.terminalId = session.id;
            sjson.pid = session.pid;
            sjson.tag = tag;
            fs.writeFileSync(sessionJsonPath, JSON.stringify(sjson, null, 2));
          } catch {}

          // Register as active session
          updateActiveSession(folder.path, sessionName, "add");

          // Register in terminal registry
          terminalRegistry.register(folder.path, {
            terminalId: session.id,
            pathId: msg.pathId,
            sessionName,
            sessionDir,
            sessionType,
            role: sessionType === "coordinator" ? "coordinator" : "worker",
            title: "",
            tag,
            x: msg.x,
            y: msg.y,
            width: sessionType === "coordinator" ? 660 : 540,
            height: sessionType === "coordinator" ? 420 : 320,
            pid: session.pid,
            startedAt: new Date().toISOString(),
            status: "running",
            mode,
            provider,
            persistence,
          });

          // Start watching scratchpad for this folder if not already
          const count = watchedDirCounts.get(sharedDir) ?? 0;
          if (count === 0) {
            scratchpadWatcher.watch(sharedDir, (scratchMsg: ScratchpadMessage) => {
              // Route message to target sessions' inboxes
              for (const [tid, meta] of sessionMeta.entries()) {
                const metaShared = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
                if (metaShared !== sharedDir) continue;
                // Don't deliver to sender
                if (scratchMsg.from === meta.sessionName) continue;

                // Role-based routing + name matching
                let shouldDeliver = false;
                if (scratchMsg.to === "*") {
                  shouldDeliver = true;
                } else if (scratchMsg.to === meta.sessionName) {
                  shouldDeliver = true;
                } else if (scratchMsg.to.startsWith("role:")) {
                  const targetRole = scratchMsg.to.slice(5);
                  const entries = terminalRegistry.load(meta.folderPath);
                  const entry = entries.find(e => e.terminalId === tid);
                  if (entry && entry.role === targetRole) shouldDeliver = true;
                } else {
                  // Match against display title, tag, or name: prefix
                  const target = scratchMsg.to.startsWith("name:") ? scratchMsg.to.slice(5) : scratchMsg.to;
                  const entries = terminalRegistry.load(meta.folderPath);
                  const entry = entries.find(e => e.terminalId === tid);
                  if (entry) {
                    const titleLower = (entry.title || "").toLowerCase();
                    const tagLower = (entry.tag || "").toLowerCase();
                    const targetLower = target.toLowerCase();
                    if (titleLower === targetLower || tagLower === targetLower) shouldDeliver = true;
                  }
                }

                if (shouldDeliver) {
                  // Append to session inbox
                  const inboxPath = path.join(meta.sessionDir, "inbox.jsonl");
                  try {
                    fs.appendFileSync(inboxPath, JSON.stringify(scratchMsg) + "\n");
                  } catch {}
                  // Broadcast WS notification to all connected clients
                  broadcast({
                    type: "message:new",
                    terminalId: tid,
                    from: scratchMsg.from,
                    tag: scratchMsg.tag,
                    preview: scratchMsg.msg.slice(0, 80),
                    msgType: scratchMsg.msgType,
                    messageId: scratchMsg.id,
                    taskId: scratchMsg.taskId,
                    artifactPath: scratchMsg.artifactPath,
                  });

                  // Urgent message push for blocker/handoff/question
                  const urgentTypes = ["blocker", "handoff", "question"];
                  if (scratchMsg.msgType && urgentTypes.includes(scratchMsg.msgType)) {
                    broadcast({
                      type: "message:urgent",
                      terminalId: tid,
                      from: scratchMsg.from,
                      msgType: scratchMsg.msgType,
                      preview: scratchMsg.msg.slice(0, 80),
                      messageId: scratchMsg.id,
                    });
                  }

                  // PTY input injection
                  // Coordinator gets injected for ALL message types (it's the hub)
                  // Workers only get injected for important types
                  const workerPushTypes = ["blocker", "question", "task_assign", "handoff"];
                  const entry = terminalRegistry.load(meta.folderPath).find(e => e.terminalId === tid);
                  const isCoordinator = entry?.role === "coordinator";
                  const shouldPush = isCoordinator
                    ? scratchMsg.msgType !== "status_update" || scratchMsg.from !== "system"  // skip system rename/promo noise
                    : (scratchMsg.msgType && workerPushTypes.includes(scratchMsg.msgType));
                  if (shouldPush) {
                    const lastOutput = ptyManager.getLastOutputTime(tid);
                    const idleMs = Date.now() - lastOutput;
                    if (idleMs > 2000) {
                      // Agent is idle at prompt — inject as user input
                      const prompt = `You received a [${scratchMsg.msgType}] message from ${scratchMsg.from}: "${scratchMsg.msg.slice(0, 120)}". Run coagent inbox, read it, and act on it.\n`;
                      ptyManager.write(tid, prompt);
                    } else {
                      // Agent is busy — queue for delivery when idle
                      if (!pendingNotifications.has(tid)) pendingNotifications.set(tid, []);
                      pendingNotifications.get(tid)!.push(scratchMsg);
                    }
                  }
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
            tag,
            mode,
            provider,
          });

          // Start watching session artifacts directory
          artifactWatcher.watch(path.join(sessionDir, "artifacts"), (files) => {
            send(ws, { type: "artifact:update", terminalId: session.id, files });
          });

          // Watch for the new Claude session UUID and persist it for future resume
          if (provider === "claude") {
            const terminalId = session.id;
            const folderPath = folder.path;
            watchForNewClaudeSession(cwd, claudeSessionsBefore, (uuid) => {
              terminalRegistry.update(folderPath, terminalId, { claudeSessionId: uuid });
            });
          }
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
        // Never kill coordinator terminals via close — they auto-respawn
        const closeMeta = sessionMeta.get(msg.terminalId);
        if (closeMeta) {
          const sessionJsonPath = path.join(closeMeta.sessionDir, "session.json");
          try {
            const sjson = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
            if (sjson.type === "coordinator") break;
          } catch {}
        }
        ptyManager.kill(msg.terminalId);
        break;
      }

      case "terminal:list": {
        const folder = registry.resolve(msg.pathId);
        if (!folder) break;
        terminalRegistry.pruneStale(folder.path);
        const restorable = terminalRegistry.listRestorable(folder.path);
        // Backfill claudeSessionId for older entries that don't have it yet
        backfillClaudeSessionIds(folder.path, restorable);
        // Returns running + recently-exited persistent/coordinator entries.
        // The reconnect handler will re-spawn PTYs for any that are no longer alive.
        send(ws, { type: "terminal:list", pathId: msg.pathId, terminals: restorable });
        break;
      }

      case "terminal:reconnect": {
        let meta = sessionMeta.get(msg.terminalId);

        // If sessionMeta is missing (backend restart), rebuild from registry
        if (!meta) {
          for (const folder of registry.list()) {
            const entries = terminalRegistry.load(folder.path);
            const entry = entries.find(e => e.terminalId === msg.terminalId);
            if (entry) {
              meta = { folderPath: folder.path, sessionName: entry.sessionName, sessionDir: entry.sessionDir };
              sessionMeta.set(msg.terminalId, meta);
              break;
            }
          }
        }

        if (!meta) {
          send(ws, { type: "terminal:error", terminalId: msg.terminalId, message: "Terminal not found" });
          break;
        }

        const onExitReconnect = (terminalId: string, exitCode: number) => {
          const m = sessionMeta.get(terminalId);
          if (m) {
            finalizeSession(m.sessionDir, exitCode);
            refreshCostSummary(m.folderPath);
            updateActiveSession(m.folderPath, m.sessionName, "remove");
            terminalRegistry.markExited(m.folderPath, terminalId, exitCode);
            artifactWatcher.unwatch(path.join(m.sessionDir, "artifacts"));
            const sd = path.join(m.folderPath, "CoAgent_workspace", "_shared");
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
        };

        if (!ptyManager.has(msg.terminalId)) {
          // Backend was restarted — PTY is gone. Spawn a fresh shell and auto-resume the session.
          const entries = terminalRegistry.load(meta.folderPath);
          const entry = entries.find(e => e.terminalId === msg.terminalId);
          if (!entry) {
            send(ws, { type: "terminal:error", terminalId: msg.terminalId, message: "Terminal not found" });
            break;
          }

          const sharedDir = path.join(meta.folderPath, "CoAgent_workspace", "_shared");

          ptyManager.createWithId(
            msg.terminalId,
            entry.pathId,
            meta.sessionDir,
            entry.title || entry.sessionName,
            meta.sessionDir,
            (terminalId, data) => { send(ws, { type: "terminal:output", terminalId, data }); },
            onExitReconnect,
            {
              COAGENT_SHARED_DIR: sharedDir,
              COAGENT_SESSION_NAME: meta.sessionName,
              COAGENT_FOLDER_PATH: meta.folderPath,
              PATH: `${path.join(sharedDir, "bin")}:${process.env.PATH}`,
            }
          );

          terminalRegistry.update(meta.folderPath, msg.terminalId, { status: "running", pid: ptyManager["sessions"].get(msg.terminalId)?.pid ?? entry.pid });
          updateActiveSession(meta.folderPath, meta.sessionName, "add");

          // Re-watch artifacts
          artifactWatcher.watch(path.join(meta.sessionDir, "artifacts"), (files) => {
            send(ws, { type: "artifact:update", terminalId: msg.terminalId, files });
          });

          // Re-watch scratchpad
          const count = watchedDirCounts.get(sharedDir) ?? 0;
          if (count === 0) {
            // scratchpad already watched if another terminal is running; increment ref
          }
          watchedDirCounts.set(sharedDir, count + 1);

          send(ws, { type: "terminal:reconnected", terminalId: msg.terminalId, pathId: meta.folderPath, bufferedOutput: "" });

          // Auto-resume the Claude/Codex session
          const provider = entry.provider ?? "claude";
          if (provider === "codex") {
            setTimeout(() => { ptyManager.write(msg.terminalId, "codex\n"); }, 300);
          } else {
            // Use the stored Claude session UUID to bypass the interactive picker entirely.
            const uuid = entry.claudeSessionId;
            if (uuid) {
              setTimeout(() => {
                ptyManager.write(msg.terminalId, `claude --model haiku --resume ${uuid}\n`);
              }, 300);
              // Watch PTY output for "No conversation found" — if resume fails, start fresh
              const termId = msg.terminalId;
              const session = ptyManager["sessions"].get(termId);
              if (session) {
                let disposed = false;
                const disposable = session.process.onData((data: string) => {
                  if (disposed) return;
                  if (data.includes("No conversation found")) {
                    disposed = true;
                    disposable.dispose();
                    terminalRegistry.update(meta.folderPath, termId, { claudeSessionId: undefined });
                    setTimeout(() => { ptyManager.write(termId, "claude --model haiku\n"); }, 200);
                  }
                });
                // Always clean up after 6s
                setTimeout(() => { if (!disposed) { disposed = true; disposable.dispose(); } }, 6000);
              }
            } else {
              // No UUID — start fresh
              setTimeout(() => { ptyManager.write(msg.terminalId, "claude --model haiku\n"); }, 300);
            }
          }
          break;
        }

        const success = ptyManager.reattach(
          msg.terminalId,
          (terminalId, data) => { send(ws, { type: "terminal:output", terminalId, data }); },
          onExitReconnect
        );

        if (success) {
          // Re-attach artifact watcher to new WS connection
          artifactWatcher.unwatch(path.join(meta.sessionDir, "artifacts"));
          artifactWatcher.watch(path.join(meta.sessionDir, "artifacts"), (files) => {
            send(ws, { type: "artifact:update", terminalId: msg.terminalId, files });
          });

          const bufferedOutput = ptyManager.getBufferedOutput(msg.terminalId);
          send(ws, {
            type: "terminal:reconnected",
            terminalId: msg.terminalId,
            pathId: meta.folderPath,
            bufferedOutput,
          });
          // SessionStart hook: inject context on reconnect
          injectSessionContext(msg.terminalId, meta.sessionDir);
        }
        break;
      }

      case "terminal:promote": {
        const meta = sessionMeta.get(msg.terminalId);
        if (!meta) break;

        const promoteName = msg.role ?? meta.sessionName;
        const oldSessionDir = meta.sessionDir;
        const sessionsDir = path.join(meta.folderPath, "CoAgent_workspace", "sessions");
        const newSessionDir = path.join(sessionsDir, promoteName);

        // 1. Rename session folder if name changed
        if (promoteName !== meta.sessionName && !fs.existsSync(newSessionDir)) {
          try {
            fs.renameSync(oldSessionDir, newSessionDir);
          } catch {
            // Fall back: keep old dir
          }
        }

        const effectiveDir = fs.existsSync(newSessionDir) ? newSessionDir : oldSessionDir;
        const effectiveName = fs.existsSync(newSessionDir) ? promoteName : meta.sessionName;

        // 2. Copy notes.md → memory.md, reset notes.md
        const notesPath = path.join(effectiveDir, "notes.md");
        const memoryPath = path.join(effectiveDir, "memory.md");
        try {
          const notesContent = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";
          fs.writeFileSync(memoryPath, notesContent);
          fs.writeFileSync(notesPath, "");
        } catch {}

        // 3. Rewrite CLAUDE.md with full identity
        const sharedDir = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
        const allEntries = terminalRegistry.load(meta.folderPath);
        const coworkers = allEntries
          .filter(e => e.terminalId !== msg.terminalId && e.status === "running")
          .map(e => `- ${e.title || e.sessionName} (${e.role})`)
          .join("\n");

        fs.writeFileSync(path.join(effectiveDir, "CLAUDE.md"), `# ${promoteName}
You are a promoted agent in the CoAgent workspace.

## Identity
- **Name**: ${promoteName}
- **Role**: ${msg.role ?? "worker"}
- **Session**: ${effectiveName}
- **Status**: Promoted (persistent)

## Coworkers
${coworkers || "- No other active agents"}

## Memory
Your persistent memory is in \`memory.md\`. Update it with important context.
Shared team memory is in \`$COAGENT_SHARED_DIR/memory/shared.md\` — you can append to it.

## On startup
1. \`coagent context\` — project goals
2. \`coagent inbox\` — messages for you
3. \`coagent tasks\` — current task board
4. \`coagent sessions\` — active terminals
5. Read \`memory.md\` — your persistent memory

## Commands
\`\`\`bash
coagent send --to "recipient" --type blocker --msg "Message"
coagent memory --content "Learning" --type learning
coagent task start --id t1 --title "Task"
coagent task done --id t1 --result "Done"
\`\`\`
`);

        // 4. Update session.json
        const promoteJsonPath = path.join(effectiveDir, "session.json");
        try {
          const sjson = JSON.parse(fs.readFileSync(promoteJsonPath, "utf-8"));
          sjson.mode = "role";
          sjson.tag = promoteName;
          sjson.promoted = true;
          sjson.promotedAt = new Date().toISOString();
          fs.writeFileSync(promoteJsonPath, JSON.stringify(sjson, null, 2));
        } catch {}

        // 5. Update sessionMeta with new paths
        meta.sessionDir = effectiveDir;
        meta.sessionName = effectiveName;

        // 6. Update terminal registry
        terminalRegistry.update(meta.folderPath, msg.terminalId, {
          mode: "role",
          persistence: "persistent",
          promoted: true,
          sessionName: effectiveName,
          sessionDir: effectiveDir,
          ...(msg.role ? { tag: msg.role, title: msg.role } : {}),
        });

        // 7. Update active sessions in state.json
        updateActiveSession(meta.folderPath, meta.sessionName, "add");

        // 8. Notify coordinator via scratchpad
        const scratchpadPath = path.join(sharedDir, "scratchpad.jsonl");
        const promoMsg = JSON.stringify({
          ts: new Date().toISOString(),
          from: "system",
          to: "coordinator",
          tag: "promotion",
          msg: `Terminal promoted to "${promoteName}"`,
          msgType: "status_update",
        });
        try { fs.appendFileSync(scratchpadPath, promoMsg + "\n"); } catch {}

        // 9. Update PTY env vars
        ptyManager.write(msg.terminalId, `export COAGENT_SESSION_DIR="${effectiveDir}" COAGENT_SESSION_NAME="${effectiveName}"\n`);

        send(ws, {
          type: "terminal:promoted",
          terminalId: msg.terminalId,
          mode: "role",
          persistence: "persistent",
          tag: msg.role,
          newName: promoteName,
          newSessionName: effectiveName,
        });
        break;
      }

      case "terminal:update": {
        // Find which folder this terminal belongs to
        const meta = sessionMeta.get(msg.terminalId);
        if (meta) {
          const prevTitle = msg.title ? (() => {
            const entries = terminalRegistry.load(meta.folderPath);
            const entry = entries.find(e => e.terminalId === msg.terminalId);
            return entry?.title || "";
          })() : undefined;

          terminalRegistry.update(meta.folderPath, msg.terminalId, {
            x: msg.x,
            y: msg.y,
            width: msg.width,
            height: msg.height,
            ...(msg.title ? { title: msg.title } : {}),
          });

          // If title changed, notify the terminal and announce on scratchpad
          if (msg.title && prevTitle !== msg.title) {
            // Announce rename on scratchpad so other agents see it
            const sharedDir = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
            const scratchpadPath = path.join(sharedDir, "scratchpad.jsonl");
            const renameMsg = JSON.stringify({
              ts: new Date().toISOString(),
              from: "system",
              to: "*",
              tag: "rename",
              msg: `Terminal "${prevTitle || meta.sessionName}" is now "${msg.title}"`,
              msgType: "status_update",
            });
            try { fs.appendFileSync(scratchpadPath, renameMsg + "\n"); } catch {}
          }
        }
        break;
      }

      case "session:list": {
        const folder = registry.resolve(msg.pathId);
        if (!folder) break;
        const running = terminalRegistry.listRunning(folder.path);
        const sessions = scanSessionHistory(folder.path, running);
        send(ws, { type: "session:list", pathId: msg.pathId, sessions });
        break;
      }

      case "usage:cost_request": {
        const folder = registry.resolve(msg.pathId);
        if (folder) {
          // Build PID → sessionName map from terminal registry
          const allEntries = terminalRegistry.load(folder.path);
          const pidMap = new Map<number, string>();
          for (const entry of allEntries) {
            if (entry.pid && entry.sessionName) {
              pidMap.set(entry.pid, entry.sessionName);
            }
          }
          const summary = scanClaudeUsage(folder.path, pidMap);
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

      case "artifact:list": {
        const meta = sessionMeta.get(msg.terminalId);
        if (!meta) break;
        const artifactsDir = path.join(meta.sessionDir, "artifacts");
        try {
          const names = fs.readdirSync(artifactsDir).filter((n) => {
            if (n.startsWith(".")) return false;
            try { return !fs.statSync(path.join(artifactsDir, n)).isDirectory(); } catch { return false; }
          });
          const files: ArtifactFileInfo[] = names.map((name) => {
            const stat = fs.statSync(path.join(artifactsDir, name));
            return { name, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
          });
          send(ws, { type: "artifact:update", terminalId: msg.terminalId, files });
        } catch {
          send(ws, { type: "artifact:update", terminalId: msg.terminalId, files: [] });
        }
        break;
      }

      case "artifact:read": {
        const meta = sessionMeta.get(msg.terminalId);
        if (!meta) break;
        // Directory traversal protection
        if (msg.fileName.includes("..") || msg.fileName.includes("/")) break;
        // Try session artifacts dir first, fall back to project root
        let filePath = path.join(meta.sessionDir, "artifacts", msg.fileName);
        if (!fs.existsSync(filePath)) {
          const rootPath = path.join(meta.folderPath, msg.fileName);
          if (fs.existsSync(rootPath)) filePath = rootPath;
        }
        try {
          const stat = fs.statSync(filePath);
          const cap = 100 * 1024; // 100KB
          const fd = fs.openSync(filePath, "r");
          const buf = Buffer.alloc(Math.min(stat.size, cap));
          fs.readSync(fd, buf, 0, buf.length, 0);
          fs.closeSync(fd);
          let content = buf.toString("utf-8");
          if (stat.size > cap) content += "\n\n[truncated at 100KB]";
          send(ws, { type: "artifact:content", terminalId: msg.terminalId, fileName: msg.fileName, content });
        } catch {
          send(ws, { type: "artifact:content", terminalId: msg.terminalId, fileName: msg.fileName, content: "[error reading file]" });
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

// Periodic flush: deliver queued notifications to idle terminals
const notificationFlushTimer = setInterval(() => {
  for (const [tid, msgs] of pendingNotifications.entries()) {
    if (msgs.length === 0) continue;
    if (!ptyManager.has(tid)) { pendingNotifications.delete(tid); continue; }
    const lastOutput = ptyManager.getLastOutputTime(tid);
    if (Date.now() - lastOutput > 3000) {
      const summary = msgs.map(m => `[${m.msgType}] from ${m.from}: ${m.msg.slice(0, 80)}`).join("; ");
      const prompt = `You have ${msgs.length} new message(s): ${summary}. Run coagent inbox, read them, and act on each.\n`;
      ptyManager.write(tid, prompt);
      pendingNotifications.delete(tid);
    }
  }
}, 3000);

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  clearInterval(notificationFlushTimer);
  scratchpadWatcher.unwatchAll();
  artifactWatcher.unwatchAll();
  ptyManager.killAll();
  wss.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Terminal Canvas backend listening on ws://localhost:${PORT} (HTTP POST /usage for usage recording)`);
});
