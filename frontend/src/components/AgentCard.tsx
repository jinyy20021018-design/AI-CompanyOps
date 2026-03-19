import { useState } from "react";
import { TerminalPane } from "./TerminalPane";
import { MessageBar } from "./MessageBar";
import { getAgentStatus, STATUS_COLORS, STATUS_LABELS } from "../utils/agentStatus";
import type { TerminalWindowModel, ClientMessage, ServerMessage } from "../types";

function fileTypeIcon(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const map: Record<string, string> = {
    ts: "TS", tsx: "TX", js: "JS", jsx: "JX", json: "{}", md: "MD",
    py: "PY", rs: "RS", go: "GO", sh: "SH", yaml: "YM", yml: "YM",
    toml: "TM", css: "CS", html: "HT", sql: "SQ", txt: "TX",
  };
  return map[ext] ?? (ext.slice(0, 2).toUpperCase() || "F");
}

type Props = {
  model: TerminalWindowModel;
  isFocused: boolean;
  viewMode: "overview" | "focus";
  onClick: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onPromote: (id: string) => void;
  onArtifactClick: (terminalId: string, fileName: string) => void;
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
  theme?: "dark" | "light";
};

export function AgentCard({ model, isFocused, viewMode, onClick, onClose, onRename, onPromote, onArtifactClick, send, addHandler, theme }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(model.title);
  const status = getAgentStatus(model);
  const dotColor = STATUS_COLORS[status];
  const skipTerminal = isFocused && viewMode === "focus";

  return (
    <div
      className={`agent-card${isFocused ? " agent-card-selected" : ""}`}
      style={{ borderLeftColor: dotColor }}
      onClick={onClick}
    >
      {/* Header */}
      <div className="agent-card-header">
        <span
          className={`agent-card-dot${status === "running" ? " pulse" : ""}`}
          style={{ background: dotColor }}
        />
        <span className="agent-card-status">{STATUS_LABELS[status]}</span>
        {editing ? (
          <input
            className="agent-card-name-input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={() => {
              const trimmed = nameInput.trim();
              if (trimmed && trimmed !== model.title) onRename(model.id, trimmed);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.currentTarget.blur(); }
              if (e.key === "Escape") { setNameInput(model.title); setEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span
            className="agent-card-name"
            onClick={(e) => { e.stopPropagation(); if (model.tag !== "coordinator") { setEditing(true); setNameInput(model.title); } }}
            title={model.tag !== "coordinator" ? "Click to rename" : undefined}
          >
            {model.title}
          </span>
        )}
        <div className="agent-card-spacer" />
        <button
          className="agent-card-chevron"
          onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
          title={expanded ? "Collapse" : "Expand"}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d={expanded ? "M2 3l3 4 3-4" : "M3 2l4 3-4 3"} fill="currentColor" />
          </svg>
        </button>
      </div>

      {/* Message bar */}
      <MessageBar messages={model.messages ?? []} />

      {/* Body: terminal preview */}
      <div
        className="agent-card-body"
        style={{ display: expanded ? "block" : "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        {!skipTerminal && (
          <TerminalPane terminalId={model.id} send={send} addHandler={addHandler} theme={theme} />
        )}
      </div>

      {/* Artifact strip */}
      {model.artifacts && model.artifacts.length > 0 && (
        <div className="artifact-strip">
          {model.artifacts.slice(0, 3).map((f) => (
            <button
              key={f.name}
              className="artifact-pill"
              onClick={(e) => {
                e.stopPropagation();
                onArtifactClick(model.id, f.name);
              }}
            >
              <span className="artifact-pill-icon">{fileTypeIcon(f.name)}</span>
              <span className="artifact-pill-name">{f.name}</span>
            </button>
          ))}
          {model.artifacts.length > 3 && (
            <span className="artifact-pill-overflow">+{model.artifacts.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="agent-card-footer">
        {model.tag !== "coordinator" && (
          <>
            {model.mode !== "role" && !model.promoted && !model.exited && (
              <button
                className="agent-card-pin"
                onClick={(e) => { e.stopPropagation(); onPromote(model.id); }}
                title="Pin — keep after refresh"
              >
                Pin
              </button>
            )}
            {model.promoted && (
              <span className="agent-card-pinned" title="Pinned — persists after refresh">Pinned</span>
            )}
            {!model.exited && (
              <button
                className="agent-card-kill"
                onClick={(e) => {
                  e.stopPropagation();
                  send({ type: "terminal:input", terminalId: model.id, data: "\x03" });
                }}
                title="Send Ctrl+C"
              >
                Kill
              </button>
            )}
            <button
              className="agent-card-close"
              onClick={(e) => { e.stopPropagation(); onClose(model.id); }}
              title="Close terminal"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
