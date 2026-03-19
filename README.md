# Terminal Canvas — CoAgent Workspace UI

A multi-agent terminal management UI. Runs a WebSocket backend that manages PTY sessions and a React frontend that renders them as floating windows on a zoomable canvas.

---

## Starting the Services

```bash
# From the repo root — starts both backend and frontend with hot reload
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend WebSocket**: ws://localhost:3001
- **Backend HTTP** (usage recording): http://localhost:3001/usage

To run them separately:
```bash
npm run dev:backend   # backend only
npm run dev:frontend  # frontend only
```

If ports are already in use (e.g. after a crash):
```bash
lsof -ti :3001 | xargs kill -9
lsof -ti :5173 | xargs kill -9
npm run dev
```

---

## Repository Structure

```
cli2/
├── package.json              # Root workspace (npm workspaces)
├── folders.json              # Persisted list of added project folders
├── backend/
│   └── src/
│       ├── index.ts          # Main WebSocket server + all message handlers
│       ├── protocol.ts       # Shared TypeScript types (ClientMessage / ServerMessage)
│       ├── ptyManager.ts     # node-pty session lifecycle (create, reattach, kill)
│       ├── terminalRegistry.ts  # Persists terminal state to terminal-registry.json
│       ├── folderRegistry.ts # Manages added project folders
│       ├── artifactWatcher.ts   # fs.watch on session artifacts/ dirs
│       ├── scratchpadWatcher.ts # Watches _shared/scratchpad.jsonl for inter-agent messages
│       ├── usageLogger.ts    # Per-session token/cost event recording
│       └── usageParser.ts    # Scans ~/.claude/projects/ for token usage summaries
└── frontend/
    └── src/
        ├── App.tsx           # Root component — WebSocket client, all message handling, state
        ├── types.ts          # Frontend TypeScript types
        ├── index.css         # All styles
        ├── components/
        │   ├── TerminalCanvas.tsx   # Zoomable/pannable canvas; exposes centerOn() via ref
        │   ├── TerminalWindow.tsx   # Floating window chrome (drag, resize, artifact pills)
        │   ├── TerminalPane.tsx     # xterm.js instance (input, output, paste)
        │   ├── ArtifactViewer.tsx   # Floating artifact file viewer (tabbed)
        │   ├── FocusView.tsx        # Structured mode: terminal + artifact side-by-side (2:1)
        │   ├── ProjectSidebar.tsx   # Left sidebar: folder list + terminal rows
        │   ├── WorkspaceHeader.tsx  # Top bar: folder tabs + token cost display
        │   ├── CoordinatorBar.tsx   # Coordinator status strip
        │   ├── TopNav.tsx           # Top navigation
        │   ├── SettingsPanel.tsx    # Folder preset settings (provider, mode)
        │   ├── MessageBar.tsx       # Per-terminal message feed
        │   ├── AgentCard.tsx        # Agent card in overview grid
        │   ├── AgentChip.tsx        # Small agent status chip
        │   ├── OverviewGrid.tsx     # Grid view of all agents
        │   └── SpawnMenu.tsx        # Terminal spawn options menu
        └── utils/
            └── agentStatus.ts      # Agent status helpers
```

---

## Workspace File Layout (per project folder)

When a folder is added, the backend creates:

```
<project-folder>/
└── CoAgent_workspace/
    ├── CLAUDE.md                  # Workspace-level instructions (read by all agents)
    ├── _shared/
    │   ├── terminal-registry.json # Persisted terminal state (survives backend restarts)
    │   ├── scratchpad.jsonl       # Inter-agent message bus
    │   ├── artifacts.jsonl        # Registered artifact metadata
    │   ├── tasks.jsonl            # Task board
    │   ├── decisions.jsonl        # Logged decisions
    │   ├── memory/
    │   │   └── shared.md          # Team-wide persistent memory
    │   └── bin/
    │       └── coagent            # CLI tool injected into each agent's PATH
    └── sessions/
        └── <session-name>/        # One dir per terminal session
            ├── CLAUDE.md          # Agent-specific instructions
            ├── session.json       # Session metadata
            ├── notes.md           # Agent scratchpad
            ├── memory.md          # Agent persistent memory (on promotion)
            ├── inbox.jsonl        # Messages delivered to this agent
            ├── output.jsonl       # Full PTY output log (JSONL)
            └── artifacts/         # ← Files saved here appear as pills in the UI
```

**Important**: agents must save output files to `$COAGENT_SESSION_DIR/artifacts/` for them to appear as clickable artifact pills in the terminal window.

---

## Key Design Decisions

### Worker CWD = sessionDir
All terminals (coordinator and workers) run from their own `sessionDir`. This means:
- Relative paths like `artifacts/file.md` land in the watched directory automatically
- Claude stores conversation history in a unique `~/.claude/projects/` dir per worker → memory is isolated
- Workers access the project via `$COAGENT_FOLDER_PATH` env var

### Session Resume
On backend restart, persistent/coordinator terminals are restored from `terminal-registry.json`. Each terminal's Claude session UUID is captured at creation time (by snapshotting `~/.claude/projects/<encoded-sessionDir>/` before and after spawn) and stored in the registry. On reconnect, `claude --resume <uuid>` is sent automatically. If the UUID is stale/invalid, the "No conversation found" error is detected and a fresh `claude --model haiku` session is started instead.

### Artifact Display
- Backend watches `sessionDir/artifacts/` with `fs.watch` and sends `artifact:update` to the frontend whenever files change
- Frontend shows artifact pills at the bottom of each terminal window
- Clicking a pill opens the file in a floating viewer (canvas mode) or side panel (focus/structured mode)
- `coagent artifact --path FILE --desc TEXT` copies the file into `$COAGENT_SESSION_DIR/artifacts/` and registers it, so files saved anywhere can be surfaced in the UI

### Claude Project Dir Encoding
Claude encodes cwd paths by replacing `/`, `_`, spaces, and `.` with `-`. This is used in `encodeClaudeProjectDir()` in `backend/src/index.ts` for session UUID capture and in `cwdToClaudeProjectDir()` in `usageParser.ts` for token cost scanning.

---

## WebSocket Protocol

All messages are JSON. See `backend/src/protocol.ts` for the full type definitions.

Key client → server messages:
| Message | Description |
|---|---|
| `folder:add` | Add a project folder |
| `terminal:create` | Spawn a new PTY session |
| `terminal:reconnect` | Reattach to an existing session |
| `terminal:input` | Send keystrokes to PTY |
| `terminal:resize` | Resize PTY |
| `terminal:promote` | Promote worker to persistent named agent |
| `artifact:list` | Request artifact file list for a terminal |
| `artifact:read` | Read artifact file content |

Key server → client messages:
| Message | Description |
|---|---|
| `terminal:list` | List of restorable terminals for a folder |
| `terminal:created` | New terminal spawned |
| `terminal:output` | PTY output data |
| `terminal:reconnected` | Reattach confirmed + buffered output |
| `terminal:exit` | PTY process exited |
| `artifact:update` | Updated file list for a terminal |
| `artifact:content` | File content response |
| `usage:cost_summary` | Token usage and cost for a folder |
