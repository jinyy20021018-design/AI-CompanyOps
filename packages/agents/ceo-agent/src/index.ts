export * from "./schemas.js";

export function createCeoAgentContract() {
  return {
    status: "skeleton",
    responsibilities: [
      "interpret user requests",
      "decompose cross-agent tasks",
      "coordinate downstream agents",
      "aggregate final proposal"
    ]
  } as const;
}
