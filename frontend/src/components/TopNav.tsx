import { useState, useRef, useEffect } from "react";
import type { FolderEntry, CostSummary, ClientMessage } from "../types";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(n);
}

function formatUsd(n: number): string {
  return "$" + n.toFixed(2);
}

function shortenSessionName(name: string): string {
  return name.replace(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-/, "");
}

const MODEL_BAR_COLORS: Record<string, string> = {
  opus: "#e0a458",
  sonnet: "#7aa2f7",
  haiku: "#9ece6a",
};

function getModelBarColor(modelName: string): string {
  const lower = modelName.toLowerCase();
  for (const [key, color] of Object.entries(MODEL_BAR_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "#787c99";
}

type Props = {
  folders: FolderEntry[];
  activeFolder: FolderEntry | null;
  activeId: string | null;
  onSelectFolder: (id: string) => void;
  onAddFolder: (path: string) => void;
  onRemoveFolder: (id: string) => void;
  folderError: string | null;
  costSummary: CostSummary | null;
  viewMode: "overview" | "focus" | "files";
  onViewModeChange: (mode: "overview" | "focus" | "files") => void;
  onOpenSettings: () => void;
  onOpenChat?: () => void;
  send: (msg: ClientMessage) => void;
  layoutToggle?: React.ReactNode;
};

export function TopNav({
  folders, activeFolder, activeId, onSelectFolder, onAddFolder, onRemoveFolder, folderError,
  costSummary, viewMode, onViewModeChange, onOpenSettings, onOpenChat, send, layoutToggle,
}: Props) {
  const [showCostPanel, setShowCostPanel] = useState(false);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [addInput, setAddInput] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const folderDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showFolderDropdown) return;
    const handler = (e: MouseEvent) => {
      if (folderDropdownRef.current && !folderDropdownRef.current.contains(e.target as Node)) {
        setShowFolderDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFolderDropdown]);

  useEffect(() => {
    if (!showCostPanel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowCostPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCostPanel]);

  const hasCost = costSummary && costSummary.workspace_total_usd > 0;
  const totalUsd = costSummary?.workspace_total_usd ?? 0;

  const sessionEntries = costSummary
    ? Object.entries(costSummary.by_session).sort((a, b) => b[1].cost_usd - a[1].cost_usd)
    : [];
  const modelEntries = costSummary
    ? Object.entries(costSummary.by_model).sort((a, b) => b[1].cost_usd - a[1].cost_usd)
    : [];

  const maxModelCost = modelEntries.length > 0 ? modelEntries[0][1].cost_usd : 1;
  const maxSessionCost = sessionEntries.length > 0 ? sessionEntries[0][1].cost_usd : 1;

  const handleAddSubmit = () => {
    const trimmed = addInput.trim();
    if (trimmed) {
      onAddFolder(trimmed);
      setAddInput("");
      setShowAddFolder(false);
    }
  };

  return (
    <div className="top-nav">
      {/* Folder selector area */}
      <div className="top-nav-folder">
        <div className="custom-dropdown" ref={folderDropdownRef}>
          <button
            className="custom-dropdown-trigger"
            onClick={() => setShowFolderDropdown((v) => !v)}
          >
            <span className="custom-dropdown-value">
              {activeFolder ? activeFolder.label : "Select folder..."}
            </span>
            <svg className="custom-dropdown-chevron" width="8" height="5" viewBox="0 0 10 6">
              <path d="M0 0l5 6 5-6z" fill="currentColor" />
            </svg>
          </button>
          {showFolderDropdown && (
            <div className="custom-dropdown-menu">
              {folders.map((f) => (
                <button
                  key={f.id}
                  className={`custom-dropdown-item${f.id === activeId ? " active" : ""}`}
                  onClick={() => { onSelectFolder(f.id); setShowFolderDropdown(false); }}
                >
                  {f.label}
                </button>
              ))}
              {folders.length === 0 && (
                <span className="custom-dropdown-empty">No folders added</span>
              )}
            </div>
          )}
        </div>
        {activeId && (
          <button className="top-nav-folder-remove" onClick={() => onRemoveFolder(activeId)} title="Remove folder">
            ×
          </button>
        )}
        {activeFolder && (
          <span
            className="top-nav-provider"
            onClick={() => {
              const newProvider = (activeFolder.defaultProvider ?? "claude") === "claude" ? "codex" : "claude";
              send({ type: "folder:update_preset", pathId: activeFolder.id, defaultProvider: newProvider });
            }}
            title="Click to toggle provider"
          >
            {(activeFolder.defaultProvider ?? "claude") === "claude" ? "Claude" : "Codex"}
          </span>
        )}
        <button
          className="top-nav-folder-add-btn"
          onClick={() => setShowAddFolder((v) => !v)}
          title="Add folder"
        >
          +
        </button>
        {showAddFolder && (
          <div className="top-nav-add-popover">
            <input
              type="text"
              className="top-nav-add-input"
              placeholder="Folder path..."
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddSubmit(); if (e.key === "Escape") setShowAddFolder(false); }}
              autoFocus
            />
            <button className="top-nav-add-submit" onClick={handleAddSubmit}>Add</button>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="top-nav-divider" />

      {/* Workspace info */}
      {activeFolder ? (
        <>
          <span className="top-nav-label">{activeFolder.label}</span>
          <span className="top-nav-path">{activeFolder.path}</span>
        </>
      ) : (
        <span className="top-nav-empty">Select or add a folder</span>
      )}

      {folderError && <span className="top-nav-error">{folderError}</span>}

      <div className="top-nav-actions">
        <div className="top-nav-mode-toggle">
          <button
            className={`top-nav-mode-btn${viewMode === "overview" ? " active" : ""}`}
            onClick={() => onViewModeChange("overview")}
          >
            Overview
          </button>
          <button
            className={`top-nav-mode-btn${viewMode === "focus" ? " active" : ""}`}
            onClick={() => onViewModeChange("focus")}
          >
            Focus
          </button>
          <button
            className={`top-nav-mode-btn${viewMode === "files" ? " active" : ""}`}
            onClick={() => onViewModeChange("files")}
          >
            Files
          </button>
        </div>
        {activeFolder && (
          <div style={{ position: "relative" }} ref={panelRef}>
            <button
              className={`top-nav-cost-btn${hasCost ? " has-cost" : ""}`}
              onClick={() => setShowCostPanel((v) => !v)}
              title="Token & cost usage"
            >
              {hasCost ? formatUsd(costSummary.workspace_total_usd) : "$0.00"}
            </button>
            {showCostPanel && (
              <div className="cost-panel">
                <div className="cost-panel-header">Usage & Cost</div>
                <div className="cost-panel-total">
                  <span className="cost-panel-total-usd">
                    {hasCost ? formatUsd(costSummary.workspace_total_usd) : "$0.00"}
                  </span>
                  <span className="cost-panel-total-tokens">
                    {costSummary ? formatTokens(costSummary.workspace_total_tokens) : "0"} tokens
                  </span>
                </div>
                {modelEntries.length > 0 && (
                  <>
                    <div className="cost-panel-section-label">By Model</div>
                    <div className="cost-panel-rows">
                      {modelEntries.map(([name, data]) => {
                        const pct = totalUsd > 0 ? Math.round((data.cost_usd / totalUsd) * 100) : 0;
                        const barWidth = maxModelCost > 0 ? (data.cost_usd / maxModelCost) * 100 : 0;
                        const barColor = getModelBarColor(name);
                        return (
                          <div className="cost-panel-row" key={name}>
                            <div className="cost-panel-row-top">
                              <span className="cost-panel-row-name">{name}</span>
                              <span className="cost-panel-row-pct">{pct}%</span>
                            </div>
                            <div className="cost-panel-row-meta">
                              {formatUsd(data.cost_usd)} &middot; {formatTokens(data.tokens)} tokens
                            </div>
                            <div className="cost-panel-bar">
                              <div
                                className="cost-panel-bar-fill"
                                style={{ width: `${barWidth}%`, background: barColor }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {sessionEntries.length > 0 && (
                  <>
                    <div className="cost-panel-section-label">By Terminal</div>
                    <div className="cost-panel-rows">
                      {sessionEntries.map(([name, data]) => {
                        const pct = totalUsd > 0 ? Math.round((data.cost_usd / totalUsd) * 100) : 0;
                        const barWidth = maxSessionCost > 0 ? (data.cost_usd / maxSessionCost) * 100 : 0;
                        return (
                          <div className="cost-panel-row" key={name}>
                            <div className="cost-panel-row-top">
                              <span className="cost-panel-row-name">{shortenSessionName(name)}</span>
                              <span className="cost-panel-row-cost">{formatUsd(data.cost_usd)}</span>
                              <span className="cost-panel-row-pct">{pct}%</span>
                            </div>
                            <div className="cost-panel-bar">
                              <div
                                className="cost-panel-bar-fill cost-panel-bar-fill-session"
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {!hasCost && (
                  <div className="cost-panel-empty">No usage recorded yet</div>
                )}
                {costSummary?.updatedAt && (
                  <div className="cost-panel-updated">
                    Updated {new Date(costSummary.updatedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {onOpenChat && (
          <button className="top-nav-chat-btn" onClick={onOpenChat} title="Chat with agents">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 2h12v9H9l-3 3v-3H2V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <button
          className="top-nav-theme-btn"
          onClick={onOpenSettings}
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6.7 1.5h2.6l.35 1.8.9.37 1.55-.95 1.84 1.84-.95 1.55.37.9 1.8.35v2.6l-1.8.35-.37.9.95 1.55-1.84 1.84-1.55-.95-.9.37-.35 1.8H6.7l-.35-1.8-.9-.37-1.55.95-1.84-1.84.95-1.55-.37-.9-1.8-.35V6.7l1.8-.35.37-.9-.95-1.55L4.9 2.06l1.55.95.9-.37.35-1.14z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>
        {layoutToggle}
      </div>
    </div>
  );
}
