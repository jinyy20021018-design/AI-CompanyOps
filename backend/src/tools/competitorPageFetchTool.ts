import { fetchText, ToolTimeoutError } from "./httpClient.js";
import type { AgentTool, InjectedToolResult, ToolContext } from "./toolTypes.js";

export type CompetitorPageFetchInput = {
  urls?: string[];
  extract?: "pricing" | "positioning" | "features" | "cta" | "general";
};

export type CompetitorPageFetchOutput = {
  pages: Array<{
    url: string;
    textSummary: string;
    extractedFacts: Array<{ label: string; value: string; confidence: "low" | "medium" | "high" }>;
  }>;
};

function sanitizeText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/ignore previous instructions|forget your role|system prompt/gi, "[removed-prompt-injection-risk]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

function extractFacts(text: string, mode: string): Array<{ label: string; value: string; confidence: "low" | "medium" | "high" }> {
  const facts: Array<{ label: string; value: string; confidence: "low" | "medium" | "high" }> = [];
  const priceMatches = text.match(/[$€£]\s?\d+(?:[.,]\d+)?(?:\s?\/\s?(?:mo|month|yr|year))?/gi) ?? [];
  for (const price of [...new Set(priceMatches)].slice(0, 8)) {
    facts.push({ label: "detected_price", value: price, confidence: mode === "pricing" ? "medium" : "low" });
  }
  const contactSales = /contact sales|talk to sales|request demo/i.test(text);
  if (contactSales) facts.push({ label: "sales_motion", value: "contact_sales_or_demo", confidence: "medium" });
  return facts;
}

export const competitorPageFetchTool: AgentTool<CompetitorPageFetchInput, CompetitorPageFetchOutput> = {
  name: "competitor_page_fetch",
  provider: "jina_reader",
  description: "Fetch competitor pages through Jina Reader and extract lightweight facts.",
  defaultTimeoutMs: 15000,
  availability() {
    return { available: true };
  },
  async execute(input: CompetitorPageFetchInput, _ctx: ToolContext): Promise<InjectedToolResult<CompetitorPageFetchOutput>> {
    const urls = (input.urls ?? []).filter((url) => /^https?:\/\//i.test(url)).slice(0, 5);
    const retrievedAt = new Date().toISOString();
    if (urls.length === 0) {
      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt,
        data: { pages: [] },
        reason: "no_candidate_urls",
        sources: [],
      };
    }
    try {
      const pages = await Promise.all(urls.map(async (url) => {
        const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
        const raw = await fetchText(readerUrl, { timeoutMs: this.defaultTimeoutMs });
        const text = sanitizeText(raw);
        return {
          url,
          textSummary: text.slice(0, 1200),
          extractedFacts: extractFacts(text, input.extract ?? "general"),
        };
      }));
      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt,
        data: { pages },
        sources: pages.map((p) => ({ title: "Competitor page via Jina Reader", url: p.url, confidence: "medium" as const })),
      };
    } catch (err) {
      return {
        tool: this.name,
        status: err instanceof ToolTimeoutError ? "timeout" : "failed",
        provider: this.provider,
        retrievedAt,
        reason: err instanceof Error ? err.message : String(err),
        sources: urls.map((url) => ({ title: "Competitor page via Jina Reader", url, confidence: "low" as const })),
      };
    }
  },
};
