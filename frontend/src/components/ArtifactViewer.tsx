import { useRef, useState, useCallback, useEffect } from "react";
import type { TerminalWindowModel } from "../types";

type OpenArtifact = { fileName: string; content: string | null };

type Props = {
  terminal: TerminalWindowModel;
  openArtifacts: OpenArtifact[];
  activeArtifactName: string;
  onActivate: (terminalId: string, fileName: string) => void;
  onClose: (terminalId: string, fileName: string) => void;
  onCloseAll: (terminalId: string) => void;
};

export function ArtifactViewer({ terminal, openArtifacts, activeArtifactName, onActivate, onClose, onCloseAll }: Props) {
  const initX = terminal.x + terminal.width + 16;
  const initY = terminal.y;
  const [pos, setPos] = useState({ x: initX, y: initY });
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      setPos({
        x: dragState.current.originX + ev.clientX - dragState.current.startX,
        y: dragState.current.originY + ev.clientY - dragState.current.startY,
      });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [pos.x, pos.y]);

  const contentRef = useRef<HTMLDivElement>(null);

  // Stop wheel events from bubbling to the canvas pan/zoom handler
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener("wheel", handler, { passive: true });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const active = openArtifacts.find((a) => a.fileName === activeArtifactName) ?? openArtifacts[0];

  return (
    <div className="artifact-viewer" style={{ left: pos.x, top: pos.y, height: terminal.height }}>
      {/* Tab bar */}
      <div className="artifact-viewer-tabbar" onPointerDown={handlePointerDown}>
        <div className="artifact-viewer-tabs">
          {openArtifacts.map((a) => (
            <div
              key={a.fileName}
              className={`artifact-viewer-tab${a.fileName === activeArtifactName ? " artifact-viewer-tab-active" : ""}`}
              onClick={() => onActivate(terminal.id, a.fileName)}
            >
              <span className="artifact-viewer-tab-name">{a.fileName}</span>
              <button
                className="artifact-viewer-tab-close"
                onClick={(e) => { e.stopPropagation(); onClose(terminal.id, a.fileName); }}
              >×</button>
            </div>
          ))}
        </div>
        <button className="artifact-viewer-close" onClick={() => onCloseAll(terminal.id)}>×</button>
      </div>
      {/* Content */}
      <div className="artifact-viewer-content" ref={contentRef}>
        {!active ? null : active.content === null ? (
          <span className="artifact-viewer-loading">Loading...</span>
        ) : (
          <pre>{active.content}</pre>
        )}
      </div>
    </div>
  );
}
