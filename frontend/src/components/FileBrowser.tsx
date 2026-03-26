import { useState, useCallback, useEffect } from "react";
import type { TerminalWindowModel, ArtifactFileInfo, ClientMessage, ServerMessage } from "../types";

type FileEntry = {
  terminalId: string;
  agentName: string;
  file: ArtifactFileInfo;
};

type Props = {
  terminals: TerminalWindowModel[];
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
};

function fileIcon(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const map: Record<string, string> = {
    md: "MD", txt: "TX", json: "{}", ts: "TS", tsx: "TX", js: "JS",
    py: "PY", rs: "RS", go: "GO", sh: "SH", yaml: "YM", yml: "YM",
    css: "CS", html: "HT", sql: "SQ", csv: "CV", xml: "XM",
  };
  return map[ext] ?? (ext.slice(0, 2).toUpperCase() || "F");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return `${day} ${mon} ${h}:${m}`;
}

export function FileBrowser({ terminals, send, addHandler }: Props) {
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Collect all artifacts across terminals
  const allFiles: FileEntry[] = [];
  const agentGroups = new Map<string, FileEntry[]>();

  for (const t of terminals) {
    if (!t.artifacts || t.artifacts.length === 0) continue;
    const name = t.title || t.sessionName || t.id;
    for (const f of t.artifacts) {
      const entry: FileEntry = { terminalId: t.id, agentName: name, file: f };
      allFiles.push(entry);
      if (!agentGroups.has(name)) agentGroups.set(name, []);
      agentGroups.get(name)!.push(entry);
    }
  }

  // Filter by search
  const filtered = search
    ? allFiles.filter((e) =>
        e.file.name.toLowerCase().includes(search.toLowerCase()) ||
        e.agentName.toLowerCase().includes(search.toLowerCase())
      )
    : null; // null = show grouped, non-null = show flat filtered

  // Load file content
  const loadFile = useCallback((entry: FileEntry) => {
    setSelectedFile(entry);
    setFileContent(null);
    setLoading(true);
    send({ type: "artifact:read", terminalId: entry.terminalId, fileName: entry.file.name });
  }, [send]);

  // Listen for artifact:content responses
  useEffect(() => {
    return addHandler((msg: ServerMessage) => {
      if (msg.type === "artifact:content" && selectedFile && msg.terminalId === selectedFile.terminalId && msg.fileName === selectedFile.file.name) {
        setFileContent(msg.content);
        setLoading(false);
      }
    });
  }, [addHandler, selectedFile]);

  const totalFiles = allFiles.length;
  const totalAgents = agentGroups.size;

  return (
    <div className="file-browser">
      {/* Left: file list */}
      <div className="file-browser-list">
        <div className="file-browser-search">
          <input
            type="text"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="file-browser-search-input"
          />
        </div>

        <div className="file-browser-entries">
          {filtered ? (
            // Flat filtered list
            filtered.length === 0 ? (
              <div className="file-browser-empty">No files match "{search}"</div>
            ) : (
              filtered.map((e) => (
                <button
                  key={`${e.terminalId}-${e.file.name}`}
                  className={`file-browser-file${selectedFile?.terminalId === e.terminalId && selectedFile?.file.name === e.file.name ? " file-browser-file-active" : ""}`}
                  onClick={() => loadFile(e)}
                >
                  <span className="file-browser-file-icon">{fileIcon(e.file.name)}</span>
                  <span className="file-browser-file-name">{e.file.name}</span>
                  <span className="file-browser-file-agent">{e.agentName}</span>
                </button>
              ))
            )
          ) : (
            // Grouped by agent
            totalFiles === 0 ? (
              <div className="file-browser-empty">
                No artifacts yet. Agents will produce files as they work.
              </div>
            ) : (
              Array.from(agentGroups.entries()).map(([agent, files]) => (
                <div key={agent} className="file-browser-group">
                  <div className="file-browser-group-header">{agent}</div>
                  {files.map((e) => (
                    <button
                      key={`${e.terminalId}-${e.file.name}`}
                      className={`file-browser-file${selectedFile?.terminalId === e.terminalId && selectedFile?.file.name === e.file.name ? " file-browser-file-active" : ""}`}
                      onClick={() => loadFile(e)}
                    >
                      <span className="file-browser-file-icon">{fileIcon(e.file.name)}</span>
                      <span className="file-browser-file-name">{e.file.name}</span>
                      <span className="file-browser-file-meta">
                        {formatSize(e.file.sizeBytes)} · {formatTime(e.file.mtime)}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )
          )}
        </div>

        <div className="file-browser-footer">
          {totalFiles} file{totalFiles !== 1 ? "s" : ""} from {totalAgents} agent{totalAgents !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Right: preview pane */}
      <div className="file-browser-preview">
        {!selectedFile ? (
          <div className="file-browser-preview-empty">
            Select a file to preview
          </div>
        ) : loading ? (
          <div className="file-browser-preview-empty">Loading...</div>
        ) : (
          <>
            <div className="file-browser-preview-header">
              <span className="file-browser-preview-icon">{fileIcon(selectedFile.file.name)}</span>
              <span className="file-browser-preview-name">{selectedFile.file.name}</span>
              <span className="file-browser-preview-meta">
                {formatSize(selectedFile.file.sizeBytes)} · {selectedFile.agentName} · {formatTime(selectedFile.file.mtime)}
              </span>
            </div>
            <div className="file-browser-preview-content">
              <pre>{fileContent}</pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
