import type { TerminalWindowModel } from "../types";

export type AgentStatus = "running" | "idle" | "done" | "error" | "blocked" | "needs_review" | "has_question" | "waiting_for_human";

export function getAgentStatus(t: TerminalWindowModel): AgentStatus {
  if (t.waitingForHuman) return "waiting_for_human";
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
  running: "#56d364",         // matches --green
  idle: "#6e7681",            // matches --text-tertiary
  done: "#6e7681",            // matches --text-tertiary
  error: "#f87171",           // matches --red
  blocked: "#e3b341",         // matches --amber
  needs_review: "#6e94ff",    // matches --accent
  has_question: "#e3b341",    // matches --amber
  waiting_for_human: "#f87171", // matches --red (pulsing handled by CSS)
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  running: "Running",
  idle: "Idle",
  done: "Done",
  error: "Error",
  blocked: "Blocked",
  needs_review: "Needs Review",
  has_question: "Has Question",
  waiting_for_human: "Needs Input",
};
