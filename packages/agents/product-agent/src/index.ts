export * from "./schemas.js";

export function createProductAgentContract() {
  return {
    status: "skeleton",
    outputs: ["prd", "feature definitions", "acceptance criteria"]
  } as const;
}
