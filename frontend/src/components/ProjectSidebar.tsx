import { useState, useEffect, useCallback, useRef } from "react";
import type { FolderEntry, DirEntry, ClientMessage, ServerMessage } from "../types";

type Props = {
  folders: FolderEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: (path: string) => void;
  onRemove: (id: string) => void;
  folderError: string | null;
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
  onCollapse: () => void;
};

type TreeNodeProps = {
  entry: DirEntry;
  fullPath: string;
  depth: number;
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
};

function TreeNode({ entry, fullPath, depth, send, addHandler }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(() => {
    if (!entry.isDir) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (children === null) {
      setLoading(true);
      send({ type: "fs:readdir", path: fullPath });
    }
  }, [entry.isDir, expanded, children, fullPath, send]);

  useEffect(() => {
    if (!loading) return;
    return addHandler((msg: ServerMessage) => {
      if (msg.type === "fs:readdir" && msg.path === fullPath) {
        setChildren(msg.entries);
        setLoading(false);
      } else if (msg.type === "fs:error" && msg.path === fullPath) {
        setChildren([]);
        setLoading(false);
      }
    });
  }, [loading, fullPath, addHandler]);

  return (
    <>
      <div
        className="tree-row"
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={toggle}
      >
        <div className="tree-row-left">
          {entry.isDir ? (
            <span className={`tree-chevron ${expanded ? "expanded" : ""}`}>
              <svg width="8" height="8" viewBox="0 0 8 8">
                <path d="M2 1l4 3-4 3z" fill="currentColor" />
              </svg>
            </span>
          ) : (
            <span className="tree-file-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="#6a9955" strokeWidth="1.2" fill="none"/>
                <path d="M9 1v4h4" stroke="#6a9955" strokeWidth="1.2" fill="none"/>
              </svg>
            </span>
          )}
          <span className="tree-label">{entry.name}</span>
          {entry.isDir && entry.childCount !== undefined && (
            <span className="tree-count">{entry.childCount}</span>
          )}
        </div>
        {!entry.isDir && entry.mtime && (
          <span className="tree-mtime">{entry.mtime}</span>
        )}
      </div>
      {expanded && children && children.map((child) => (
        <TreeNode
          key={child.name}
          entry={child}
          fullPath={`${fullPath}/${child.name}`}
          depth={depth + 1}
          send={send}
          addHandler={addHandler}
        />
      ))}
      {expanded && loading && (
        <div className="tree-row tree-loading" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
          Loading...
        </div>
      )}
    </>
  );
}

export function ProjectSidebar({
  folders,
  activeId,
  onSelect,
  onAdd,
  onRemove,
  folderError,
  send,
  addHandler,
  onCollapse,
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [rootChildren, setRootChildren] = useState<Record<string, DirEntry[]>>({});
  const rootChildrenRef = useRef(rootChildren);
  rootChildrenRef.current = rootChildren;

  const activeFolder = folders.find((f) => f.id === activeId);
  const workspacePath = activeFolder ? `${activeFolder.path}/CoAgent_workspace` : null;

  useEffect(() => {
    if (!workspacePath) return;
    if (rootChildrenRef.current[workspacePath]) return;
    send({ type: "fs:readdir", path: workspacePath });
  }, [workspacePath, send]);

  useEffect(() => {
    return addHandler((msg: ServerMessage) => {
      if (msg.type === "fs:readdir") {
        setRootChildren((prev) => ({ ...prev, [msg.path]: msg.entries }));
      }
    });
  }, [addHandler]);

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      onAdd(trimmed);
      setInputValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
  };

  return (
    <div className="sidebar">
      {/* Folder selector */}
      <div className="sidebar-folder-selector">
        <button className="sidebar-collapse-btn" onClick={onCollapse} title="Collapse sidebar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <select
          className="sidebar-folder-dropdown"
          value={activeId ?? ""}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value);
          }}
        >
          <option value="" disabled>Select a folder...</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        {activeId && (
          <button
            className="sidebar-folder-remove"
            onClick={() => onRemove(activeId)}
            title="Remove folder"
          >
            ×
          </button>
        )}
      </div>

      {/* File tree — shows CoAgent_workspace contents */}
      <div className="sidebar-tree">
        {workspacePath && rootChildren[workspacePath] ? (
          <>
            <div className="tree-row tree-root-row">
              <div className="tree-row-left">
                <span className="tree-chevron expanded">
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <path d="M2 1l4 3-4 3z" fill="currentColor" />
                  </svg>
                </span>
                <span className="tree-label tree-root-label">CoAgent_workspace</span>
                <span className="tree-count">
                  {rootChildren[workspacePath].length}
                </span>
              </div>
            </div>
            {rootChildren[workspacePath].length === 0 ? (
              <div className="sidebar-empty" style={{ paddingLeft: 34 }}>Empty — terminal outputs will appear here</div>
            ) : (
              rootChildren[workspacePath].map((entry) => (
                <TreeNode
                  key={entry.name}
                  entry={entry}
                  fullPath={`${workspacePath}/${entry.name}`}
                  depth={1}
                  send={send}
                  addHandler={addHandler}
                />
              ))
            )}
          </>
        ) : activeFolder ? (
          <div className="sidebar-empty">Loading...</div>
        ) : (
          <div className="sidebar-empty">Select or add a folder</div>
        )}
      </div>

      {/* Add folder */}
      <div className="sidebar-add">
        <input
          type="text"
          placeholder="Add folder path..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={handleAdd}>Add</button>
      </div>
      {folderError && <div className="sidebar-error">{folderError}</div>}
    </div>
  );
}
