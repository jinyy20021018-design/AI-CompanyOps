# AI CompanyOps Multi-Agent System

Course project repository for the AI CompanyOps Multi-Agent System. The overall system is designed around a CEO Agent coordinating Product, Engineering, Finance, and QA agents to generate an integrated business proposal from a high-level user request.

This repository currently includes the first implemented module: the QA Agent. The QA Agent reviews Product, Engineering, and Finance outputs, checks cross-agent consistency, and returns a structured QA review report. Other agents can be added into the same repository later.

## Current Repository Status

- Project repository for the full multi-agent system
- QA Agent implemented and runnable
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

- `packages/shared-contracts`
  Shared schemas, constants, and types
- `packages/qa-agent`
  QA Agent core logic, rules, prompts, scoring, and report generation
- `apps/qa-entry`
  CLI and Fastify API entrypoints
- `fixtures`
  Sample requests and mock LLM outputs for demo and testing
- `tests`
  Unit and integration tests

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
- The existing contracts are designed so a future CEO Agent or orchestration layer can call the QA module directly.
