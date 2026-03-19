import { useEffect, useState } from "react";
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

type OpenArtifact = { fileName: string; content: string | null };

type Props = {
  terminal: TerminalWindowModel;
  onRename: (id: string, name: string) => void;
  onPromote: (id: string) => void;
  onBack: () => void;
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
  theme?: "dark" | "light";
};

export function FocusView({ terminal, onRename, onPromote, onBack, send, addHandler, theme }: Props) {
  const [openArtifacts, setOpenArtifacts] = useState<OpenArtifact[]>([]);
  const [activeArtifactName, setActiveArtifactName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(terminal.title);
  const status = getAgentStatus(terminal);
  const dotColor = STATUS_COLORS[status];

  // Listen for artifact content responses
  useEffect(() => {
    return addHandler((msg: ServerMessage) => {
      if (msg.type === "artifact:content" && msg.terminalId === terminal.id) {
        setOpenArtifacts((prev) =>
          prev.map((a) => a.fileName === msg.fileName ? { ...a, content: msg.content } : a)
        );
      }
    });
  }, [terminal.id, addHandler]);

  // Close all artifact panels when switching terminals
  useEffect(() => {
    setOpenArtifacts([]);
    setActiveArtifactName(null);
  }, [terminal.id]);

  const handleArtifactToggle = (fileName: string) => {
    setOpenArtifacts((prev) => {
      const exists = prev.find((a) => a.fileName === fileName);
      if (exists) {
        // Already open — just activate
        setActiveArtifactName(fileName);
        return prev;
      }
      setActiveArtifactName(fileName);
      send({ type: "artifact:read", terminalId: terminal.id, fileName });
      return [...prev, { fileName, content: null }];
    });
  };

  const handleArtifactTabClose = (fileName: string) => {
    setOpenArtifacts((prev) => {
      const remaining = prev.filter((a) => a.fileName !== fileName);
      if (activeArtifactName === fileName) {
        setActiveArtifactName(remaining[remaining.length - 1]?.fileName ?? null);
      }
      return remaining;
    });
  };

  const activeArtifact = openArtifacts.find((a) => a.fileName === activeArtifactName) ?? null;

  return (
    <div className="focus-view">
      {/* Header */}
      <div className="focus-header">
        <button className="focus-header-back" onClick={onBack} title="Back to overview">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span
          className={`focus-header-dot${status === "running" ? " pulse" : ""}`}
          style={{ background: dotColor }}
        />
        <span className="focus-header-status">{STATUS_LABELS[status]}</span>
        {editing ? (
          <input
            className="focus-header-name-input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={() => {
              const trimmed = nameInput.trim();
              if (trimmed && trimmed !== terminal.title) onRename(terminal.id, trimmed);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { setNameInput(terminal.title); setEditing(false); }
            }}
            autoFocus
          />
        ) : (
          <span
            className="focus-header-name"
            onClick={() => { if (terminal.tag !== "coordinator") { setEditing(true); setNameInput(terminal.title); } }}
            title={terminal.tag !== "coordinator" ? "Click to rename" : undefined}
          >
            {terminal.title}
          </span>
        )}
        {terminal.provider && (
          <span className="focus-header-model">{terminal.provider}</span>
        )}
        {terminal.tag !== "coordinator" && terminal.mode !== "role" && !terminal.promoted && !terminal.exited && (
          <button className="focus-header-pin" onClick={() => onPromote(terminal.id)} title="Pin — keep after refresh">
            Pin
          </button>
        )}
        {terminal.tag !== "coordinator" && terminal.promoted && (
          <span className="focus-header-pinned" title="Pinned — persists after refresh">Pinned</span>
        )}
      </div>

      {/* Message bar */}
      <MessageBar messages={terminal.messages ?? []} />

      {/* Body: terminal + optional artifact side panel */}
      <div className="focus-body">
        <div className="focus-terminal">
          <TerminalPane terminalId={terminal.id} send={send} addHandler={addHandler} theme={theme} />
        </div>
        {openArtifacts.length > 0 && (
          <div className="focus-artifact-panel">
            {/* Tab bar */}
            <div className="focus-artifact-tabbar">
              {openArtifacts.map((a) => (
                <div
                  key={a.fileName}
                  className={`focus-artifact-tab${a.fileName === activeArtifactName ? " focus-artifact-tab-active" : ""}`}
                  onClick={() => setActiveArtifactName(a.fileName)}
                >
                  <span className="focus-artifact-tab-name">{a.fileName}</span>
                  <button
                    className="focus-artifact-tab-close"
                    onClick={(e) => { e.stopPropagation(); handleArtifactTabClose(a.fileName); }}
                  >×</button>
                </div>
              ))}
            </div>
            {/* Content */}
            <div className="focus-artifact-content">
              {activeArtifact === null ? null : activeArtifact.content === null ? (
                <span className="focus-artifact-loading">Loading...</span>
              ) : (
                <pre>{activeArtifact.content}</pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Artifact pills footer */}
      {terminal.artifacts && terminal.artifacts.length > 0 && (
        <div className="focus-footer">
          {terminal.artifacts.slice(0, 5).map((f) => (
            <button
              key={f.name}
              className={`artifact-pill${openArtifacts.some((a) => a.fileName === f.name) ? " artifact-pill-active" : ""}`}
              onClick={() => handleArtifactToggle(f.name)}
            >
              <span className="artifact-pill-icon">{fileTypeIcon(f.name)}</span>
              <span className="artifact-pill-name">{f.name}</span>
            </button>
          ))}
          {terminal.artifacts.length > 5 && (
            <span className="artifact-pill-overflow">+{terminal.artifacts.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}
