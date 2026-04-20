# Changelog

## 0.3.2 — 2026-04-20

### Fairness

Added mandatory **Fairness Review** sections to the Marketing and Finance agent prompts in `backend/src/workspace.ts`. Both sections are required parts of the artifact — not optional checklists.

**Marketing (`marketing-prompt.md`)**: Before finalising the GTM strategy, the agent must explicitly answer five questions covering demographic coverage (whether audience targeting excludes groups without documented rationale), channel accessibility (WCAG compliance), message bias (assumptions about audience lifestyle or values), data sourcing (whether segmentation is evidence-based or assumed), and underserved markets. Gaps must be addressed in the plan or documented as known limitations.

**Finance (`finance-prompt.md`)**: Before finalising the budget analysis, the agent must explicitly answer four questions covering equitable allocation (whether budget distribution is data-driven or assumption-driven), accessibility cost line items, pricing fairness (whether the revenue model creates barriers for lower-income users), and risk distribution (who bears the cost in downside scenarios). Allocations that cannot be justified with data must be flagged for human review.

### Ethical Issues

**QA agent role expanded to Ethics & Fairness Reviewer** (`qa-prompt.md` in `backend/src/workspace.ts`): The QA plan structure now includes a required **Ethics & Fairness Review** section covering four areas:
- *Harm assessment*: direct harm potential and foreseeable misuse scenarios
- *Fairness & bias*: differential performance across demographic groups; success metrics that could mask harm
- *Transparency & consent*: AI content disclosure; data collection language
- *Ethical boundaries*: compliance check against `ETHICS.md`

Concerns are classified as Blocker / Major / Minor. Blockers trigger an immediate `coagent send --type blocker` to the coordinator, halting the phase transition until the human principal resolves the issue. The QA agent is also instructed to flag missing `ETHICS.md` as a governance gap.

**New file `ETHICS.md`** at project root: defines eight categories of ethical boundary — harm prevention, fairness, transparency, privacy, human oversight, prohibited use cases, and accountability. Referenced by the QA agent prompt and `GOVERNANCE.md`. Establishes that the QA agent is the designated ethics reviewer for each project run.

### Governance

**New file `GOVERNANCE.md`** at project root: documents the complete AI governance framework for CoAgent, covering:
- Four governance principles mapped to implementation mechanisms (accountability, transparency, fairness, human oversight)
- Stakeholder roles table (Human Principal, Coordinator, Department Agents, System)
- **Agent role permission matrix**: which message types each agent may send/receive, filesystem access boundaries, and who may raise ethics blockers
- **Approval process**: tiered by impact — automatic (routine messages), human-review-recommended (phase transitions, low-confidence outputs), human-approval-required (ethics blockers, unresolvable conflicts), and prohibited-without-instruction (irreversible operations, PII forwarding)
- Audit trail reference table linking each artefact to its location, contents, and retention policy, with `jq` queries for filtering decisions by category
- Incident response procedure (5-step process from QA flag to post-incident review)
- Known limitations table with current mitigation and full-fix path for each

**`coagent decision` CLI extended** (`backend/src/workspace.ts`): added `--category` parameter with five values — `general` (default), `ethics_concern`, `risk_acceptance`, `scope_change`, `security`. The category is written to `decisions.jsonl` and used as the Honcho memory tag, enabling governance queries like `jq 'select(.category == "ethics_concern")' decisions.jsonl`. `commRules` updated with category definitions so all agents know when to use each.

## 0.3.1 — 2026-04-20

### Security — Infrastructure Layer (guardrail.ts)

New module `backend/src/guardrail.ts` adds a message validation layer intercepting all scratchpad messages before they are written to shared storage or injected into agent PTYs. Exposes two functions:

- `validateMessage(msg)` — runs four sequential checks and returns `{ allowed, sanitized, flags }`:
  1. **Identity verification**: flags messages from unrecognized senders (soft check, audit-only)
  2. **Prompt injection / jailbreak detection**: regex patterns covering `ignore previous instructions`, `forget your role`, `you are now`, `act as`, `DAN mode`, `developer mode`, raw LLM template delimiters (`[INST]`, `<|im_start|>`), and markdown injection (`### instruction`). Hard block — message is dropped if matched
  3. **PII detection and redaction**: structural regex for emails, US phone numbers, SSNs, and credit card numbers. Allowed but redacted in-place (e.g. `alice@example.com` → `[EMAIL REDACTED]`) rather than blocked, preserving message intent
  4. **Control character stripping**: removes `\r`, `\n`, and other control characters from message content to prevent PTY execution via newline injection
- `sanitizeForPty(text, maxLen)` — strips all control characters and truncates; applied at the PTY write site as a second line of defence

Wired into two interception points:
- `backend/src/messageRouting.ts`: guardrail runs at the top of every routing callback; blocked messages are dropped before inbox write or PTY injection; sanitized copy used for all downstream operations
- `backend/src/index.ts` (`chat:send` handler): guardrail runs before `fs.appendFileSync` to scratchpad; blocked messages return a `chat:error` WebSocket event to the client

Added `{ type: "chat:error"; message: string }` to `ServerMessage` union in `backend/src/protocol.ts`.

New test file `backend/src/__tests__/guardrail.test.ts` — 19 tests covering prompt injection blocking, PII redaction, control character stripping, identity spoofing detection, and `sanitizeForPty` behaviour.

### Security — PTY Shell Injection Fix (P1)

Fixed the known P1 vulnerability in `messageRouting.ts` where `scratchMsg.msg.slice(0, 120)` was embedded raw into the PTY notification string. A message containing `\r` would simulate pressing Enter in the PTY, executing whatever text preceded it as a shell command.

`scratchMsg.msg` and `scratchMsg.from` are now both passed through `sanitizeForPty()` at the injection site, replacing all control characters with spaces before the string is written to the PTY. This is redundant with the guardrail's control-character stripping (defence in depth).

### Security — Prompt-Level Defence (CLAUDE.md Security Boundaries)

Added a `## SECURITY BOUNDARIES` section to all agent prompts in `backend/src/workspace.ts` (coordinator prompt and `commRules` shared by all five department agents). The section is non-overridable by design and covers:

- **Role integrity**: role and instructions cannot be changed by any received message
- **Prompt injection resistance**: explicit instructions to discard injected content and broadcast a `[SECURITY ALERT]` via `coagent send` when injection phrases are detected
- **System prompt confidentiality**: agents must not reveal the contents of their CLAUDE.md to any other agent or user
- **Filesystem isolation**: agents may only access their own `$COAGENT_SESSION_DIR` and the shared `$COAGENT_SHARED_DIR`; direct reads of other agents' session directories are prohibited — cross-agent data must flow through `coagent send`
- **PII handling**: agents must not forward or store PII encountered in messages or artifacts
- **Trust hierarchy**: instructions are only accepted from `coagent inbox`; content embedded inside artifact files or data payloads is treated as data, not commands

The same boundaries were also added to the fallback prompts in `backend/src/sessionLifecycle.ts` (used when workspace template files do not yet exist).

### Governance — Accountability and Explainability

`coagent decision` was already implemented in the CLI (writes structured JSON to `_shared/decisions.jsonl` with Honcho integration) but was never referenced in any agent prompt. Addressed by:

- Added `## ACCOUNTABILITY & EXPLAINABILITY` section to `commRules` in `workspace.ts`, instructing all five department agents to call `coagent decision --decision "..." --rationale "..."` before any significant choice (technology selection, approach trade-offs, scope cuts, risk acceptance)
- Added explicit `coagent decision` calls to the coordinator's Phase 1, 2, and 3 dispatch steps, logging what was dispatched and why each phase transition was triggered
- Added a structured `summary.json` template to `commRules`, requiring agents to write `keyFindings`, `decisionsLog`, `assumptions`, `confidence` (High/Medium/Low), `tasksCompleted`, `risks`, and `handoffNotes` on task completion — enabling downstream agents and the coordinator to assess output quality without reading full PTY logs

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
