import type { InjectedToolResult } from "../../tools/toolTypes.js";

export type FinanceScenario = {
  developmentCostUsd: number | null;
  marketingSpendUsd: number | null;
  monthlyInfraUsd: number | null;
  cacUsd: number | null;
  ltvUsd: number | null;
  paybackMonths: number | null;
  confidence: "low" | "medium" | "high";
};

export type FinanceModel = {
  generatedAt: string;
  currency: "USD";
  scenarios: {
    conservative: FinanceScenario;
    base: FinanceScenario;
    optimistic: FinanceScenario;
  };
  assumptions: Array<{
    name: string;
    value: string | number | null;
    source: "api" | "estimate" | "prd" | "gtm" | "architecture" | "market_evidence";
    confidence: "low" | "medium" | "high";
  }>;
  sensitivityAnalysis: Array<{
    variable: string;
    change: string;
    expectedImpact: string;
  }>;
  dataGaps: string[];
};

function findUsdAmount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = match[1]?.replace(/[,$\s]/g, "");
    const value = raw ? Number(raw) : NaN;
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function findPercent(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isFinite(value)) return value / 100;
  }
  return null;
}

function scale(value: number | null, multiplier: number): number | null {
  return value === null ? null : Math.round(value * multiplier);
}

export function buildFinanceModelFromToolResults(results: InjectedToolResult[], contextText = ""): FinanceModel {
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const dataGaps = results
    .filter((r) => r.status !== "fulfilled" || r.reason)
    .map((r) => `${r.tool}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);

  const hasMacro = fulfilled.some((r) => r.tool === "fred_series" || r.tool === "world_bank_indicator");
  const hasDocumentNumbers = /\$|usd|cac|ltv|infra|infrastructure|marketing spend|development cost/i.test(contextText);
  const confidence = hasMacro || hasDocumentNumbers ? "medium" : "low";
  const developmentCost = findUsdAmount(contextText, [
    /(?:development|dev|engineering)[^\n$]{0,80}\$\s?([\d,]+(?:\.\d+)?)/i,
    /\$\s?([\d,]+(?:\.\d+)?)[^\n]{0,80}(?:development|dev|engineering)/i,
  ]);
  const marketingSpend = findUsdAmount(contextText, [
    /(?:marketing|paid|performance|ad)[^\n$]{0,80}\$\s?([\d,]+(?:\.\d+)?)/i,
    /\$\s?([\d,]+(?:\.\d+)?)[^\n]{0,80}(?:marketing|paid|performance|ad)/i,
  ]);
  const infraCost = findUsdAmount(contextText, [
    /(?:infra|infrastructure|cloud|hosting)[^\n$]{0,80}\$\s?([\d,]+(?:\.\d+)?)/i,
    /\$\s?([\d,]+(?:\.\d+)?)[^\n]{0,80}(?:infra|infrastructure|cloud|hosting)/i,
  ]);
  const cac = findUsdAmount(contextText, [
    /CAC[^\n$]{0,80}\$\s?([\d,]+(?:\.\d+)?)/i,
    /\$\s?([\d,]+(?:\.\d+)?)[^\n]{0,80}CAC/i,
  ]);
  const ltv = findUsdAmount(contextText, [
    /LTV[^\n$]{0,80}\$\s?([\d,]+(?:\.\d+)?)/i,
    /\$\s?([\d,]+(?:\.\d+)?)[^\n]{0,80}LTV/i,
  ]);
  const grossMargin = findPercent(contextText, [
    /gross margin[^\n\d]{0,40}(\d+(?:\.\d+)?)\s?%/i,
  ]);
  const baseScenario: FinanceScenario = {
    developmentCostUsd: developmentCost,
    marketingSpendUsd: marketingSpend,
    monthlyInfraUsd: infraCost,
    cacUsd: cac,
    ltvUsd: ltv,
    paybackMonths: cac && ltv && ltv > 0 ? Math.ceil((cac / ltv) * 12) : null,
    confidence,
  };

  return {
    generatedAt: new Date().toISOString(),
    currency: "USD",
    scenarios: {
      conservative: {
        developmentCostUsd: scale(baseScenario.developmentCostUsd, 1.2),
        marketingSpendUsd: scale(baseScenario.marketingSpendUsd, 1.2),
        monthlyInfraUsd: scale(baseScenario.monthlyInfraUsd, 1.5),
        cacUsd: scale(baseScenario.cacUsd, 1.3),
        ltvUsd: scale(baseScenario.ltvUsd, 0.8),
        paybackMonths: baseScenario.paybackMonths === null ? null : Math.ceil(baseScenario.paybackMonths * 1.5),
        confidence,
      },
      base: baseScenario,
      optimistic: {
        developmentCostUsd: scale(baseScenario.developmentCostUsd, 0.9),
        marketingSpendUsd: scale(baseScenario.marketingSpendUsd, 0.9),
        monthlyInfraUsd: scale(baseScenario.monthlyInfraUsd, 0.8),
        cacUsd: scale(baseScenario.cacUsd, 0.8),
        ltvUsd: scale(baseScenario.ltvUsd, 1.25),
        paybackMonths: baseScenario.paybackMonths === null ? null : Math.max(1, Math.floor(baseScenario.paybackMonths * 0.75)),
        confidence,
      },
    },
    assumptions: [
      ...fulfilled.map((r) => ({
        name: `${r.tool} data available`,
        value: r.sources.length,
        source: "api" as const,
        confidence: r.sources.some((s) => s.confidence === "high") ? "high" as const : "medium" as const,
      })),
      ...(developmentCost !== null ? [{ name: "development cost", value: developmentCost, source: "architecture" as const, confidence: "medium" as const }] : []),
      ...(marketingSpend !== null ? [{ name: "marketing spend", value: marketingSpend, source: "gtm" as const, confidence: "medium" as const }] : []),
      ...(infraCost !== null ? [{ name: "monthly infrastructure cost", value: infraCost, source: "architecture" as const, confidence: "medium" as const }] : []),
      ...(cac !== null ? [{ name: "CAC", value: cac, source: "gtm" as const, confidence: "medium" as const }] : []),
      ...(ltv !== null ? [{ name: "LTV", value: ltv, source: "estimate" as const, confidence: "low" as const }] : []),
      ...(grossMargin !== null ? [{ name: "gross margin", value: grossMargin, source: "estimate" as const, confidence: "low" as const }] : []),
    ],
    sensitivityAnalysis: [
      { variable: "CAC", change: "+30%", expectedImpact: "Payback period increases; validate paid acquisition assumptions." },
      { variable: "Conversion", change: "-20%", expectedImpact: "Revenue ramp slows; break-even may move out by one or more quarters." },
      { variable: "Infrastructure", change: "+50%", expectedImpact: "Gross margin compresses; validate architecture cost drivers." },
      { variable: "Launch date", change: "+1 quarter", expectedImpact: "Revenue delayed while burn continues; runway requirement increases." },
    ],
    dataGaps,
  };
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

export function renderAssumptionsYaml(model: FinanceModel): string {
  const lines = [
    "# coagent-finance-assumptions v1",
    `generatedAt: ${yamlScalar(model.generatedAt)}`,
    `currency: ${model.currency}`,
    "assumptions:",
  ];
  if (model.assumptions.length === 0) {
    lines.push("  []");
  } else {
    for (const assumption of model.assumptions) {
      lines.push(`  - name: ${yamlScalar(assumption.name)}`);
      lines.push(`    value: ${yamlScalar(assumption.value)}`);
      lines.push(`    source: ${assumption.source}`);
      lines.push(`    confidence: ${assumption.confidence}`);
    }
  }
  lines.push("dataGaps:");
  if (model.dataGaps.length === 0) {
    lines.push("  []");
  } else {
    for (const gap of model.dataGaps) lines.push(`  - ${yamlScalar(gap)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderFinanceMarkdown(model: FinanceModel): string {
  const scenarioRows = Object.entries(model.scenarios).map(([name, scenario]) =>
    `| ${name} | ${scenario.developmentCostUsd ?? "TBD"} | ${scenario.marketingSpendUsd ?? "TBD"} | ${scenario.monthlyInfraUsd ?? "TBD"} | ${scenario.cacUsd ?? "TBD"} | ${scenario.ltvUsd ?? "TBD"} | ${scenario.paybackMonths ?? "TBD"} | ${scenario.confidence} |`
  );
  return [
    "# Financial Model",
    "",
    "Generated by the CoAgent finance runtime from concurrent external tool injection. This native artifact is a structured draft; the Finance terminal agent may still produce the final narrative report.",
    "",
    "## Scenario Summary",
    "",
    "| Scenario | Dev cost USD | Marketing spend USD | Monthly infra USD | CAC USD | LTV USD | Payback months | Confidence |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...scenarioRows,
    "",
    "## Data Gaps",
    "",
    ...(model.dataGaps.length ? model.dataGaps.map((gap) => `- ${gap}`) : ["- None reported by tool injection."]),
    "",
    "## Human Review Required",
    "",
    "- Review all TBD values before approval.",
    "- Treat skipped, failed, and timed-out API tools as missing evidence, not as zero values.",
    "",
    "```yaml",
    "# coagent-finance-summary v1",
    "currency: USD",
    `scenarios: ${JSON.stringify(model.scenarios)}`,
    "notes: \"External API data is best-effort; use null/TBD for unknown values.\"",
    "```",
    "",
  ].join("\n");
}
