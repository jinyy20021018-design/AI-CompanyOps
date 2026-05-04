import { fetchJson, ToolTimeoutError } from "./httpClient.js";
import type { AgentTool, InjectedToolResult, ToolContext } from "./toolTypes.js";

export type FredInput = {
  seriesIds?: string[];
};

type FredObservation = {
  date: string;
  value: string;
};

export type FredOutput = {
  series: Record<string, Array<{ date: string; value: number | null }>>;
};

export const fredTool: AgentTool<FredInput, FredOutput> = {
  name: "fred_series",
  provider: "fred",
  description: "Fetch macroeconomic time series from FRED.",
  defaultTimeoutMs: 10000,
  availability() {
    return process.env.FRED_API_KEY ? { available: true } : { available: false, reason: "missing_api_key" };
  },
  async execute(input: FredInput, _ctx: ToolContext): Promise<InjectedToolResult<FredOutput>> {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) {
      return {
        tool: this.name,
        status: "skipped",
        provider: this.provider,
        retrievedAt: new Date().toISOString(),
        reason: "missing_api_key",
        sources: [],
      };
    }
    const seriesIds = input.seriesIds?.length ? input.seriesIds : ["FEDFUNDS", "CPIAUCSL", "DGS10"];
    const retrievedAt = new Date().toISOString();
    try {
      const pairs = await Promise.all(seriesIds.map(async (seriesId) => {
        const url = new URL("https://api.stlouisfed.org/fred/series/observations");
        url.searchParams.set("series_id", seriesId);
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("file_type", "json");
        url.searchParams.set("sort_order", "desc");
        url.searchParams.set("limit", "12");
        const json = await fetchJson<{ observations?: FredObservation[] }>(url.toString(), { timeoutMs: this.defaultTimeoutMs });
        const rows = (json.observations ?? []).map((o) => ({ date: o.date, value: o.value === "." ? null : Number(o.value) }));
        return [seriesId, rows] as const;
      }));
      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt,
        data: { series: Object.fromEntries(pairs) },
        sources: seriesIds.map((seriesId) => ({
          title: `FRED ${seriesId}`,
          url: `https://fred.stlouisfed.org/series/${seriesId}`,
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
        sources: seriesIds.map((seriesId) => ({
          title: `FRED ${seriesId}`,
          url: `https://fred.stlouisfed.org/series/${seriesId}`,
          confidence: "medium" as const,
        })),
      };
    }
  },
};
