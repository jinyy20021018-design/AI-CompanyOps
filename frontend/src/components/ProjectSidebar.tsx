import { useState, useEffect, useRef } from "react";
import { getAgentStatus, STATUS_COLORS } from "../utils/agentStatus";
import type { FolderEntry, TerminalWindowModel } from "../types";

type Props = {
  folders: FolderEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: (path: string) => void;
  onRemove: (id: string) => void;
  folderError: string | null;
  terminals: TerminalWindowModel[];
  focusedTerminalId: string | null;
  onTerminalClick: (id: string) => void;
  onTerminalClose: (id: string) => void;
  onPromote: (id: string) => void;
  onCollapse: () => void;
};

export function ProjectSidebar({
  folders,
  activeId,
  onSelect,
  onAdd,
  onRemove,
  folderError,
  terminals,
  focusedTerminalId,
  onTerminalClick,
  onTerminalClose,
  onPromote,
  onCollapse,
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const folderDropdownRef = useRef<HTMLDivElement>(null);

  const activeFolder = folders.find((f) => f.id === activeId);

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

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (trimmed) { onAdd(trimmed); setInputValue(""); }
  };

  const coordinator = terminals.find((t) => t.tag === "coordinator");
  const workers = terminals.filter((t) => t.tag !== "coordinator");

  return (
    <div className="sidebar">
      {/* Folder selector */}
      <div className="sidebar-folder-selector">
        <button className="sidebar-collapse-btn" onClick={onCollapse} title="Collapse sidebar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="custom-dropdown sidebar-custom-dropdown" ref={folderDropdownRef}>
          <button className="custom-dropdown-trigger" onClick={() => setShowFolderDropdown((v) => !v)}>
            <span className="custom-dropdown-value">
              {activeFolder ? activeFolder.label : "Select a folder..."}
            </span>
            <svg className="custom-dropdown-chevron" width="10" height="6" viewBox="0 0 10 6">
              <path d="M0 0l5 6 5-6z" fill="currentColor" />
            </svg>
          </button>
          {showFolderDropdown && (
            <div className="custom-dropdown-menu">
              {folders.map((f) => (
                <button
                  key={f.id}
                  className={`custom-dropdown-item${f.id === activeId ? " active" : ""}`}
                  onClick={() => { onSelect(f.id); setShowFolderDropdown(false); }}
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
          <button className="sidebar-folder-remove" onClick={() => onRemove(activeId)} title="Remove folder">×</button>
        )}
      </div>

      {/* Terminal list */}
      <div className="sidebar-terminals">
        {terminals.length === 0 ? (
          <div className="sidebar-empty">No terminals open</div>
        ) : (
          <>
            {coordinator && (
              <TerminalRow
                terminal={coordinator}
                isFocused={coordinator.id === focusedTerminalId}
                onClick={() => onTerminalClick(coordinator.id)}
                onClose={() => {}} // coordinator can't be closed
                onPromote={() => {}}
              />
            )}
            {workers.length > 0 && (
              <div className="sidebar-terminals-section-label">Workers</div>
            )}
            {workers.map((t) => (
              <TerminalRow
                key={t.id}
                terminal={t}
                isFocused={t.id === focusedTerminalId}
                onClick={() => onTerminalClick(t.id)}
                onClose={() => onTerminalClose(t.id)}
                onPromote={() => onPromote(t.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* Add folder */}
      <div className="sidebar-add">
        <input
          type="text"
          placeholder="Add folder path..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <button onClick={handleAdd}>Add</button>
      </div>
      {folderError && <div className="sidebar-error">{folderError}</div>}
    </div>
  );
}

type RowProps = {
  terminal: TerminalWindowModel;
  isFocused: boolean;
  onClick: () => void;
  onClose: () => void;
  onPromote: () => void;
};

function TerminalRow({ terminal, isFocused, onClick, onClose, onPromote }: RowProps) {
  const status = getAgentStatus(terminal);
  const dotColor = STATUS_COLORS[status];
  const isCoordinator = terminal.tag === "coordinator";
  const artifactCount = terminal.artifacts?.length ?? 0;
  const canPin = !isCoordinator && terminal.mode !== "role" && !terminal.promoted && !terminal.exited;

  return (
    <div
      className={`sidebar-terminal-row${isFocused ? " sidebar-terminal-row-focused" : ""}${isCoordinator ? " sidebar-terminal-row-coordinator" : ""}`}
      onClick={onClick}
    >
      <span
        className={`sidebar-terminal-dot${status === "running" ? " pulse" : ""}`}
        style={{ background: dotColor }}
      />
      <span className="sidebar-terminal-title">{terminal.title}</span>
      {terminal.promoted && (
        <svg className="sidebar-terminal-pinned" width="9" height="9" viewBox="0 0 11 11" fill="currentColor">
          <path d="M7 1L10 4L6.5 5.5L5 9L2 6L3.5 4.5L1 1L7 1Z"/>
          <line x1="2" y1="9" x2="0.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      )}
      {artifactCount > 0 && (
        <span className="sidebar-terminal-artifacts">{artifactCount}</span>
      )}
      {(terminal.unreadCount ?? 0) > 0 && (
        <span className="sidebar-terminal-badge">{terminal.unreadCount}</span>
      )}
      <div className="sidebar-terminal-actions" onClick={(e) => e.stopPropagation()}>
        {canPin && (
          <button className="sidebar-terminal-action" onClick={onPromote} title="Pin — keep after refresh">
            <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
              <path d="M7 1L10 4L6.5 5.5L5 9L2 6L3.5 4.5L1 1L7 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <line x1="2" y1="9" x2="0.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        )}
        {!isCoordinator && (
          <button
            className="sidebar-terminal-action sidebar-terminal-kill"
            onClick={onClose}
            title="Close"
          >×</button>
        )}
      </div>
    </div>
  );
}
