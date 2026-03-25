import { config as loadDotenv } from "dotenv";
import type { ReviewRuntimeConfig } from "../../../packages/qa-agent/src/internalTypes.js";

export interface AppEnv extends ReviewRuntimeConfig {
  port: number;
}

export function loadEnv(): AppEnv {
  loadDotenv();

  return {
    llmProvider: process.env.QA_LLM_PROVIDER,
    llmModel: process.env.QA_LLM_MODEL,
    port: Number(process.env.PORT ?? "3000")
  };
}
