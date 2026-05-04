import { fetchJson, ToolTimeoutError } from "./httpClient.js";
import type { AgentTool, InjectedToolResult, ToolContext } from "./toolTypes.js";

export type AlphaVantageInput = {
  symbols?: string[];
};

export type AlphaVantageOutput = {
  symbols: Record<string, Record<string, string>>;
};

export const alphaVantageTool: AgentTool<AlphaVantageInput, AlphaVantageOutput> = {
  name: "alpha_vantage",
  provider: "alpha_vantage",
  description: "Fetch lightweight market quote data from Alpha Vantage.",
  defaultTimeoutMs: 10000,
  availability() {
    return process.env.ALPHA_VANTAGE_API_KEY ? { available: true } : { available: false, reason: "missing_api_key" };
  },
  async execute(input: AlphaVantageInput, _ctx: ToolContext): Promise<InjectedToolResult<AlphaVantageOutput>> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    const retrievedAt = new Date().toISOString();
    if (!apiKey) {
      return { tool: this.name, status: "skipped", provider: this.provider, retrievedAt, reason: "missing_api_key", sources: [] };
    }
    const symbols = (input.symbols ?? []).filter((s) => /^[A-Z.]{1,8}$/i.test(s)).slice(0, 4);
    if (symbols.length === 0) {
      return { tool: this.name, status: "fulfilled", provider: this.provider, retrievedAt, data: { symbols: {} }, reason: "no_candidate_symbols", sources: [] };
    }
    try {
      const pairs = await Promise.all(symbols.map(async (symbol) => {
        const url = new URL("https://www.alphavantage.co/query");
        url.searchParams.set("function", "GLOBAL_QUOTE");
        url.searchParams.set("symbol", symbol.toUpperCase());
        url.searchParams.set("apikey", apiKey);
        const json = await fetchJson<Record<string, Record<string, string>>>(url.toString(), { timeoutMs: this.defaultTimeoutMs });
        return [symbol.toUpperCase(), json["Global Quote"] ?? {}] as const;
      }));
      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt,
        data: { symbols: Object.fromEntries(pairs) },
        sources: symbols.map((symbol) => ({ title: `Alpha Vantage ${symbol}`, url: "https://www.alphavantage.co/documentation/", confidence: "medium" as const })),
      };
    } catch (err) {
      return {
        tool: this.name,
        status: err instanceof ToolTimeoutError ? "timeout" : "failed",
        provider: this.provider,
        retrievedAt,
        reason: err instanceof Error ? err.message : String(err),
        sources: symbols.map((symbol) => ({ title: `Alpha Vantage ${symbol}`, url: "https://www.alphavantage.co/documentation/", confidence: "low" as const })),
      };
    }
  },
};
