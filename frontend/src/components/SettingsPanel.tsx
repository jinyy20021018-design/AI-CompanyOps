import { useEffect, useRef } from "react";

export type CoordinatorEngine = "claude" | "codex";
export type CanvasTheme = "dark" | "light";

type Props = {
  coordinatorEngine: CoordinatorEngine;
  canvasTheme: CanvasTheme;
  onCoordinatorEngineChange: (engine: CoordinatorEngine) => void;
  onCanvasThemeChange: (theme: CanvasTheme) => void;
  onClose: () => void;
};

export function SettingsPanel({
  coordinatorEngine,
  canvasTheme,
  onCoordinatorEngineChange,
  onCanvasThemeChange,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  return (
    <div className="settings-overlay">
      <div ref={panelRef} className="settings-panel">
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        <div className="settings-section">
          <label className="settings-label">Coordinator Engine</label>
          <p className="settings-desc">Choose which CLI the coordinator terminal runs.</p>
          <div className="settings-toggle-group">
            <button
              className={`settings-toggle-btn${coordinatorEngine === "claude" ? " active" : ""}`}
              onClick={() => onCoordinatorEngineChange("claude")}
            >
              Claude
            </button>
            <button
              className={`settings-toggle-btn${coordinatorEngine === "codex" ? " active" : ""}`}
              onClick={() => onCoordinatorEngineChange("codex")}
            >
              Codex
            </button>
          </div>
        </div>

        <div className="settings-section">
          <label className="settings-label">Canvas Theme</label>
          <p className="settings-desc">Switch between dark and light canvas backgrounds.</p>
          <div className="settings-toggle-group">
            <button
              className={`settings-toggle-btn${canvasTheme === "dark" ? " active" : ""}`}
              onClick={() => onCanvasThemeChange("dark")}
            >
              Dark
            </button>
            <button
              className={`settings-toggle-btn${canvasTheme === "light" ? " active" : ""}`}
              onClick={() => onCanvasThemeChange("light")}
            >
              Light
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
