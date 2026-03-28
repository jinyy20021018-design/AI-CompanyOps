import { AgentCard } from "./AgentCard";
import type { TerminalWindowModel, ClientMessage, ServerMessage } from "../types";

type Props = {
  coordinator: TerminalWindowModel | null;
  agents: TerminalWindowModel[];
  focusedTerminalId: string | null;
  viewMode: "overview" | "focus";
  onAgentClick: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onPromote: (id: string) => void;
  onArtifactClick: (terminalId: string, fileName: string) => void;
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
  theme?: "dark" | "light";
};

export function OverviewGrid({ coordinator, agents, focusedTerminalId, viewMode, onAgentClick, onClose, onRename, onPromote, onArtifactClick, send, addHandler, theme }: Props) {
  if (!coordinator && agents.length === 0) {
    return (
      <div className="overview-grid-empty">
        Waiting for agents to spawn...
      </div>
    );
  }

  return (
    <div className="overview-split">
      {/* Coordinator — left panel, ~40% width */}
      {coordinator && (
        <div className="overview-coordinator">
          <AgentCard
            model={coordinator}
            isFocused={coordinator.id === focusedTerminalId}
            viewMode={viewMode}
            onClick={() => onAgentClick(coordinator.id)}
            onClose={onClose}
            onRename={onRename}
            onPromote={onPromote}
            onArtifactClick={onArtifactClick}
            send={send}
            addHandler={addHandler}
            theme={theme}
          />
        </div>
      )}

      {/* Workers — right panel, 2x2 grid */}
      {agents.length > 0 && (
        <div className="overview-workers">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              model={a}
              isFocused={a.id === focusedTerminalId}
              viewMode={viewMode}
              onClick={() => onAgentClick(a.id)}
              onClose={onClose}
              onRename={onRename}
              onPromote={onPromote}
              onArtifactClick={onArtifactClick}
              send={send}
              addHandler={addHandler}
              theme={theme}
            />
          ))}
        </div>
      )}
    </div>
  );
}
