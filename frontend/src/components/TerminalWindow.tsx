import { useRef, useState, useCallback, type ReactNode } from "react";
import { MessageBar } from "./MessageBar";
import type { TerminalWindowModel } from "../types";

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
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onRename: (id: string, name: string) => void;
  zIndex: number;
  children: ReactNode;
  onArtifactClick?: (terminalId: string, fileName: string) => void;
  onPromote?: (terminalId: string) => void;
};

export function TerminalWindow({
  model,
  onMove,
  onResize,
  onClose,
  onFocus,
  onRename,
  zIndex,
  children,
  onArtifactClick,
  onPromote,
}: Props) {
  const dragState = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const resizeState = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const isCoordinator = model.tag === "coordinator";
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(model.title);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      onFocus(model.id);
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: model.x,
        originY: model.y,
      };

      const handlePointerMove = (ev: PointerEvent) => {
        if (!dragState.current) return;
        const dx = ev.clientX - dragState.current.startX;
        const dy = ev.clientY - dragState.current.startY;
        onMove(model.id, dragState.current.originX + dx, dragState.current.originY + dy);
      };

      const handlePointerUp = () => {
        dragState.current = null;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [model.id, model.x, model.y, onMove, onFocus]
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus(model.id);
      resizeState.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: model.width,
        startH: model.height,
      };

      const handlePointerMove = (ev: PointerEvent) => {
        if (!resizeState.current) return;
        const dx = ev.clientX - resizeState.current.startX;
        const dy = ev.clientY - resizeState.current.startY;
        const newW = Math.max(280, resizeState.current.startW + dx);
        const newH = Math.max(200, resizeState.current.startH + dy);
        onResize(model.id, newW, newH);
      };

      const handlePointerUp = () => {
        resizeState.current = null;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [model.id, model.width, model.height, onResize, onFocus]
  );

  return (
    <div
      className={`terminal-window${isCoordinator ? " terminal-window-coordinator" : ""}${model.exited ? " state-exited" : model.active ? " state-active" : " state-idle"}${model.needsAttention ? " state-attention" : ""}`}
      style={{
        left: model.x,
        top: model.y,
        width: model.width,
        height: model.height,
        zIndex,
      }}
      onPointerDown={() => onFocus(model.id)}
    >
      <div className="terminal-window-titlebar" onPointerDown={handlePointerDown}>
        <div className="terminal-window-title-area">
          {editingName && !isCoordinator ? (
            <input
              className="terminal-window-title-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => {
                const trimmed = nameInput.trim();
                if (trimmed && trimmed !== model.title) onRename(model.id, trimmed);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { setNameInput(model.title); setEditingName(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span
              className={`terminal-window-title${isCoordinator ? " terminal-window-title-coordinator" : ""}`}
              onClick={(e) => {
                if (!isCoordinator) { e.stopPropagation(); setEditingName(true); setNameInput(model.title); }
              }}
              title={!isCoordinator ? "Click to rename" : undefined}
            >
              {model.title}
            </span>
          )}
        </div>
        {(model.unreadCount ?? 0) > 0 && (
          <span className="terminal-window-badge">{model.unreadCount}</span>
        )}
        {!isCoordinator && model.mode !== "role" && !model.promoted && !model.exited && (
          <button
            className="terminal-window-pin-btn"
            onClick={(e) => { e.stopPropagation(); onPromote?.(model.id); }}
            title="Pin — keep this terminal after refresh"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M7 1L10 4L6.5 5.5L5 9L2 6L3.5 4.5L1 1L7 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <line x1="2" y1="9" x2="0.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        )}
        {!isCoordinator && model.promoted && (
          <span className="terminal-window-pinned" title="Pinned — persists after refresh">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M7 1L10 4L6.5 5.5L5 9L2 6L3.5 4.5L1 1L7 1Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <line x1="2" y1="9" x2="0.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </span>
        )}
        {!isCoordinator && (
          <button
            className="terminal-window-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose(model.id);
            }}
            title="Close"
          >
            ×
          </button>
        )}
      </div>
      <MessageBar messages={model.messages ?? []} />
      <div className="terminal-window-body">
        {children}
        {model.exited && (
          <div className="terminal-window-exited">
            process exited · code {model.exitCode}
          </div>
        )}
      </div>
      {model.artifacts && model.artifacts.length > 0 && (
        <div className="terminal-window-artifact-bar" onPointerDown={(e) => e.stopPropagation()}>
          {(showAllArtifacts ? model.artifacts : model.artifacts.slice(0, 3)).map((f) => (
            <button
              key={f.name}
              className={`artifact-pill${(model.openArtifacts ?? []).some((a) => a.fileName === f.name) ? " artifact-pill-active" : ""}`}
              onClick={() => onArtifactClick?.(model.id, f.name)}
            >
              <span className="artifact-pill-icon">{fileTypeIcon(f.name)}</span>
              <span className="artifact-pill-name">{f.name}</span>
            </button>
          ))}
          {model.artifacts.length > 3 && (
            <button
              className="artifact-pill-overflow"
              onClick={() => setShowAllArtifacts(!showAllArtifacts)}
              title={showAllArtifacts ? "Show less" : "Show all artifacts"}
            >
              {showAllArtifacts ? "−" : `+${model.artifacts.length - 3}`}
            </button>
          )}
        </div>
      )}
      <div
        className="terminal-window-resize"
        onPointerDown={handleResizePointerDown}
      />
    </div>
  );
}
