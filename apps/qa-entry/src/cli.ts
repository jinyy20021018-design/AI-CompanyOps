import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { renderMarkdownReport, reviewQaRequest } from "../../../packages/agents/qa-agent/src/index.js";
import type { OutputFormat } from "../../../packages/shared/contracts/src/index.js";
import { loadEnv } from "./loadEnv.js";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

function parseArgs(argv: string[]): {
  input: string | undefined;
  format: OutputFormat;
  mode: "mock" | "live" | undefined;
} {
  const result: {
    input: string | undefined;
    format: OutputFormat;
    mode: "mock" | "live" | undefined;
  } = {
    input: undefined,
    mode: undefined,
    format: "json"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextToken = argv[index + 1];
    if (token === "--input") {
      if (nextToken) {
        result.input = nextToken;
      }
      index += 1;
    } else if (token === "--format" && (nextToken === "json" || nextToken === "markdown")) {
      result.format = nextToken;
      index += 1;
    } else if (token === "--mode" && (nextToken === "mock" || nextToken === "live")) {
      result.mode = nextToken;
      index += 1;
    }
  }

  return result;
}

export async function runCli(argv: string[]): Promise<CliResult> {
  const parsedArgs = parseArgs(argv);
  if (!parsedArgs.input) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Missing required --input argument."
    };
  }

  try {
    const raw = await readFile(parsedArgs.input, "utf8");
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const env = loadEnv();
    const mergedPayload = {
      ...payload,
      options: {
        ...(typeof payload.options === "object" && payload.options !== null ? payload.options : {}),
        mode: parsedArgs.mode ?? (payload.options as { mode?: "mock" | "live" } | undefined)?.mode ?? "mock",
        outputFormat: parsedArgs.format
      }
    };
    const report = await reviewQaRequest(mergedPayload, env);
    const stdout = parsedArgs.format === "markdown" ? renderMarkdownReport(report) : JSON.stringify(report, null, 2);

    return {
      exitCode: 0,
      stdout
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Unknown CLI error."
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) {
      process.stdout.write(`${result.stdout}\n`);
    }
    if (result.stderr) {
      process.stderr.write(`${result.stderr}\n`);
    }
    process.exitCode = result.exitCode;
  });
}
