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

Prerequisites: [Node.js](https://nodejs.org/) (v20+), [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running), [Claude Code](https://claude.ai/code) (logged in)

```bash
git clone https://github.com/ZihaoChenz/CoAgents.git
cd CoAgents
./bin/coagent-cli
```

That's it. The interactive wizard will guide you through:
1. Cloning the Honcho memory server (automatic)
2. Detecting your Claude Code authentication
3. Getting a free Gemini API key for embeddings
4. Installing all dependencies (Node.js + Python)
5. Starting all 6 services and opening the UI

### Shortcut (optional)

After the first run, set up an alias so you can use `coagent` from anywhere:

```bash
echo 'alias coagent="'$(pwd)'/bin/coagent-cli"' >> ~/.zshrc
source ~/.zshrc
```

## Commands

All commands can be run as `./bin/coagent-cli <command>` or `coagent <command>` if you set up the alias.

```
./bin/coagent-cli              Start all services (default)
./bin/coagent-cli stop         Stop all services
./bin/coagent-cli status       Show service health
./bin/coagent-cli restart      Stop then start
./bin/coagent-cli logs         Tail all service logs
./bin/coagent-cli open         Open the UI in browser
./bin/coagent-cli setup        Re-run the setup wizard
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
