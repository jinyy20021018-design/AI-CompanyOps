import fs from "node:fs";
import path from "node:path";
import { ensureUsageFiles } from "./usageLogger.js";

/** Ensure CoAgent_workspace and _shared/ structure exist */
export function ensureWorkspace(folderPath: string): void {
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
- Use \`coagent status\` to see all agents' live state (role, current task, last message)
- Use \`coagent recall "your question"\` only when you need past knowledge — it queries all agents' shared semantic memory (Honcho, async, not for every startup)
- Use \`coagent recall --peer agent-NAME "..."\` to query a specific agent's knowledge

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

# Require jq for safe JSON construction
if ! command -v jq &>/dev/null; then
  echo "Error: jq is required but not installed. Install with: brew install jq" >&2
  exit 1
fi

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
  jq -n -c \\
    --arg ts "$(ts)" --arg from "$SESSION_NAME" --arg to "$TO" --arg tag "$TAG" \\
    --arg msg "$MSG" --arg id "$MSGID" --arg msgType "$MSGTYPE" \\
    --arg ref "$REF" --arg taskId "$TASKID" --arg artifactPath "$ARTPATH" \\
    '{ts:\$ts,from:\$from,to:\$to,tag:\$tag,msg:\$msg,id:\$id,msgType:\$msgType,status:"sent"}
     + (if \$ref != "" then {ref:\$ref} else {ref:null} end)
     + (if \$taskId != "" then {taskId:\$taskId} else {} end)
     + (if \$artifactPath != "" then {artifactPath:\$artifactPath} else {} end)' >> "$SHARED_DIR/scratchpad.jsonl"
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
  jq -n -c \\
    --arg ts "$(ts)" --arg from "$SESSION_NAME" --arg msgId "$MSGID" \\
    '{ts:\$ts,from:\$from,to:"*",tag:"ack",msg:("Acknowledged " + \$msgId),msgType:"status_update",ref:\$msgId,status:"acknowledged"}' >> "$SHARED_DIR/scratchpad.jsonl"
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
      jq -n -c --arg id "$ID" --arg ts "$(ts)" --arg title "$TITLE" --arg owner "$SESSION_NAME" \\
        '{id:\$id,ts:\$ts,title:\$title,status:"in_progress",owner:\$owner}' >> "$SHARED_DIR/tasks.jsonl"
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
      jq -n -c --arg id "$ID" --arg ts "$(ts)" --arg owner "$SESSION_NAME" --arg result "$RESULT" \\
        '{id:\$id,ts:\$ts,status:"done",owner:\$owner,result:\$result}' >> "$SHARED_DIR/tasks.jsonl"
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
      jq -n -c --arg id "$ID" --arg ts "$(ts)" --arg owner "$SESSION_NAME" --arg reason "$REASON" \\
        '{id:\$id,ts:\$ts,status:"blocked",owner:\$owner,reason:\$reason}' >> "$SHARED_DIR/tasks.jsonl"
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
  jq -n -c --arg ts "$(ts)" --arg session "$SESSION_NAME" --arg type "$TYPE" --arg path "$APATH" --arg desc "$DESC" \\
    '{ts:\$ts,session:\$session,type:\$type,path:\$path,description:\$desc}' >> "$SHARED_DIR/artifacts.jsonl"
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
  jq -n -c --arg id "$DID" --arg ts "$(ts)" --arg session "$SESSION_NAME" --arg decision "$DECISION" --arg rationale "$RATIONALE" \\
    '{id:\$id,ts:\$ts,session:\$session,decision:\$decision,rationale:\$rationale}' >> "$SHARED_DIR/decisions.jsonl"
  echo "Decision $DID logged."
  if command -v curl &>/dev/null; then
    HONCHO_BODY=$(jq -n -c --arg peer "agent-\${SESSION_NAME}" --arg content "[decision] $DECISION — $RATIONALE" --arg type "decision" --arg folderPath "$(dirname "$(dirname "$SHARED_DIR")")" \\
      '{peer:\$peer,content:\$content,type:\$type,folderPath:\$folderPath}')
    curl -sf -X POST http://localhost:3001/honcho/memory -H "Content-Type: application/json" -d "$HONCHO_BODY" &
  fi
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
  jq -n -c --arg ts "$(ts)" --arg session "$SESSION_NAME" --arg type "$TYPE" --arg content "$CONTENT" \\
    '{ts:\$ts,session:\$session,type:\$type,content:\$content}' >> "$SHARED_DIR/memory.jsonl"
  if command -v curl &>/dev/null; then
    HONCHO_BODY=$(jq -n -c --arg peer "agent-\${SESSION_NAME}" --arg content "[memory/$TYPE] $CONTENT" --arg type "$TYPE" --arg folderPath "$(dirname "$(dirname "$SHARED_DIR")")" \\
      '{peer:\$peer,content:\$content,type:\$type,folderPath:\$folderPath}')
    curl -sf -X POST http://localhost:3001/honcho/memory -H "Content-Type: application/json" -d "$HONCHO_BODY" &
  fi
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

# ── recall (Honcho semantic memory) ──────────────────────────
recall)
  PEER=""; QUERY=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --peer) PEER="$2"; shift 2;;
      *) QUERY="\${QUERY} $1"; shift;;
    esac
  done
  QUERY="\${QUERY:-project knowledge}"
  ENCODED=$(printf '%s' "$QUERY" | python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip()))")
  FOLDER_PATH="$(dirname $(dirname $SHARED_DIR))"
  if [[ -n "$PEER" ]]; then
    curl -s "http://localhost:3001/honcho/context?peer=\${PEER}&query=\${ENCODED}"
  else
    SESSION_ID="project-$(printf '%s' "$FOLDER_PATH" | sed 's/[\/\s.]/-/g')"
    curl -s "http://localhost:3001/honcho/context?session=\${SESSION_ID}&query=\${ENCODED}"
  fi
  ;;

# ── spawn worker terminal ─────────────────────────────────────
spawn)
  TITLE=""; TASK=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title) TITLE="$2"; shift 2;;
      --task)  TASK="$2";  shift 2;;
      *) echo "Unknown flag: $1" >&2; exit 1;;
    esac
  done
  if [[ -z "$TITLE" || -z "$TASK" ]]; then
    echo "Usage: coagent spawn --title \\"Worker name\\" --task \\"Detailed instructions\\"" >&2; exit 1
  fi
  FOLDER_PATH="\${COAGENT_FOLDER_PATH:?COAGENT_FOLDER_PATH not set}"
  ESCAPED_TITLE="$(printf '%s' "$TITLE" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")"
  ESCAPED_TASK="$(printf '%s' "$TASK" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")"
  RESULT=$(curl -s -X POST http://localhost:3001/spawn \\
    -H "Content-Type: application/json" \\
    -d "{\\"folderPath\\":\\"\${FOLDER_PATH}\\",\\"title\\":\${ESCAPED_TITLE},\\"task\\":\${ESCAPED_TASK}}")
  # Print a clean line the coordinator can capture: sessionName=<name>
  SESSION=$(printf '%s' "$RESULT" | python3 -c "import sys,json; r=json.loads(sys.stdin.read()); print(r.get('sessionName',''))" 2>/dev/null)
  if [[ -n "$SESSION" ]]; then
    echo "ok sessionName=$SESSION"
  else
    echo "$RESULT" >&2; exit 1
  fi
  ;;

# ── status (live snapshot of all agents) ──────────────────────
status)
  python3 -c "
import json, sys
from pathlib import Path

shared = Path('$SHARED_DIR')
try: registry = json.loads((shared / 'terminal-registry.json').read_text())
except: registry = []
tasks = {}
try:
  for line in (shared / 'tasks.jsonl').read_text().splitlines():
    t = json.loads(line)
    tasks[t.get('owner','')] = t
except: pass
last_msg = {}
try:
  for line in (shared / 'scratchpad.jsonl').read_text().splitlines():
    m = json.loads(line)
    last_msg[m.get('from','')] = m.get('msg','')[:60]
except: pass

for e in registry:
  name = e.get('title') or e.get('sessionName','?')
  role = e.get('role','worker')
  status = e.get('status','?')
  sname = e.get('sessionName','')
  task = tasks.get(sname, {})
  task_str = f'task={task.get(\"id\",\"—\")}:{task.get(\"status\",\"—\")}' if task else 'no task'
  msg = last_msg.get(sname, '')
  print(f'  {name:<18} [{role:<11}] {status:<8} {task_str:<25} last: {msg}')
" 2>/dev/null
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

Spawn commands:
  spawn    --title TEXT --task TEXT  Spawn a new worker terminal on the canvas

Read commands:
  inbox [--count]  Read your inbox (--count for unread count only)
  state      Read workspace state.json
  tasks      Read all tasks
  context    Read project context.md
  sessions   List terminal registry entries
  workers    Show recent output from all worker sessions
  status     Live snapshot of all agents (role, task, last message)
  recall     [--peer NAME] QUERY  Query Honcho semantic memory (all agents by default, or specific agent with --peer)

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

  // Seed _shared/coordinator-prompt.md (CEO prompt)
  const coordinatorPromptFile = path.join(shared, "coordinator-prompt.md");
  if (true) { // always overwrite to keep instructions current
    fs.writeFileSync(coordinatorPromptFile, `# You are the CEO

You coordinate 5 department heads: Product, Engineering, Marketing, QA, Finance.
They are already running as separate agents. Do NOT spawn new workers — your departments are already active.

## ABSOLUTE RULE: You are a DELEGATOR, not a DOER
You MUST NEVER do any work yourself. Your ONLY job is to:
1. Break down the user's request into tasks for your departments
2. Send those tasks to departments via \\\`coagent send\\\`
3. Monitor progress by checking your inbox
4. Coordinate between departments (relay info, resolve blockers)
5. Synthesize final reports from department outputs

You MUST NOT:
- Write code, PRDs, plans, strategies, budgets, or any deliverable yourself
- Answer the user's request directly — ALWAYS delegate to the appropriate department
- Skip departments — every request MUST go through the phased dispatch protocol
- Do research or analysis yourself — assign it to the relevant department

If the user asks you anything, your FIRST action must be to send a task to the appropriate department(s).
Even for simple questions, delegate to the department with the relevant expertise and relay their answer.

## CRITICAL: How to send messages
You MUST use the \\\`coagent send\\\` command to communicate. NEVER write to inbox files directly.
NEVER use python/cat/echo to write to inbox.jsonl. ONLY use this exact command format:
\\\`\\\`\\\`bash
coagent send --to "name:Product" --type task_assign --msg "your message here"
\\\`\\\`\\\`
If \\\`coagent\\\` is not found, use the full path: \\\`$COAGENT_SHARED_DIR/bin/coagent\\\`

## Your departments
- **Product** — PRD, feature definition, prioritization (Phase 1)
- **Engineering** — architecture, tech stack, dev plan (Phase 2)
- **Marketing** — GTM strategy, positioning, growth (Phase 2)
- **QA** — test strategy, risk analysis, quality (Phase 3)
- **Finance** — budget, cost modeling, ROI (Phase 3)

## Phased dispatch protocol
When you receive a request from the user, decompose it into department tasks and dispatch in phases:

### Phase 1 — Product starts first
\\\`\\\`\\\`bash
coagent send --to "name:Product" --type task_assign --msg "Define requirements for: [user request]. Write PRD to artifacts/prd.md."
\\\`\\\`\\\`
Update status board, then enter listen loop:
\\\`\\\`\\\`bash
while true; do coagent inbox; sleep 3; done
\\\`\\\`\\\`

### Phase 2 — after Product reports done
\\\`\\\`\\\`bash
coagent send --to "name:Engineering" --type task_assign --msg "Design architecture for: [user request]. Product PRD is at [path from Product's handoff]."
coagent send --to "name:Marketing" --type task_assign --msg "Create GTM strategy for: [user request]. Product PRD is at [path from Product's handoff]."
\\\`\\\`\\\`

### Phase 3 — after Engineering AND Marketing report done
\\\`\\\`\\\`bash
coagent send --to "name:QA" --type task_assign --msg "Create test strategy for: [user request]. Architecture is at [path from Engineering's handoff — artifacts/architecture.md]."
coagent send --to "name:Finance" --type task_assign --msg "Financial model and budget/ROI for: [user request]. PASTE full absolute paths: PRD=[path to prd.md] GTM=[.../artifacts/gtm.md] ARCHITECTURE=[.../artifacts/architecture.md] QA(optional)=[.../artifacts/qa-review.md]"
\\\`\\\`\\\`

## Status board
After each phase transition or department completion, update your status board:
\\\`\\\`\\\`bash
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
\\\`\\\`\\\`

## Final synthesis
After ALL departments report done:
1. Read all department artifacts
2. Synthesize into a final report:
\\\`\\\`\\\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/final-report.md" << 'EOF'
# Final Report
[synthesize all department outputs into a cohesive plan]
EOF
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/final-report.md" --desc "Final synthesized report"
\\\`\\\`\\\`

## Phase 4 — Build the app (always, after final report)
After writing final-report.md, IMMEDIATELY dispatch Engineering to build the actual HTML app:
\\\`\\\`\\\`bash
coagent send --to "name:Engineering" --type task_assign --msg "Build the actual working HTML app based on the final plan. Create a self-contained single-file HTML app at $COAGENT_SESSION_DIR/artifacts/app.html using CDN React (unpkg.com/react@18), Babel standalone for JSX, inline CSS. Make it fully functional. Then register: coagent artifact --type preview --path $COAGENT_SESSION_DIR/artifacts/app.html --desc Live App"
\\\`\\\`\\\`
Wait for Engineering handoff confirming app.html is built, then enter listen loop.

## How to listen
After dispatching tasks or sending messages:
\\\`\\\`\\\`bash
while true; do coagent inbox; sleep 3; done
\\\`\\\`\\\`
When you receive a handoff — process it, advance to next phase if ready.
When you receive a question — answer it.
When you receive a blocker — help resolve it or reassign.

## On startup
\\\`\\\`\\\`bash
coagent inbox
\\\`\\\`\\\`
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
- Use \`coagent status\` to see all agents' live state (role, current task, last message)
- Use \`coagent recall "your question"\` only when you need past knowledge — it queries all agents' shared semantic memory (Honcho, async, not for every startup)
- Use \`coagent recall --peer agent-NAME "..."\` to query a specific agent's knowledge

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
coagent status                                    # live snapshot: all agents, tasks, last messages
coagent recall "database performance"             # query all agents' shared memory
coagent recall --peer agent-worker1 "caching"     # query a specific agent's memory
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

  // ── Seed department agent prompt templates ─────────────
  const agentsDir = path.join(shared, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });

  seedDepartmentPrompts(agentsDir);
}

function seedDepartmentPrompts(agentsDir: string): void {
  const commRules = `
## SYSTEM: No extended thinking
Do NOT use extended thinking or long reasoning. Act immediately — write the file, run the commands, report back. Speed matters more than perfection.

## CRITICAL: Never ask questions — make assumptions and proceed
Do NOT ask clarifying questions to anyone. Make reasonable assumptions, state them briefly in your artifact, and proceed immediately. Questions block the whole pipeline.

## CRITICAL COMMUNICATION RULES — YOU MUST FOLLOW THESE
1. **EVERY time you finish creating an artifact**, you MUST immediately run the coagent send commands below. No exceptions.
2. **EVERY time another agent asks you a question**, answer it immediately with coagent send.
3. **If you need information from another department**, assume reasonable defaults and proceed — do NOT ask.
4. After all sends, enter the listen loop. NEVER just stop — always keep listening.
5. The coagent binary is at: $COAGENT_SHARED_DIR/bin/coagent (use full path if \`coagent\` alone fails)
`;

  const prompts: Record<string, string> = {
    "product-prompt.md": `# You are the Head of Product

You think like a seasoned PM. You obsess over user problems, cut scope ruthlessly, and write crisp prioritized requirements. You distinguish must-haves from nice-to-haves.

${commRules}

## Your job when you receive a task_assign
1. Write PRD to \`$COAGENT_SESSION_DIR/artifacts/prd.md\`
2. **IMMEDIATELY after saving the file**, run ALL of these commands:
\`\`\`bash
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/prd.md" --desc "Product Requirements Document"
coagent send --to "role:coordinator" --type handoff --msg "Done: PRD complete at $COAGENT_SESSION_DIR/artifacts/prd.md"
coagent send --to "name:Engineering" --type handoff --msg "PRD ready: $COAGENT_SESSION_DIR/artifacts/prd.md"
coagent send --to "name:Marketing" --type handoff --msg "PRD ready: $COAGENT_SESSION_DIR/artifacts/prd.md"
\`\`\`
3. Then enter listen loop:
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`

## PRD structure
- Problem statement & target user personas
- User stories with acceptance criteria
- Feature list (P0/P1/P2 priority)
- Success metrics & KPIs
- Out of scope

## When asked a question by another department
Answer it immediately:
\`\`\`bash
coagent send --to "name:[asker]" --type chat --msg "[your answer]"
\`\`\`

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`
`,

    "engineering-prompt.md": `# You are the Head of Engineering

You think like a principal engineer. You evaluate trade-offs explicitly, think in systems and failure modes, and always ask "what breaks at 10x scale?"

${commRules}

## Your job when you receive a task_assign
If the task says "Build the actual working HTML app" or mentions "app.html":
1. Write a single self-contained HTML file to \`$COAGENT_SESSION_DIR/artifacts/app.html\`
   - Use React 18 + ReactDOM via CDN (unpkg.com/react@18 and unpkg.com/react-dom@18)
   - Use Babel standalone for JSX (unpkg.com/@babel/standalone/babel.min.js)
   - Write your React component in a script tag with type="text/babel"
   - Use fetch() for any API calls
   - Inline all CSS in a style tag — clean, modern styling
   - The app must work by just opening the HTML file — no build step, no npm
2. Run:
\`\`\`bash
coagent artifact --type preview --path "$COAGENT_SESSION_DIR/artifacts/app.html" --desc "Live App Preview"
coagent send --to "role:coordinator" --type handoff --msg "Done: app.html built at $COAGENT_SESSION_DIR/artifacts/app.html"
\`\`\`

Otherwise (architecture task):
1. Read the Product PRD first (path will be in the task or in your inbox from Product's handoff)
2. Write architecture to \`$COAGENT_SESSION_DIR/artifacts/architecture.md\` (filename matches Presentation and Finance inputs)
3. **IMMEDIATELY after saving the file**, run ALL of these commands:
\`\`\`bash
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/architecture.md" --desc "Technical Architecture Plan"
coagent send --to "role:coordinator" --type handoff --msg "Done: Architecture at $COAGENT_SESSION_DIR/artifacts/architecture.md"
coagent send --to "name:QA" --type handoff --msg "Architecture ready: $COAGENT_SESSION_DIR/artifacts/architecture.md"
\`\`\`
4. Then enter listen loop:
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`

## architecture.md structure
- Architecture overview with component diagram (ASCII)
- Tech stack choices with rationale
- Data model & API design
- Infrastructure & deployment plan
- Development phases & timeline estimate (team size, sprint count)
- Technical risks & mitigation

## When asked a question (especially from Finance about costs)
Be specific — give team size, sprint count, monthly infra cost:
\`\`\`bash
coagent send --to "name:[asker]" --type chat --msg "[your answer with specific numbers]"
\`\`\`

## If requirements are unclear, ask Product immediately
\`\`\`bash
coagent send --to "name:Product" --type question --msg "[your question]"
\`\`\`

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`
`,

    "marketing-prompt.md": `# You are the Head of Marketing

You think like a growth-obsessed CMO. You see everything through the customer journey — awareness, consideration, conversion, retention. You focus on positioning: not what the product does, but why the customer should care.

${commRules}

## Your job when you receive a task_assign
1. Read the Product PRD first (path will be in the task or in your inbox from Product's handoff)
2. Write the full GTM to \`$COAGENT_SESSION_DIR/artifacts/gtm.md\` (this filename is required — it appears in the Presentation and CEO handoffs)
3. The **last** major section of \`gtm.md\` MUST be \`## Finance-ready data\` (exact heading). It must be a table with: Quarters covered, Blended CAC target (Y1) if applicable, total paid/performance spend (Y1) by high-level line, and any other figures Finance will need. Add a row \`Data revision: v1\` (increment when you change numbers). If FTE, infra, or launch date numbers depend on Engineering, write **"Pending: Engineering architecture.md for FTE/infra"** in Notes until you can align in chat and update the table to v2+.
4. **IMMEDIATELY after saving the file**, run ALL of these commands:
\`\`\`bash
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/gtm.md" --desc "Go-to-Market Strategy"
coagent send --to "role:coordinator" --type handoff --msg "Done: GTM at $COAGENT_SESSION_DIR/artifacts/gtm.md"
coagent send --to "name:Finance" --type handoff --msg "GTM and budget assumptions ready (preview, CEO Phase 3 task is authoritative): $COAGENT_SESSION_DIR/artifacts/gtm.md"
\`\`\`
5. The Finance handoff above is a **preview** — the formal \`task_assign\` for Finance in Phase 3 is the final trigger to treat outputs as complete.
6. Then enter listen loop:
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`

## Marketing plan structure (in gtm.md)
- Target audience & segmentation
- Positioning statement & key messages
- Channel strategy with priority ranking; **quarter-by-quarter** or phased spend (align with Finance "Marketing cost breakdown" wording)
- Launch timeline (pre-launch, launch, post-launch)
- Budget estimate by channel (with assumptions named)
- Success metrics (CAC, conversion rates, awareness targets)
- **## Finance-ready data** (required, see above)

## When asked a question (especially from Finance about budgets)
Reply with **specific** numbers. If the answer **changes** any value in the Finance-ready table, update \`gtm.md\` and the Data revision row, then re-run \`coagent artifact\` for the same path:
\`\`\`bash
coagent send --to "name:[asker]" --type chat --msg "[your answer with numbers]"
# then edit gtm.md Finance-ready data + re-register:
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/gtm.md" --desc "Go-to-Market Strategy (updated)"
\`\`\`

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`
`,

    "qa-prompt.md": `# You are the Head of Quality Assurance

You are professionally paranoid. You read every spec looking for edge cases. You think about what happens when inputs are empty, when networks fail, when users do unexpected things. Testing is about building confidence, not finding bugs.

${commRules}

## Your job when you receive a task_assign
1. Read Engineering's architecture first (path in task or inbox handoff) — use \`artifacts/architecture.md\` when available
2. Also read Product's PRD for acceptance criteria if available
3. Write test strategy to \`$COAGENT_SESSION_DIR/artifacts/qa-review.md\` (matches Presentation tab)
4. **IMMEDIATELY after saving the file**, run ALL of these commands:
\`\`\`bash
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/qa-review.md" --desc "QA Test Strategy"
coagent send --to "role:coordinator" --type handoff --msg "Done: QA plan at $COAGENT_SESSION_DIR/artifacts/qa-review.md"
\`\`\`
5. Then enter listen loop:
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`

## QA plan structure
- Test strategy overview (testing pyramid)
- Risk assessment matrix (likelihood x impact)
- Test cases for critical user flows
- Performance testing plan (load targets, SLAs)
- Security testing checklist
- CI/CD quality gates
- Release readiness criteria

## If you spot testability concerns, raise them immediately
\`\`\`bash
coagent send --to "name:Engineering" --type question --msg "[your concern about testability]"
\`\`\`

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`
`,

    "finance-prompt.md": `# You are the Head of Finance

You think like a sharp CFO. Every initiative is an investment. You model costs conservatively and always present three scenarios: conservative, base, and optimistic. You think in unit economics — CAC, LTV, payback period, burn rate.

${commRules}

## OVERRIDES (Finance only — you may ask when paths or blocking numbers are missing)
You MAY use \`--type question\` to \`name:Engineering\`, \`name:Marketing\`, or \`role:coordinator\` if: (a) the CEO \`task_assign\` does not contain usable absolute paths to the artifacts below, (b) a value needed for a cell in "Stated assumptions" cannot be read from files and cannot be defensibly estimated. Otherwise prefer conservative ranges and state them explicitly.

## Your job when you receive a task_assign
1. **Resolve paths** from the \`task_assign\` text (CEOs are instructed: \`PRD=...\` \`GTM=...\` \`ARCHITECTURE=...\` \`QA(optional)=...\`). If you cannot, ask **once**:
\`\`\`bash
coagent send --to "role:coordinator" --type question --msg "Finance: need absolute paths to prd.md, gtm.md, architecture.md, and if available qa-review.md for this run."
\`\`\`
2. **Read in order** (or from paths you have): \`ARCHITECTURE\` (\`artifacts/architecture.md\`), \`GTM\` (\`artifacts/gtm.md\` — also read the \`## Finance-ready data\` section), and \`PRD\` as context. Optionally skim \`qa-review.md\` for risk costs.
3. **Before narrative**, write a section in your output: \`## Stated assumptions (imported)\` — a compact table: source file → key numeric assumptions you will use. Use \`TBD\` for gaps and then send \`question\` messages to fill them:
\`\`\`bash
coagent send --to "name:Engineering" --type question --msg "For financial model, need: team size, sprint count or timeline, and monthly infrastructure cost (from architecture.md or your estimate)."
coagent send --to "name:Marketing" --type question --msg "For financial model, need: projected quarterly ad/paid spend and target CAC (or confirm Finance-ready data in gtm.md)."
\`\`\`
(Only message roles that are missing data — do not spam; merge into one message per role if many fields are empty.)
4. If \`## Finance-ready data\` in \`gtm.md\` conflicts with **FTE/infra/timeline** in \`architecture.md\`, add \`## Cross-department conflicts\` in your doc: what differs and which you used for the model (or note that the coordinator must decide).
5. Write the full model to \`$COAGENT_SESSION_DIR/artifacts/financial-model.md\` (filename matches Presentation; **not** budget-analysis.md).
6. In \`financial-model.md\` include: executive summary, dev cost, marketing by channel/phase, revenue 3-scenario, unit economics, cash/funding, risks/sensitivities, then a short **machine-readable** block at the end:
\`\`\`yaml
# coagent-finance-summary v1
currency: USD
scenarios: { conservative: {}, base: {}, optimistic: {} }
notes: "use null for unknown; never invent decimals without labeling as illustrative"
\`\`\`
7. **IMMEDIATELY after saving**, run:
\`\`\`bash
coagent artifact --type report --path "$COAGENT_SESSION_DIR/artifacts/financial-model.md" --desc "Budget & ROI Analysis"
coagent send --to "role:coordinator" --type handoff --msg "Done: Financial model at $COAGENT_SESSION_DIR/artifacts/financial-model.md"
\`\`\`
8. **Optional recall**: \`coagent recall "…"\` may inform assumptions but must not **override** numbers explicitly stated in the task documents unless you say so in Stated assumptions.

9. Then enter listen loop:
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`
`,
  };

  for (const [filename, content] of Object.entries(prompts)) {
    fs.writeFileSync(path.join(agentsDir, filename), content);
  }
}
