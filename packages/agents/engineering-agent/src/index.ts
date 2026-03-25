export * from "./schemas.js";

export function createEngineeringAgentContract() {
  return {
    status: "skeleton",
    outputs: ["architecture plan", "technical risks", "system interfaces"]
  } as const;
}
