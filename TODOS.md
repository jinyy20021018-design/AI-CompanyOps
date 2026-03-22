# TODOS

## P0 — Critical

### Shell injection fix in coagent CLI template
- **What:** Rewrite coagent `send` (and all other printf/sed JSON builders) to use `jq -n` for safe JSON construction
- **Why:** Current sed escaping doesn't handle `$()`, backticks, or newlines — agent messages can execute arbitrary shell commands
- **Context:** index.ts:334 — the embedded bash template uses `printf` with incomplete sed escaping. All JSON-writing commands in the coagent template have the same vulnerability.
- **Depends on:** Nothing — fix independently

### Extract index.ts monolith into modules
- **What:** Split backend/src/index.ts (2,700 LOC) into: server.ts, wsHandlers.ts, workspace.ts, sessionLifecycle.ts, messageRouting.ts, honchoIntegration.ts, index.ts (glue)
- **Why:** Every feature touches one 2,700-line file. Routing logic is duplicated 3x, causing bugs (Honcho recording missing from reconnect handlers)
- **Context:** Supporting modules (ptyManager, terminalRegistry, scratchpadWatcher, artifactWatcher) are already well-extracted. This is the same pattern applied to the remaining code.
- **Depends on:** Nothing — pure refactor, zero behavior change

### Write tests for 5 critical paths
- **What:** Add test files for: (1) coagent CLI shell injection, (2) PTY \n→\r normalization, (3) scratchpad message routing, (4) terminal:demote handler, (5) waitingForHuman regex matching
- **Why:** 0% test coverage. The PTY \n/\r bug was already shipped and caught manually. Shell injection is undetected.
- **Context:** No test framework installed yet. Need to add vitest or jest for backend, vitest for frontend.
- **Depends on:** Module extraction (makes routing testable as isolated function)

## P1 — Important

### Build own Honcho-compatible API
- **What:** Self-hosted memory API replacing api.honcho.dev calls
- **Why:** Eliminates external dependency, enables custom observation logic, reduces latency, no API costs
- **Context:** Current integration uses @honcho-ai/sdk → api.honcho.dev. honchoClient.ts abstraction makes swapping straightforward. Honcho server codebase at /Users/enicul/Documents/CoAgent/honcho.
- **Depends on:** Module extraction (honchoIntegration.ts isolated)

### Fix coordinator Honcho context injection race
- **What:** Await Honcho representation call before spawning PTY, not fire-and-forget
- **Why:** Currently fires async but PTY spawns immediately — CLAUDE.md may be written after Claude already read it
- **Context:** index.ts coordinator spawn block. Simple fix: await the Honcho call before the `snapshotClaudeSessions` line.
- **Depends on:** Nothing

## P2 — Nice to have

### Add VERSION file and CHANGELOG.md
- **What:** Version tracking and release history
- **Why:** Enables `/ship` skill auto-bumping, gives users version history
- **Context:** 3 commits named 'MVP', 'v1', 'memory_v1' but no actual version file
- **Depends on:** Nothing

### Frontend CSS design system (DESIGN.md)
- **What:** Run `/design-consultation` to create systematic color tokens, spacing scale, typography
- **Why:** index.css is 2,900+ lines growing organically with ad-hoc styles per component
- **Context:** Has CSS variables for colors but no spacing system. Light/dark theme exists but is ad-hoc.
- **Depends on:** Nothing, lower priority than backend work
