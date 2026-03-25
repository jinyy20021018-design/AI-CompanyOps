export * from "./schemas.js";

export function createFinanceAgentContract() {
  return {
    status: "skeleton",
    outputs: ["market strategy", "budget model", "roi analysis"]
  } as const;
}
