# AI Governance Framework - CoAgent

This document defines how CoAgent is governed: responsibilities, permissions, approval rules, audit trails, runtime controls, and residual risks.

CoAgent is a local-first multi-agent system. Claude Code is the agent runtime inside each per-agent container. CoAgent provides the orchestration layer around that runtime: message bus, routing, ACL, guardrails, workspace protocol, artifact handoff, audit records, Honcho memory integration, and frontend observability.

## 1. Governance Principles

CoAgent is governed by principles aligned with NIST AI RMF, OWASP LLM guidance, and human-in-the-loop AI governance.

| Principle | Definition | Implementation |
| --- | --- | --- |
| Accountability | Consequential decisions must have an owner and rationale | `coagent decision`, `_shared/decisions.jsonl`, coordinator review |
| Transparency | Users can inspect what agents did and why | Workspace JSONL files, terminal output logs, artifact records, WebSocket UI |
| Human oversight | Humans can inspect, redirect, or stop work | UI terminal controls, coordinator escalation, required review of final outputs |
| Least privilege | Agents receive only the runtime and routing authority needed for their role | One container per agent, Docker limits, routing ACL for high-risk message types |
| Safety by default | Unsafe messages and high-risk routing are filtered before delivery | `guardrail.ts`, `routingAcl.ts`, sanitised Docker attach notifications |

## 2. Stakeholder Roles

| Role | Identity | Responsibilities |
| --- | --- | --- |
| Human principal | User running CoAgent | Sets project goals, reviews outputs, approves release decisions, resolves escalations |
| Coordinator / CEO agent | `sessions/coordinator/` | Decomposes work, dispatches tasks, reviews handoffs, synthesises final output, escalates blockers |
| Department agents | `sessions/{product,engineering,marketing,qa,finance}/` | Produce domain artifacts, answer questions, flag concerns, hand off work through CoAgent messages |
| Dynamic worker agents | `sessions/<agent>/` | Execute bounded tasks assigned by the coordinator or UI spawn flow |
| Backend/orchestrator | `backend/src/index.ts` | Owns HTTP/WebSocket API, agent lifecycle, routing, guardrails, artifact watching, usage logging |
| Agent runtime | Claude Code inside a per-agent Docker container | Executes task work inside the mounted project/session workspace |
| Honcho services | Honcho API and Deriver | Store messages, embeddings, derived documents, and recall context |

## 3. Runtime Governance Model

Default runtime mode is `container`.

| Area | Current design |
| --- | --- |
| Agent hosting | One Docker container per agent, dynamically created by `ContainerManager` |
| Agent I/O | `AgentChannel` writes to and reads from each container through Docker attach stdin/stdout |
| Legacy fallback | `COAGENT_MODE=pty` can run agents as host PTY child processes for debugging |
| Orchestrator hosting | Docker container in container mode, exposed on port `3001` |
| Frontend hosting | Docker container, exposed on port `5173` |
| Memory services | Honcho API and Deriver currently run as host `uv` processes |
| Data services | PostgreSQL `pgvector/pgvector:pg17` and Redis `redis:7-alpine` managed by Docker Compose |
| Docker access | Orchestrator uses `docker-socket-proxy` rather than direct unrestricted Docker socket access |

## 4. Agent Permission Matrix

| Permission | Coordinator | Product | Engineering | Marketing | QA | Finance | Dynamic worker |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Send `task_assign` to departments/workers | Yes | No | No | No | No | No | No |
| Send `handoff` to coordinator | No | Yes | Yes | Yes | Yes | Yes | Yes |
| Send `question` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Send `blocker` to coordinator | No | Yes | Yes | Yes | Yes | Yes | Yes |
| Write own session artifacts | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Write `_shared/decisions.jsonl` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Write `_shared/scratchpad.jsonl` via `coagent send` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Read `_shared/` workspace files | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Read another agent's session directory directly | No | No | No | No | No | No | No |
| Raise ethics blocker | No | Yes | Yes | Yes | Yes | Yes | Yes |

Enforcement is layered:

- `routingAcl.ts` enforces high-risk routing rules for `task_assign`, `blocker`, and untrusted senders.
- `guardrail.ts` blocks common prompt-injection patterns, redacts structured PII, and strips terminal control characters.
- Per-agent containers provide process-level separation and resource limits.
- Agent prompts and workspace protocol instruct agents to exchange information through `coagent send` and artifacts rather than direct session-directory reads.

## 5. Approval Process

### 5.1 Automatic

The system may process the following without human approval:

- Routine `status_update`, `question`, and `handoff` messages.
- Artifact writes inside an agent's own session directory.
- JSONL audit records written by `coagent send`, `coagent decision`, `coagent memory`, usage logging, and artifact watcher.
- Honcho memory recording for routed messages and explicit memory/decision commands.

### 5.2 Human Review Recommended

Human review is recommended for:

- Phase transitions where the coordinator advances the workflow.
- Low-confidence outputs or assumptions that materially affect scope, cost, safety, or business conclusions.
- Conflicting department outputs that require judgement.
- Final deliverables before external sharing.

### 5.3 Human Approval Required

Human approval is required for:

- Outputs flagged as ethics, privacy, security, or fairness blockers.
- Irreversible operations such as deletion, external posting, sending emails, payment actions, or production deployment.
- Forwarding PII or confidential data to an external service.
- Accepting a known security or compliance risk.

## 6. Audit Trail

| Artifact | Location | Contents | Retention |
| --- | --- | --- | --- |
| Decision log | `_shared/decisions.jsonl` | `coagent decision` records with category, decision, rationale, timestamp, agent | Per workspace |
| Message bus | `_shared/scratchpad.jsonl` | Inter-agent messages appended by `coagent send` | Per workspace |
| Agent inbox | `sessions/<agent>/inbox.jsonl` | Routed messages delivered to each agent | Per session |
| Task board | `_shared/tasks.jsonl` | Task start, progress, done, and blocked records | Per workspace |
| Artifact index | `_shared/artifacts.jsonl` | Artifact metadata and handoff references | Per workspace |
| Terminal output | `sessions/<agent>/output.jsonl` | Raw runtime output from the agent channel | Per session |
| Usage log | `sessions/<agent>/usage.jsonl` | Token and usage events | Per session |
| Cost summary | `_shared/cost_summary.json` | Aggregated model usage and cost summary | Per workspace |
| Semantic memory | Honcho PostgreSQL/pgvector | Sessions, peers, messages, embeddings, derived documents | Cross-project, persistent |
| Cache/locks | Redis | Cache and lock coordination for Honcho services | Operational |

Example audit queries:

```bash
jq 'select(.category == "ethics_concern")' CoAgent_workspace/_shared/decisions.jsonl
jq 'select(.category == "risk_acceptance")' CoAgent_workspace/_shared/decisions.jsonl
```

## 7. Security Governance

| Control area | Current implementation |
| --- | --- |
| Prompt injection | `guardrail.ts` lexical blocking before routing |
| Sensitive information | Structured PII redaction before downstream delivery and memory recording |
| Terminal injection | Control-character stripping before PTY or Docker attach stream writes |
| Excessive agency | Per-agent Docker containers, dropped Linux capabilities, `no-new-privileges`, CPU, memory, and PID limits |
| Routing authority | `routingAcl.ts` restricts high-risk message types |
| Docker API exposure | `docker-socket-proxy` limits orchestrator Docker API access |
| CI security gates | CodeQL SAST, Gitleaks, AI security tests, dependency audit |
| Human governance | QA review, ethics blocker flow, final human approval |

These controls should be mapped to OWASP LLM Top 10 risks in reports and security documentation.

## 8. Incident Response

If an agent produces output that violates `ETHICS.md` or this governance framework:

1. QA or any agent raises a blocker:

   ```bash
   coagent send --to "role:coordinator" --type blocker --msg "[ETHICS BLOCKER] ..."
   ```

2. The coordinator stops the affected phase and surfaces the concern to the human principal.
3. The human principal chooses to correct, reject, document an override, or abort the run.
4. The decision is logged:

   ```bash
   coagent decision --category ethics_concern --decision "..." --rationale "..."
   ```

5. Post-incident review checks `_shared/decisions.jsonl`, `_shared/scratchpad.jsonl`, the relevant `inbox.jsonl`, agent artifacts, and Honcho records where applicable.

## 9. Known Limitations

| Limitation | Impact | Current mitigation | Future improvement |
| --- | --- | --- | --- |
| Sender identity in messages is not cryptographically signed | A malicious or compromised process could spoof a `from` value | Registry-based authority checks and ACL restrictions for high-risk message types | Signed messages or per-session shared secrets |
| Guardrail detection is lexical | Paraphrased or encoded prompt injection can bypass filters | CI regression tests and human QA review | Add classifier-based or model-assisted policy checks |
| ACL coverage is intentionally focused | Some lower-risk policy rules remain prompt- or process-enforced | Runtime ACL for `task_assign`, `blocker`, and untrusted high-risk senders | Expand ACL to all sensitive message policies |
| Workspace logs are editable files | Audit trail is inspectable but not tamper-proof | Append-oriented convention plus Honcho secondary records | Hash-chained append-only audit log |
| Honcho API and Deriver run as host processes | Local setup is simpler but not a complete cloud deployment model | Docker-managed PostgreSQL/Redis, documented process ownership | Containerize or deploy Honcho services in server/cloud reference architecture |
| Human review remains necessary | LLM hallucination and judgement errors are still possible | QA review, artifact handoff, confidence labelling, final approval | Stronger automated evaluation and source-grounding checks |

## 10. Related Documents

- [README.md](./README.md) - setup, architecture, runtime model, development commands.
- [README.zh-CN.md](./README.zh-CN.md) - Chinese README aligned with the current architecture.
- [ETHICS.md](./ETHICS.md) - ethical boundaries and prohibited use cases.
- `backend/src/guardrail.ts` - prompt injection, PII, and terminal-safety validation.
- `backend/src/routingAcl.ts` - runtime authority checks for high-risk message delivery.
- `backend/src/containerManager.ts` - per-agent Docker runtime implementation.
- `.github/workflows/ci.yml` - CI, SAST, secret scanning, testing, AI security tests, dependency audit.

