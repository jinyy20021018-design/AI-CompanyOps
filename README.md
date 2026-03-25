# QA Agent v1

Independent QA Agent for the AI CompanyOps multi-agent proposal. This project reviews Product, Engineering, and Finance outputs, checks cross-agent consistency, and returns a structured QA review report.

## Stack

- Node.js + TypeScript
- npm workspaces
- Fastify
- Vitest
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`
- Zod

## Install

```bash
npm install
```

## Run In Mock Mode

CLI JSON output:

```bash
npm run qa:review -- --input ./fixtures/happy-path.request.json --format json --mode mock
```

CLI Markdown output:

```bash
npm run qa:review -- --input ./fixtures/happy-path.request.json --format markdown --mode mock
```

Start the HTTP API:

```bash
npm run qa:server
```

Send a request:

```bash
curl -X POST http://localhost:3000/qa/review ^
  -H "Content-Type: application/json" ^
  --data-binary "@fixtures/happy-path.request.json"
```

## Run In Live Mode

Copy `.env.example` to `.env` and set:

- `QA_LLM_PROVIDER`
- `QA_LLM_MODEL`
- provider API key such as `OPENAI_API_KEY`

Then run:

```bash
npm run qa:review -- --input ./fixtures/happy-path.request.json --format json --mode live
```

If live review fails, the QA Agent returns a degraded report with rule-based output and a summary note explaining the failure.

## API

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

## Demo Fixtures

- `fixtures/happy-path.request.json`
- `fixtures/conflict.request.json`
- `fixtures/missing-sections.request.json`
- `fixtures/mock-llm/*.json`

## Notes

- This is an independent QA Agent and does not require CEO orchestration to run.
- Current demo flow uses mock artifacts from fixtures.
- The output contract is stable enough for a future CEO Agent or orchestration layer to call directly.
