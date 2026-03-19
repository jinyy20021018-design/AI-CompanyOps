import type { TerminalWindowModel } from "../types";
import { getAgentStatus, STATUS_COLORS } from "../utils/agentStatus";

type Props = {
  model: TerminalWindowModel;
  isSelected: boolean;
  onClick: () => void;
  cost?: number;
};

function IntentIcons({ model }: { model: TerminalWindowModel }) {
  return (
    <>
      {model.hasBlocker && <span className="agent-chip-intent" title="Blocked">B</span>}
      {model.pendingQuestions && model.pendingQuestions > 0 && <span className="agent-chip-intent agent-chip-intent-question" title="Has question">?</span>}
      {model.hasHandoff && <span className="agent-chip-intent agent-chip-intent-handoff" title="Handoff pending">H</span>}
      {model.hasArtifactReady && <span className="agent-chip-intent agent-chip-intent-artifact" title="Artifact ready">A</span>}
    </>
  );
}

export function AgentChip({ model, isSelected, onClick, cost }: Props) {
  const status = getAgentStatus(model);
  const dotColor = STATUS_COLORS[status];

  return (
    <button
      className={`agent-chip${isSelected ? " agent-chip-selected" : ""}${model.promoted ? " agent-chip-promoted" : ""}`}
      onClick={onClick}
      title={model.title}
    >
      <span
        className={`agent-chip-dot${status === "running" ? " pulse" : ""}`}
        style={{ background: dotColor }}
      />
      <span className="agent-chip-name">{model.title}</span>
      <IntentIcons model={model} />
      {model.promoted && <span className="agent-chip-badge" title="Promoted">P</span>}
      {cost !== undefined && cost > 0 && (
        <span className="agent-chip-cost">${cost.toFixed(2)}</span>
      )}
    </button>
  );
}
