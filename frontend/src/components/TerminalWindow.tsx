import { useRef, useState, useCallback, type ReactNode } from "react";
import type { TerminalWindowModel } from "../types";

const ACCENT_COLORS = [
  "#7aa2f7",
  "#9ece6a",
  "#f7768e",
  "#e0af68",
  "#bb9af7",
  "#2ac3de",
  "#ff9e64",
  "#73daca",
];

function accentFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENT_COLORS[hash % ACCENT_COLORS.length];
}

type Props = {
  model: TerminalWindowModel;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onTagChange: (id: string, tag: string) => void;
  zIndex: number;
  children: ReactNode;
};

export function TerminalWindow({
  model,
  onMove,
  onResize,
  onClose,
  onFocus,
  onTagChange,
  zIndex,
  children,
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

  const [isEditingTag, setIsEditingTag] = useState(false);
  const [tagInput, setTagInput] = useState(model.tag ?? "");

  const accent = model.tag === "coordinator" ? "#2ac3de" : accentFor(model.pathId);

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

  const handleTagClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTag(true);
    setTagInput(model.tag ?? "");
  };

  const commitTag = () => {
    const trimmed = tagInput.trim();
    onTagChange(model.id, trimmed);
    setIsEditingTag(false);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTag();
    } else if (e.key === "Escape") {
      setIsEditingTag(false);
      setTagInput(model.tag ?? "");
    }
  };

  return (
    <div
      className={`terminal-window${model.tag === "coordinator" ? " terminal-window-coordinator" : ""}`}
      style={{
        left: model.x,
        top: model.y,
        width: model.width,
        height: model.height,
        zIndex,
        "--accent": accent,
      } as React.CSSProperties}
      onPointerDown={() => onFocus(model.id)}
    >
      <div className="terminal-window-titlebar" onPointerDown={handlePointerDown}>
        <div className="terminal-window-title-area">
          <span className={`terminal-window-title${model.tag === "coordinator" ? " terminal-window-title-coordinator" : ""}`}>
            {model.title}
          </span>
          {model.tag === "coordinator" ? (
            <span className="terminal-window-tag terminal-window-tag-coordinator">
              coordinator
            </span>
          ) : isEditingTag ? (
            <input
              type="text"
              className="terminal-window-tag-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onBlur={commitTag}
              onKeyDown={handleTagKeyDown}
              placeholder="tag (e.g. claude, codex)"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : model.tag ? (
            <span className="terminal-window-tag" onClick={handleTagClick}>
              {model.tag}
            </span>
          ) : (
            <span className="terminal-window-tag-placeholder" onClick={handleTagClick}>
              + tag
            </span>
          )}
        </div>
        {(model.unreadCount ?? 0) > 0 && (
          <span className="terminal-window-badge">{model.unreadCount}</span>
        )}
        {model.tag !== "coordinator" && (
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
      <div className="terminal-window-body">
        {children}
        {model.exited && (
          <div className="terminal-window-exited">
            ⬡ process exited · code {model.exitCode}
          </div>
        )}
      </div>
      <div
        className="terminal-window-resize"
        onPointerDown={handleResizePointerDown}
      />
    </div>
  );
}
