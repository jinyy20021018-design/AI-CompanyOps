import { fetchJson, postJson, ToolTimeoutError } from "./httpClient.js";
import type { AgentTool, InjectedToolResult, ToolContext } from "./toolTypes.js";

export type WebSearchInput = {
  query: string;
  maxResults?: number;
};

export type WebSearchOutput = {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
  }>;
};

type TavilyResponse = {
  results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>;
};

type BraveResponse = {
  web?: {
    results?: Array<{ title?: string; url?: string; description?: string; page_age?: string }>;
  };
};

export const webSearchTool: AgentTool<WebSearchInput, WebSearchOutput> = {
  name: "web_search",
  provider: process.env.WEB_SEARCH_PROVIDER === "brave" ? "brave" : "tavily",
  description: "Search the web for market and competitor evidence.",
  defaultTimeoutMs: 12000,
  availability() {
    if (process.env.WEB_SEARCH_PROVIDER === "brave") {
      return process.env.BRAVE_SEARCH_API_KEY ? { available: true } : { available: false, reason: "missing_api_key" };
    }
    if (process.env.TAVILY_API_KEY) return { available: true };
    if (process.env.BRAVE_SEARCH_API_KEY) return { available: true };
    return { available: false, reason: "missing_api_key" };
  },
  async execute(input: WebSearchInput, _ctx: ToolContext): Promise<InjectedToolResult<WebSearchOutput>> {
    const query = input.query || "startup market competitor pricing benchmark";
    const maxResults = input.maxResults ?? 5;
    const retrievedAt = new Date().toISOString();
    const useBrave = process.env.WEB_SEARCH_PROVIDER === "brave" || (!process.env.TAVILY_API_KEY && !!process.env.BRAVE_SEARCH_API_KEY);
    try {
      if (useBrave) {
        const key = process.env.BRAVE_SEARCH_API_KEY;
        if (!key) throw new Error("missing_api_key");
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(maxResults));
        const json = await fetchJson<BraveResponse>(url.toString(), {
          timeoutMs: this.defaultTimeoutMs,
          headers: { Accept: "application/json", "X-Subscription-Token": key },
        });
        const results = (json.web?.results ?? []).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.description ?? "",
          publishedAt: r.page_age,
        })).filter((r) => r.url);
        return {
          tool: this.name,
          status: "fulfilled",
          provider: "brave",
          retrievedAt,
          data: { query, results },
          sources: results.map((r) => ({ title: r.title, url: r.url, confidence: "medium" as const })),
        };
      }

      const key = process.env.TAVILY_API_KEY;
      if (!key) throw new Error("missing_api_key");
      const json = await postJson<TavilyResponse>("https://api.tavily.com/search", {
        query,
        max_results: maxResults,
        search_depth: "basic",
      }, {
        timeoutMs: this.defaultTimeoutMs,
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });
      const results = (json.results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
        publishedAt: r.published_date,
      })).filter((r) => r.url);
      return {
        tool: this.name,
        status: "fulfilled",
        provider: "tavily",
        retrievedAt,
        data: { query, results },
        sources: results.map((r) => ({ title: r.title, url: r.url, confidence: "medium" as const })),
      };
    } catch (err) {
      if (err instanceof Error && err.message === "missing_api_key") {
        return { tool: this.name, status: "skipped", provider: this.provider, retrievedAt, reason: "missing_api_key", sources: [] };
      }
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
