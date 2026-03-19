import { useEffect, useRef } from "react";

export type CoordinatorEngine = "claude" | "codex";
export type CanvasTheme = "dark" | "light";

type Props = {
  canvasTheme: CanvasTheme;
  onCanvasThemeChange: (theme: CanvasTheme) => void;
  onCloseWorkers?: () => void;
  onArrange?: () => void;
  workerCount?: number;
  onClose: () => void;
};

export function SettingsPanel({
  canvasTheme,
  onCanvasThemeChange,
  onCloseWorkers,
  onArrange,
  workerCount = 0,
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
          <label className="settings-label">Theme</label>
          <p className="settings-desc">Switch between dark and light UI.</p>
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

        {(onCloseWorkers || onArrange) && (
          <div className="settings-section">
            <label className="settings-label">Actions</label>
            <div className="settings-actions">
              {onArrange && (
                <button className="settings-action-btn" onClick={() => { onArrange(); onClose(); }}>
                  Arrange terminals
                </button>
              )}
              {onCloseWorkers && workerCount > 0 && (
                <button className="settings-action-btn settings-action-destructive" onClick={() => { onCloseWorkers(); onClose(); }}>
                  Close workers ({workerCount})
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
