import { fetchJson, ToolTimeoutError } from "./httpClient.js";
import type { AgentTool, InjectedToolResult, ToolContext } from "./toolTypes.js";

export type ExchangeRateInput = {
  base?: string;
  symbols?: string[];
};

type FrankfurterResponse = {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
};

export const exchangeRateTool: AgentTool<ExchangeRateInput, FrankfurterResponse> = {
  name: "exchange_rate",
  provider: "frankfurter",
  description: "Fetch latest exchange rates from Frankfurter.",
  defaultTimeoutMs: 8000,
  availability() {
    return { available: true };
  },
  async execute(input: ExchangeRateInput, _ctx: ToolContext): Promise<InjectedToolResult<FrankfurterResponse>> {
    const base = (input.base ?? "USD").toUpperCase();
    const symbols = (input.symbols?.length ? input.symbols : ["EUR", "CNY", "SGD", "GBP"]).map((s) => s.toUpperCase());
    const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(symbols.join(","))}`;
    try {
      const data = await fetchJson<FrankfurterResponse>(url, { timeoutMs: this.defaultTimeoutMs });
      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt: new Date().toISOString(),
        data,
        sources: [{ title: "Frankfurter latest exchange rates", url, confidence: "high" }],
      };
    } catch (err) {
      return {
        tool: this.name,
        status: err instanceof ToolTimeoutError ? "timeout" : "failed",
        provider: this.provider,
        retrievedAt: new Date().toISOString(),
        reason: err instanceof Error ? err.message : String(err),
        sources: [{ title: "Frankfurter latest exchange rates", url, confidence: "medium" }],
      };
    }
  },
};
