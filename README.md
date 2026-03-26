# CoAgent

**Multi-agent terminal canvas with semantic memory.**

Orchestrate multiple Claude agents in parallel from a visual canvas. Each agent runs in its own terminal, communicates via a shared message bus, and builds long-term memory through Honcho — so knowledge from one project carries over to the next.

## Highlights

- **Visual multi-agent orchestration** — drag, resize, and manage multiple Claude terminals on an infinite canvas or structured grid
- **Coordinator + worker architecture** — a coordinator dispatches tasks to worker agents, reviews their output, and synthesizes results
- **Semantic memory via Honcho** — every agent interaction is processed into searchable observations; agents can recall knowledge across sessions and projects
- **Cross-project knowledge transfer** — learnings from project A are automatically available in project B
- **Real-time agent status** — green (working), grey (idle), pulsing red (needs your input) at a glance
- **Built-in file browser** — search and preview all agent artifacts from a single panel
- **One command startup** — `coagent` boots 6 services and opens the UI

## Quick Start

Prerequisites: [Node.js](https://nodejs.org/) (v20+), [Docker Desktop](https://www.docker.com/products/docker-desktop/), [Claude Code](https://claude.ai/code) (logged in)

```bash
# Clone both repos as siblings
git clone <repo-url> coagent
git clone https://github.com/plastic-labs/honcho.git honcho

# Start
cd coagent
./bin/coagent-cli
```

If Honcho is in a different location, set the path:
```bash
export COAGENT_HONCHO_DIR="/path/to/honcho"
./bin/coagent-cli
```

On first run, the CLI will:
1. Install Node.js dependencies
2. Install Python dependencies (via uv)
3. Start PostgreSQL + Redis (Docker)
4. Run database migrations
5. Extract your Claude Code OAuth token for LLM access
6. Start the Honcho memory server + deriver worker
7. Start the Terminal Canvas frontend + backend
8. Open http://localhost:5173 in your browser

**One manual step:** You need a free Google Gemini API key for embeddings.
Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (no credit card), then add it to `../honcho/.env`:

```
LLM_GEMINI_API_KEY=your-key-here
```

### Set up the alias (optional)

```bash
echo 'alias coagent="/path/to/cli2/bin/coagent-cli"' >> ~/.zshrc
source ~/.zshrc
```

Then just: `coagent` from anywhere.

## Commands

```
coagent              Start all services (default)
coagent stop         Stop all services
coagent status       Show service health
coagent restart      Stop then start
coagent logs         Tail all service logs
coagent open         Open the UI in browser
coagent help         Show usage
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (React + Vite)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Canvas   │  │ Overview │  │ Focus    │  │ File       │  │
│  │ Mode     │  │ Grid     │  │ View     │  │ Browser    │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│              Backend (Node.js + TypeScript)                   │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │ PTY        │  │ Message      │  │ Honcho Integration  │  │
│  │ Manager    │  │ Routing      │  │ (memory recording)  │  │
│  └────────────┘  └──────────────┘  └──────────┬──────────┘  │
│  ┌────────────┐  ┌──────────────┐             │              │
│  │ Terminal   │  │ Session      │             │              │
│  │ Registry   │  │ Lifecycle    │             │              │
│  └────────────┘  └──────────────┘             │              │
└───────────────────────────────────────────────┼──────────────┘
                                                │ HTTP
┌───────────────────────────────────────────────▼──────────────┐
│                  Honcho Memory Server (Python)                │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌───────────────┐  │
│  │ API     │  │ Deriver  │  │ Dreamer │  │ Dialectic     │  │
│  │ (REST)  │  │ (observe)│  │ (merge) │  │ (query)       │  │
│  └────┬────┘  └────┬─────┘  └────┬────┘  └───────────────┘  │
│       │            │             │                            │
│  ┌────▼────────────▼─────────────▼────┐  ┌────────────────┐  │
│  │  PostgreSQL + pgvector             │  │  Redis (cache)  │  │
│  │  (messages, observations, vectors) │  │                 │  │
│  └────────────────────────────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Project Structure

```
cli2/
├── bin/
│   └── coagent-cli              # CLI — starts/stops all services
├── backend/
│   └── src/
│       ├── index.ts             # HTTP + WebSocket server, handler dispatch
│       ├── workspace.ts         # Workspace scaffolding (coagent CLI, templates)
│       ├── sessionLifecycle.ts  # Session create/promote/demote/finalize
│       ├── messageRouting.ts    # Scratchpad → inbox routing (single source)
│       ├── honchoIntegration.ts # Honcho memory recording (spawn, exit, context)
│       ├── honchoClient.ts      # Honcho SDK client wrapper
│       ├── ptyManager.ts        # PTY spawn/kill/write with \r normalization
│       ├── terminalRegistry.ts  # Persistent terminal state (JSON)
│       ├── scratchpadWatcher.ts # File watcher for message bus
│       ├── artifactWatcher.ts   # File watcher for agent outputs
│       ├── serverContext.ts     # Shared type for all modules
│       ├── protocol.ts          # WebSocket message types
│       ├── usageLogger.ts       # Cost tracking per session
│       └── __tests__/           # 31 backend tests
├── frontend/
│   └── src/
│       ├── App.tsx              # Main app with dual layout modes
│       ├── components/
│       │   ├── TerminalCanvas.tsx   # Infinite pan/zoom canvas
│       │   ├── TerminalWindow.tsx   # Draggable terminal window
│       │   ├── TerminalPane.tsx     # xterm.js terminal emulator
│       │   ├── AgentCard.tsx        # Structured mode agent card
│       │   ├── FileBrowser.tsx      # Global artifact browser + preview
│       │   ├── CoordinatorBar.tsx   # Coordinator status strip
│       │   ├── ChatPanel.tsx        # Inter-agent messaging UI
│       │   ├── TopNav.tsx           # Navigation + folder selector
│       │   └── ...
│       ├── hooks/useSocket.ts   # WebSocket with auto-reconnect
│       ├── utils/agentStatus.ts # Agent state detection
│       └── __tests__/           # 19 frontend tests
├── .env.example                 # Environment template for new users
├── CHANGELOG.md                 # Release history
├── VERSION                      # Current version (0.3.0)
└── TODOS.md                     # Prioritized backlog
```

## How It Works

### Agent Communication

Agents communicate through a shared `scratchpad.jsonl` file. When an agent runs `coagent send --msg "done"`, the message is:

1. Written to `scratchpad.jsonl` (the message bus)
2. Routed to the target agent's `inbox.jsonl` by the backend
3. Broadcast to the UI via WebSocket
4. Recorded to Honcho for semantic memory
5. Injected into the target's PTY if they're idle

### Memory Pipeline

```
Agent sends message
    ↓
Honcho API records it
    ↓
Deriver extracts observations:
  "worker-1 learned JWT tokens should rotate every 24h"
  "worker-1 considers Redis auth critical for production"
    ↓
Stored as vectors in PostgreSQL (pgvector)
    ↓
Any agent can query:
  coagent recall "what do we know about auth?"
```

### Terminal States

| State | Visual | Meaning |
|-------|--------|---------|
| Running | Green glow | Agent is actively producing output |
| Idle | Grey border | No output for 1.5+ seconds |
| Waiting | Pulsing red | Agent needs your input (permission prompt, y/n) |
| Attention | Solid red | Urgent message from another agent |
| Exited | Dimmed | Terminal process ended |

## Services

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 5173 | React UI (Vite) |
| Backend | 3001 | WebSocket server, PTY management |
| Honcho API | 8000 | Memory REST API |
| Deriver | — | Background worker, extracts observations |
| PostgreSQL | 5432 | Message + vector storage (Docker) |
| Redis | 6379 | Cache (Docker) |

## Development

```bash
# Run tests
cd backend && npm test
cd frontend && npx vitest run

# Type check
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# View logs
coagent logs
```

## License

MIT
