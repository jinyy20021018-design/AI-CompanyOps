import { fetchJson, ToolTimeoutError } from "./httpClient.js";
import type { AgentTool, InjectedToolResult, ToolContext } from "./toolTypes.js";

export type WorldBankInput = {
  country?: string;
  indicators?: string[];
};

type WorldBankObservation = {
  indicator?: { id: string; value: string };
  country?: { id: string; value: string };
  date: string;
  value: number | null;
};

export type WorldBankOutput = {
  country: string;
  indicators: Record<string, WorldBankObservation[]>;
};

export const worldBankTool: AgentTool<WorldBankInput, WorldBankOutput> = {
  name: "world_bank_indicator",
  provider: "world_bank",
  description: "Fetch country-level indicators from the World Bank API.",
  defaultTimeoutMs: 10000,
  availability() {
    return { available: true };
  },
  async execute(input: WorldBankInput, _ctx: ToolContext): Promise<InjectedToolResult<WorldBankOutput>> {
    const country = (input.country ?? "US").toUpperCase();
    const indicators = input.indicators?.length
      ? input.indicators
      : ["NY.GDP.MKTP.CD", "SP.POP.TOTL", "IT.NET.USER.ZS"];
    const retrievedAt = new Date().toISOString();
    try {
      const pairs = await Promise.all(indicators.map(async (indicator) => {
        const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=8`;
        const json = await fetchJson<unknown[]>(url, { timeoutMs: this.defaultTimeoutMs });
        const rows = Array.isArray(json[1]) ? json[1] as WorldBankObservation[] : [];
        return [indicator, rows] as const;
      }));
      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt,
        data: { country, indicators: Object.fromEntries(pairs) },
        sources: indicators.map((indicator) => ({
          title: `World Bank ${indicator}`,
          url: `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}`,
          confidence: "high" as const,
        })),
      };
    } catch (err) {
      return {
        tool: this.name,
        status: err instanceof ToolTimeoutError ? "timeout" : "failed",
        provider: this.provider,
        retrievedAt,
        reason: err instanceof Error ? err.message : String(err),
        sources: [],
      };
    }
  },
};
