# AI CompanyOps Multi-Agent System

Course project repository for the AI CompanyOps Multi-Agent System. The overall system is designed around a CEO Agent coordinating Product, Engineering, Finance, and QA agents to generate an integrated business proposal from a high-level user request.

This repository is organized as an agent-oriented monorepo. The QA Agent is currently implemented. CEO, Product, Engineering, and Finance are included as contract skeleton packages so the repository structure already matches the final multi-agent design.

## Current Repository Status

- Project repository for the full multi-agent system
- QA Agent implemented and runnable
- CEO, Product, Engineering, and Finance packages scaffolded as skeletons
- Mock fixtures included for Product, Engineering, and Finance outputs
- CLI and HTTP API available for QA review
- Live LLM review path prepared through `pi-agent-core` and `pi-ai`

## Tech Stack

- Node.js + TypeScript
- npm workspaces
- Fastify
- Vitest
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`
- Zod

## Repository Structure

```text
packages/
  agents/
    ceo-agent/
    product-agent/
    engineering-agent/
    finance-agent/
    qa-agent/
  shared/
    contracts/
apps/
  qa-entry/
fixtures/
tests/
```

- `packages/agents/qa-agent`
  Implemented QA Agent runtime and review logic
- `packages/agents/ceo-agent`
  CEO orchestration contract skeleton
- `packages/agents/product-agent`
  Product artifact contract skeleton
- `packages/agents/engineering-agent`
  Engineering artifact contract skeleton
- `packages/agents/finance-agent`
  Finance artifact contract skeleton
- `packages/shared/contracts`
  Shared schemas, constants, and types used across agents
- `apps/qa-entry`
  Current CLI and Fastify API entrypoint for the QA Agent demo flow
- `fixtures`
  Sample requests and mock LLM outputs
- `tests`
  Unit and integration tests for the implemented QA flow

## Agent Status

- CEO Agent: skeleton package, no runtime implementation yet
- Product Agent: skeleton package, no runtime implementation yet
- Engineering Agent: skeleton package, no runtime implementation yet
- Finance Agent: skeleton package, no runtime implementation yet
- QA Agent: implemented and runnable

## Install

```bash
npm install
```

## QA Agent Usage

Run mock review with JSON output:

```bash
npm run qa:review -- --input ./fixtures/happy-path.request.json --format json --mode mock
```

Run mock review with Markdown output:

```bash
npm run qa:review -- --input ./fixtures/happy-path.request.json --format markdown --mode mock
```

Start the API server:

```bash
npm run qa:server
```

Send a request:

```bash
curl -X POST http://localhost:3000/qa/review ^
  -H "Content-Type: application/json" ^
  --data-binary "@fixtures/happy-path.request.json"
```

## Live LLM Mode

Copy `.env.example` to `.env` and configure:

- `QA_LLM_PROVIDER`
- `QA_LLM_MODEL`
- provider API key such as `OPENAI_API_KEY`

Then run:

```bash
npm run qa:review -- --input ./fixtures/happy-path.request.json --format json --mode live
```

If live review fails, the system falls back to rule-based review and reports degraded mode in the summary.

## QA Agent API

`POST /qa/review`

Request body matches `ReviewRequest`:

- `userRequest`
- `artifacts.product`
- `artifacts.engineering`
- `artifacts.finance`
- `options.mode`
- `options.outputFormat`

Response body matches `QaReviewReport`:

- `status`
- `summary`
- `scorecard`
- `issues`
- `missingInputs`
- `generatedAt`

## Demo Assets

- `fixtures/happy-path.request.json`
- `fixtures/conflict.request.json`
- `fixtures/missing-sections.request.json`
- `fixtures/mock-llm/*.json`
- `AI_CompanyOps_Proposal.docx`

## Notes

- This repository is intended for the full project, not only the QA module.
- The current implemented vertical slice is the QA Agent.
- `apps/qa-entry` is the current QA demo entrypoint, not the final full-system orchestration app.
- The existing contracts are designed so a future CEO Agent or orchestration layer can call the QA module directly.
