import { AgentChip } from "./AgentChip";
import { getAgentStatus, STATUS_COLORS } from "../utils/agentStatus";
import type { TerminalWindowModel } from "../types";

type Props = {
  coordinator: TerminalWindowModel | null;
  agents: TerminalWindowModel[];
  focusedTerminalId: string | null;
  onAgentClick: (id: string) => void;
  onCoordinatorClick: () => void;
  onNewAgent: () => void;
};

export function CoordinatorBar({ coordinator, agents, focusedTerminalId, onAgentClick, onCoordinatorClick, onNewAgent }: Props) {
  const coordStatus = coordinator ? getAgentStatus(coordinator) : "idle";
  const coordDotColor = coordinator ? STATUS_COLORS[coordStatus] : "#545775";

  const doneCount = agents.filter((a) => {
    const s = getAgentStatus(a);
    return s === "done";
  }).length;

  const blockedCount = agents.filter((a) => a.hasBlocker).length;
  const questionCount = agents.filter((a) => a.pendingQuestions && a.pendingQuestions > 0).length;

  return (
    <div className="coordinator-bar">
      {/* Info row */}
      <div className="coordinator-bar-info">
        <div
          className="coordinator-bar-info-left"
          style={{ cursor: coordinator ? "pointer" : undefined }}
          onClick={() => { if (coordinator) onCoordinatorClick(); }}
        >
          <span
            className={`coordinator-bar-dot${coordStatus === "running" ? " pulse" : ""}`}
            style={{ background: coordDotColor }}
          />
          <span className="coordinator-bar-label">COORDINATOR</span>
          {coordinator?.title && (
            <span className="coordinator-bar-name">{coordinator.title}</span>
          )}
          {coordinator?.provider && (
            <span className="coordinator-bar-model">{coordinator.provider}</span>
          )}
          {coordinator && (coordinator.unreadCount ?? 0) > 0 && (
            <span className="coordinator-bar-badge">{coordinator.unreadCount}</span>
          )}
        </div>
        <div className="coordinator-bar-spacer" />
      </div>

      {/* Agent strip + inline progress */}
      <div className="agent-strip">
        {agents.map((a) => (
          <AgentChip
            key={a.id}
            model={a}
            isSelected={a.id === focusedTerminalId}
            onClick={() => onAgentClick(a.id)}
          />
        ))}
        <button className="agent-strip-add" onClick={onNewAgent} title="Spawn new agent">
          + New agent
        </button>
        {agents.length > 0 && (
          <div className="coordinator-bar-progress-inline">
            {blockedCount > 0 && (
              <span className="coordinator-bar-stat coordinator-bar-stat-blocked">{blockedCount} blocked</span>
            )}
            {questionCount > 0 && (
              <span className="coordinator-bar-stat coordinator-bar-stat-question">{questionCount} questions</span>
            )}
            <div className="coordinator-bar-progress-bar">
              <div
                className="coordinator-bar-progress-fill"
                style={{ width: `${(doneCount / agents.length) * 100}%` }}
              />
            </div>
            <span className="coordinator-bar-progress-text">
              {doneCount}/{agents.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
