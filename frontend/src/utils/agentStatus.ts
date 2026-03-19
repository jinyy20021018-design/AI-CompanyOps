import type { TerminalWindowModel } from "../types";

export type AgentStatus = "running" | "idle" | "done" | "error" | "blocked" | "needs_review" | "has_question";

export function getAgentStatus(t: TerminalWindowModel): AgentStatus {
  if (t.hasBlocker) return "blocked";
  if (t.pendingQuestions && t.pendingQuestions > 0) return "has_question";
  if (t.hasArtifactReady) return "needs_review";
  if (t.exited) {
    return t.exitCode === 0 ? "done" : "error";
  }
  if (t.active) return "running";
  return "idle";
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  running: "#3dd68c",
  idle: "#545775",
  done: "#545775",
  error: "#f87171",
  blocked: "#f59e0b",
  needs_review: "#6e94ff",
  has_question: "#e3b341",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  running: "Running",
  idle: "Idle",
  done: "Done",
  error: "Error",
  blocked: "Blocked",
  needs_review: "Needs Review",
  has_question: "Has Question",
};
