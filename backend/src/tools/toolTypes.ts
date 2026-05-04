export type ToolTarget = "market" | "finance";
export type ToolStatus = "fulfilled" | "skipped" | "failed" | "timeout";
export type ToolConfidence = "low" | "medium" | "high";

export type ToolAvailability =
  | { available: true }
  | { available: false; reason: "missing_api_key" | "disabled" | "missing_config" };

export type ToolSource = {
  title?: string;
  url: string;
  confidence: ToolConfidence;
};

export type InjectedToolResult<T = unknown> = {
  tool: string;
  status: ToolStatus;
  provider: string;
  retrievedAt: string;
  data?: T;
  reason?: string;
  sources: ToolSource[];
};

export type ToolContext = {
  folderPath: string;
  workspaceDir: string;
  agentName: ToolTarget;
  requestId: string;
};

export type AgentTool<I = unknown, O = unknown> = {
  name: string;
  provider: string;
  description: string;
  defaultTimeoutMs: number;
  availability(): ToolAvailability;
  execute(input: I, ctx: ToolContext): Promise<InjectedToolResult<O>>;
};

export type ToolCall<I = unknown> = {
  toolName: string;
  input: I;
};
