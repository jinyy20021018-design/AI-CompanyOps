import type { FolderEntry } from "../types";

type Props = {
  activeFolder: FolderEntry | null;
  terminalCount: number;
  onArrange?: () => void;
  onOpenSettings: () => void;
};

export function WorkspaceHeader({ activeFolder, terminalCount, onArrange, onOpenSettings }: Props) {
  return (
    <div className="workspace-header">
      {activeFolder ? (
        <>
          <span className="workspace-header-label">{activeFolder.label}</span>
          <span className="workspace-header-path">{activeFolder.path}</span>
        </>
      ) : (
        <span className="workspace-header-empty">Select a folder from the sidebar</span>
      )}
      <div className="workspace-header-actions">
        {terminalCount > 0 && (
          <span className="workspace-header-count">
            {terminalCount} terminal{terminalCount !== 1 ? "s" : ""}
          </span>
        )}
        {onArrange && (
          <button className="workspace-header-arrange" onClick={onArrange} title="Arrange terminals compactly">
            Arrange
          </button>
        )}
        <button className="workspace-header-settings-btn" onClick={onOpenSettings} title="Settings">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.5 1L6.2 2.6C5.8 2.8 5.4 3 5.1 3.3L3.5 2.7L2 5.3L3.3 6.4C3.3 6.6 3.2 6.8 3.2 7C3.2 7.2 3.2 7.4 3.3 7.6L2 8.7L3.5 11.3L5.1 10.7C5.4 11 5.8 11.2 6.2 11.4L6.5 13H9.5L9.8 11.4C10.2 11.2 10.6 11 10.9 10.7L12.5 11.3L14 8.7L12.7 7.6C12.8 7.4 12.8 7.2 12.8 7C12.8 6.8 12.8 6.6 12.7 6.4L14 5.3L12.5 2.7L10.9 3.3C10.6 3 10.2 2.8 9.8 2.6L9.5 1H6.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <circle cx="8" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
