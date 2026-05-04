import { fetchJson, ToolTimeoutError } from "./httpClient.js";
import type { AgentTool, InjectedToolResult, ToolContext } from "./toolTypes.js";

export type SecEdgarInput = {
  ciks?: string[];
};

export type SecEdgarOutput = {
  companies: Array<{
    cik: string;
    entityName?: string;
    facts: Record<string, unknown>;
  }>;
};

function normalizeCik(cik: string): string {
  return cik.replace(/\D/g, "").padStart(10, "0").slice(-10);
}

export const secEdgarTool: AgentTool<SecEdgarInput, SecEdgarOutput> = {
  name: "sec_edgar_company_facts",
  provider: "sec_edgar",
  description: "Fetch public company facts from SEC EDGAR companyfacts.",
  defaultTimeoutMs: 12000,
  availability() {
    return process.env.SEC_USER_AGENT ? { available: true } : { available: false, reason: "missing_config" };
  },
  async execute(input: SecEdgarInput, _ctx: ToolContext): Promise<InjectedToolResult<SecEdgarOutput>> {
    const userAgent = process.env.SEC_USER_AGENT;
    const retrievedAt = new Date().toISOString();
    if (!userAgent) {
      return { tool: this.name, status: "skipped", provider: this.provider, retrievedAt, reason: "missing_config", sources: [] };
    }
    const ciks = (input.ciks ?? []).map(normalizeCik).filter(Boolean).slice(0, 3);
    if (ciks.length === 0) {
      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt,
        data: { companies: [] },
        reason: "no_candidate_ciks",
        sources: [],
      };
    }
    try {
      const companies = await Promise.all(ciks.map(async (cik) => {
        const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
        const json = await fetchJson<{ entityName?: string; facts?: Record<string, unknown> }>(url, {
          timeoutMs: this.defaultTimeoutMs,
          headers: { "User-Agent": userAgent, Accept: "application/json" },
        });
        return { cik, entityName: json.entityName, facts: json.facts ?? {} };
      }));
      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt,
        data: { companies },
        sources: ciks.map((cik) => ({ title: `SEC company facts CIK ${cik}`, url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, confidence: "high" as const })),
      };
    } catch (err) {
      return {
        tool: this.name,
        status: err instanceof ToolTimeoutError ? "timeout" : "failed",
        provider: this.provider,
        retrievedAt,
        reason: err instanceof Error ? err.message : String(err),
        sources: ciks.map((cik) => ({ title: `SEC company facts CIK ${cik}`, url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, confidence: "medium" as const })),
      };
    }
  },
};
