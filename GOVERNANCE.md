# AI Governance Framework — CoAgent

This document defines the governance structure for the CoAgent multi-agent system: who is responsible for what, what each agent is permitted to do, how decisions are approved, and how accountability is maintained.

---

## 1. Governance Principles

CoAgent is governed by four principles drawn from the EU AI Act and NIST AI RMF:

| Principle | Definition | How it is implemented |
|---|---|---|
| **Accountability** | Every consequential decision has a named owner and a logged rationale | `decisions.jsonl` with mandatory `coagent decision` calls at phase transitions |
| **Transparency** | Stakeholders can understand what the system did and why | Structured `summary.json` per agent; `output.jsonl` PTY audit trail |
| **Fairness** | Outputs do not systematically disadvantage any group | Mandatory Fairness Review sections in Marketing and Finance artifacts |
| **Human Oversight** | Humans can intervene, inspect, and override at any point | User controls PTY input directly; coordinator surfaces decisions via terminal output |

---

## 2. Stakeholder Roles

| Role | Identity | Responsibilities |
|---|---|---|
| **Human Principal** | The user running CoAgent | Sets project goals; approves or redirects the coordinator; final authority on all outputs |
| **Coordinator (CEO Agent)** | `sessions/coordinator/` | Decomposes tasks, dispatches to departments, synthesises final report, escalates blockers |
| **Department Agents** | `sessions/{product,engineering,marketing,qa,finance}/` | Execute assigned tasks within their domain; produce artifacts; flag concerns upstream |
| **System** | Backend Node.js process | Routes messages, enforces guardrails, writes audit logs |

---

## 3. Agent Role Permission Matrix

What each agent is permitted to do:

| Permission | Coordinator | Product | Engineering | Marketing | QA | Finance |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Send `task_assign` to departments | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Send `handoff` to coordinator | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Send `question` to any agent | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Send `blocker` to coordinator | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Write to `_shared/decisions.jsonl` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Write to `_shared/scratchpad.jsonl` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read other agents' `session/` dirs | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read `_shared/` dir | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Issue `status_update` broadcast | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Raise ethics blocker | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

> **Enforcement**: Permissions marked ❌ are enforced via CLAUDE.md instructions (filesystem isolation rule, trust hierarchy rule). Runtime enforcement requires container-level isolation — see Known Limitations.

---

## 4. Approval Process

### 4.1 Automatic (no human approval required)
- Routine inter-agent `task_assign`, `handoff`, `question`, `status_update` messages
- Artifact writes within an agent's own session directory
- `coagent decision` logging

### 4.2 Human review recommended
- Phase transitions (coordinator advancing from Phase 1 → 2 → 3) — coordinator logs decision with rationale; human can redirect via chat before next phase completes
- Low-confidence outputs (`confidence: Low` in `summary.json`) — coordinator should surface to user before using downstream

### 4.3 Human approval required (blocker)
- Any output flagged as an ethics concern by QA (`--category ethics_concern`)
- Conflicting outputs from two departments that the coordinator cannot resolve
- Any agent reporting an unresolvable blocker after two escalation attempts

### 4.4 Prohibited without explicit user instruction
- Direct execution of irreversible operations (file deletion, external API calls, sending emails)
- Forwarding PII to any external service
- Overriding another agent's completed artifact without logging a `scope_change` decision

---

## 5. Audit Trail

| Artefact | Location | Contents | Retention |
|---|---|---|---|
| Decision log | `_shared/decisions.jsonl` | All `coagent decision` entries with category, rationale, timestamp, agent | Permanent per workspace |
| Message bus | `_shared/scratchpad.jsonl` | All inter-agent messages | Permanent per workspace |
| Task board | `_shared/tasks.jsonl` | Task start / done / blocked events | Permanent per workspace |
| PTY output | `sessions/{name}/output.jsonl` | Raw terminal output per agent | Per session |
| Session summary | `sessions/{name}/summary.json` | Key findings, confidence, decisions, risks | Per session |
| Usage log | `sessions/{name}/usage.jsonl` | Token and cost per LLM call | Per session |
| Semantic memory | Honcho (PostgreSQL) | Vector-embedded message history | Cross-project, persistent |

To query decisions by category:
```bash
jq 'select(.category == "ethics_concern")' _shared/decisions.jsonl
jq 'select(.category == "risk_acceptance")' _shared/decisions.jsonl
```

---

## 6. Incident Response

If an agent produces output that violates ETHICS.md or this governance framework:

1. **QA flags it** as an ethics blocker via `coagent send --type blocker`
2. **Coordinator holds** the phase transition and surfaces the concern to the human principal
3. **Human decides**: correct the output, override with documented rationale, or abort the run
4. **Decision is logged** via `coagent decision --category ethics_concern --decision "..." --rationale "..."`
5. **Post-incident**: review `decisions.jsonl` and `scratchpad.jsonl` to determine root cause

---

## 7. Known Limitations

| Limitation | Impact | Mitigation in place | Full fix |
|---|---|---|---|
| All agents share the same OS user | Agent cannot be prevented at OS level from reading another's session dir | CLAUDE.md filesystem isolation instruction | Per-agent Docker containers |
| `from` field in scratchpad is self-reported | Identity spoofing possible | `guardrail.ts` identity flag; CLAUDE.md trust hierarchy | Signed messages or shared secret per session |
| Permission matrix is prompt-enforced, not runtime-enforced | A prompt-injected agent could violate permissions | Two-layer injection defence (guardrail + CLAUDE.md) | Runtime ACL in `messageRouting.ts` |
| No cryptographic audit log | `decisions.jsonl` can be edited after the fact | Append-only by convention; Honcho provides secondary record | Append-only log with hash chaining |

---

## 8. Relationship to Other Governance Documents

- [ETHICS.md](./ETHICS.md) — ethical boundaries; defines what CoAgent must not produce
- `_shared/decisions.jsonl` — runtime audit trail; primary accountability record
- `backend/src/guardrail.ts` — technical enforcement of input validation policies
- `backend/src/workspace.ts` — source of all agent CLAUDE.md prompts; defines agent behaviour policy

---

*Last updated: 2026-04-20*
