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
  // Coordinator first (row 1 col 1), then agents
  const all = coordinator ? [coordinator, ...agents] : agents;

  if (all.length === 0) {
    return (
      <div className="overview-grid-empty">
        No agents yet. Use "+ New agent" above to spawn one.
      </div>
    );
  }

  return (
    <div className="overview-grid">
      {all.map((a) => (
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
  );
}
