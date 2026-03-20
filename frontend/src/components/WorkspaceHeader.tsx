import { useState, useRef, useEffect } from "react";
import type { FolderEntry, CostSummary } from "../types";

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
  activeFolder: FolderEntry | null;
  costSummary?: CostSummary | null;
  onOpenSettings: () => void;
  onOpenChat?: () => void;
  layoutToggle?: React.ReactNode;
};

export function WorkspaceHeader({ activeFolder, costSummary, onOpenSettings, onOpenChat, layoutToggle }: Props) {
  const [showCostPanel, setShowCostPanel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="workspace-header">
      <div className="workspace-header-actions">
        {activeFolder && (
          <div style={{ position: "relative" }} ref={panelRef}>
            <button
              className={`workspace-header-cost-btn${hasCost ? " has-cost" : ""}`}
              onClick={() => setShowCostPanel((v) => !v)}
              title="Token & cost usage"
            >
              {hasCost ? formatUsd(costSummary.workspace_total_usd) : "$0.00"}
            </button>
            {showCostPanel && (
              <div className="cost-panel">
                <div className="cost-panel-header">Usage & Cost</div>
                <div className="cost-panel-total">
                  <span className="cost-panel-total-usd">{hasCost ? formatUsd(costSummary.workspace_total_usd) : "$0.00"}</span>
                  <span className="cost-panel-total-tokens">{costSummary ? formatTokens(costSummary.workspace_total_tokens) : "0"} tokens</span>
                </div>
                {modelEntries.length > 0 && (
                  <>
                    <div className="cost-panel-section-label">By Model</div>
                    <div className="cost-panel-rows">
                      {modelEntries.map(([name, data]) => {
                        const pct = totalUsd > 0 ? Math.round((data.cost_usd / totalUsd) * 100) : 0;
                        const barWidth = maxModelCost > 0 ? (data.cost_usd / maxModelCost) * 100 : 0;
                        return (
                          <div className="cost-panel-row" key={name}>
                            <div className="cost-panel-row-top">
                              <span className="cost-panel-row-name">{name}</span>
                              <span className="cost-panel-row-pct">{pct}%</span>
                            </div>
                            <div className="cost-panel-row-meta">{formatUsd(data.cost_usd)} &middot; {formatTokens(data.tokens)} tokens</div>
                            <div className="cost-panel-bar"><div className="cost-panel-bar-fill" style={{ width: `${barWidth}%`, background: getModelBarColor(name) }} /></div>
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
                            <div className="cost-panel-bar"><div className="cost-panel-bar-fill cost-panel-bar-fill-session" style={{ width: `${barWidth}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {!hasCost && <div className="cost-panel-empty">No usage recorded yet</div>}
                {costSummary?.updatedAt && <div className="cost-panel-updated">Updated {new Date(costSummary.updatedAt).toLocaleTimeString()}</div>}
              </div>
            )}
          </div>
        )}
        {onOpenChat && (
          <button className="workspace-header-chat-btn" onClick={onOpenChat} title="Chat with agents">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 2h12v9H9l-3 3v-3H2V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <button className="workspace-header-settings-btn" onClick={onOpenSettings} title="Settings">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.5 1L6.2 2.6C5.8 2.8 5.4 3 5.1 3.3L3.5 2.7L2 5.3L3.3 6.4C3.3 6.6 3.2 6.8 3.2 7C3.2 7.2 3.2 7.4 3.3 7.6L2 8.7L3.5 11.3L5.1 10.7C5.4 11 5.8 11.2 6.2 11.4L6.5 13H9.5L9.8 11.4C10.2 11.2 10.6 11 10.9 10.7L12.5 11.3L14 8.7L12.7 7.6C12.8 7.4 12.8 7.2 12.8 7C12.8 6.8 12.8 6.6 12.7 6.4L14 5.3L12.5 2.7L10.9 3.3C10.6 3 10.2 2.8 9.8 2.6L9.5 1H6.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <circle cx="8" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>
        {layoutToggle}
      </div>
    </div>
  );
}
