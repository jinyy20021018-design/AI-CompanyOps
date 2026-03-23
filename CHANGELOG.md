# Changelog

## 0.3.0 — 2026-03-22

### Security
- Fix shell injection in coagent CLI template — all JSON builders rewritten with `jq -n`

### Architecture
- Extract index.ts monolith (2,698 LOC) into 5 modules: workspace.ts, sessionLifecycle.ts, messageRouting.ts, honchoIntegration.ts, serverContext.ts
- De-duplicate scratchpad routing from 3 copies to 1 shared function
- Fix Honcho recording missing from reconnect handlers

### Testing
- Add vitest with 44 tests across 5 test files
- Coverage: shell injection, PTY normalization, message routing, demote handler, waitingForHuman detection

### Design
- Pulsing red glow for terminals waiting for human input (distinct from urgent messages)
- Pin/unpin toggle with click feedback animation
- Sync agent status colors to CSS design tokens

### Fixes
- Fix coordinator Honcho context injection race — await before PTY spawn
- Terminal demote (unpin) support

## 0.2.0 — 2026-03-20

### Features
- Honcho semantic memory integration via `@honcho-ai/sdk`
- Cross-project knowledge transfer via shared Honcho workspace
- `/honcho/context` HTTP endpoint for agent recall
- `coagent recall` CLI command for querying semantic memory
- Scratchpad messages, spawn/exit lifecycle events recorded to Honcho
- Coordinator CLAUDE.md enriched with Honcho cross-project memory at spawn

### Fixes
- PTY stall fix: normalize trailing `\n` to `\r` in ptyManager.write()

### UI
- Artifact bar: show latest 3 with clickable +N overflow to expand full list
- Terminal state indicators: green (running), grey (idle), red (needs attention)
- waitingForHuman detection via output pattern matching

## 0.1.0 — 2026-03-19

### Features
- Multi-agent workspace with coordinator/worker roles
- Scratchpad messaging system with role-based routing
- Terminal promotion and persistence
- Artifact tracking and display
- Usage/cost monitoring per session
- Agent card grid and focus view layouts

## 0.0.1 — 2026-03-16

### Initial Release
- Terminal Canvas MVP
- PTY management with WebSocket streaming
- Infinite canvas with draggable/resizable terminal windows
- Project sidebar with folder management
- Dark/light theme toggle
