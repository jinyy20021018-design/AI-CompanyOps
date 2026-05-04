import type { InjectedToolResult } from "../../tools/toolTypes.js";

export type MarketEvidence = {
  generatedAt: string;
  claims: Array<{
    claim: string;
    evidence: string;
    sourceUrl?: string;
    confidence: "low" | "medium" | "high";
    usedFor: string;
    requiresHumanReview: boolean;
  }>;
  dataGaps: string[];
};

export type CompetitorMatrix = {
  generatedAt: string;
  competitors: Array<{
    url: string;
    detectedPrices: string[];
    salesMotion?: string;
    confidence: "low" | "medium" | "high";
  }>;
};

export function buildMarketEvidence(results: InjectedToolResult[]): MarketEvidence {
  const claims: MarketEvidence["claims"] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    if (result.tool === "web_search" && typeof result.data === "object" && result.data !== null) {
      const data = result.data as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
      for (const item of (data.results ?? []).slice(0, 8)) {
        claims.push({
          claim: item.title || "Market search result",
          evidence: item.snippet || "Search result returned without snippet.",
          sourceUrl: item.url,
          confidence: "medium",
          usedFor: "market_research",
          requiresHumanReview: false,
        });
      }
    }
    if (result.tool === "world_bank_indicator") {
      claims.push({
        claim: "World Bank country indicators are available for market sizing context.",
        evidence: "World Bank data was fetched and should be used only as macro context.",
        sourceUrl: result.sources[0]?.url,
        confidence: "high",
        usedFor: "market_sizing_context",
        requiresHumanReview: false,
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    claims,
    dataGaps: results
      .filter((r) => r.status !== "fulfilled" || r.reason)
      .map((r) => `${r.tool}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`),
  };
}

export function buildCompetitorMatrix(results: InjectedToolResult[]): CompetitorMatrix {
  const fetchResult = results.find((r) => r.tool === "competitor_page_fetch" && r.status === "fulfilled");
  const pages = (fetchResult?.data as { pages?: Array<{ url: string; extractedFacts?: Array<{ label: string; value: string }> }> } | undefined)?.pages ?? [];
  return {
    generatedAt: new Date().toISOString(),
    competitors: pages.map((page) => ({
      url: page.url,
      detectedPrices: (page.extractedFacts ?? []).filter((f) => f.label === "detected_price").map((f) => f.value),
      salesMotion: (page.extractedFacts ?? []).find((f) => f.label === "sales_motion")?.value,
      confidence: "medium",
    })),
  };
}
