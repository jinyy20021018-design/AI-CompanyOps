import type { AgentTool } from "./toolTypes.js";
import { webSearchTool } from "./webSearchTool.js";
import { competitorPageFetchTool } from "./competitorPageFetchTool.js";
import { exchangeRateTool } from "./exchangeRateTool.js";
import { fredTool } from "./fredTool.js";
import { worldBankTool } from "./worldBankTool.js";
import { secEdgarTool } from "./secEdgarTool.js";
import { alphaVantageTool } from "./alphaVantageTool.js";
import { currentWeatherTool } from "./currentWeatherTool.js";

export const toolRegistry: Record<string, AgentTool<any, any>> = {
  web_search: webSearchTool,
  competitor_page_fetch: competitorPageFetchTool,
  exchange_rate: exchangeRateTool,
  fred_series: fredTool,
  world_bank_indicator: worldBankTool,
  sec_edgar_company_facts: secEdgarTool,
  alpha_vantage: alphaVantageTool,
  current_weather: currentWeatherTool,
} satisfies Record<string, AgentTool<unknown, unknown>>;

export type ToolName = keyof typeof toolRegistry;
