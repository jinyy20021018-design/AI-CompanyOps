export type FolderEntry = {
  id: string;
  label: string;
  path: string;
  defaultProvider?: "claude" | "codex";
  defaultMode?: "quick" | "role";
  defaultRole?: string;
};

export type TerminalSession = {
  id: string;
  pathId: string;
  cwd: string;
  label: string;
  pid: number;
  createdAt: number;
};

export type DirEntry = {
  name: string;
  isDir: boolean;
  childCount?: number;
  mtime?: string;
};

export type CostSummary = {
  updatedAt: string;
  workspace_total_usd: number;
  workspace_total_tokens: number;
  by_session: Record<string, { provider: string; cost_usd: number; tokens: number }>;
  by_model: Record<string, { cost_usd: number; tokens: number }>;
};

export type TerminalRegistryEntry = {
  terminalId: string;
  pathId: string;
  sessionName: string;
  sessionDir: string;
  sessionType: string;
  role: "coordinator" | "worker";
  title: string;
  tag?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pid: number;
  startedAt: string;
  status: "running" | "exited";
  exitCode?: number;
  exitedAt?: string;
  mode?: "quick" | "role";
  provider?: "claude" | "codex";
  persistence?: "ephemeral" | "persistent";
  promoted?: boolean;
  claudeSessionId?: string;
};

export type ArtifactFileInfo = { name: string; sizeBytes: number; mtime: string };

export type MessageType = "chat" | "task_assign" | "status_update" | "question" | "handoff" | "artifact_ready" | "blocker";
export type MessageStatus = "sent" | "delivered" | "read" | "acknowledged" | "resolved";

export type SessionHistoryEntry = {
  sessionName: string;
  sessionType: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  isRunning: boolean;
  terminalId?: string;
  mode?: "quick" | "role";
  tag?: string;
};

// Client -> Server
export type ClientMessage =
  | { type: "folder:add"; path: string }
  | { type: "folder:remove"; pathId: string }
  | { type: "folder:list" }
  | { type: "fs:readdir"; path: string }
  | { type: "terminal:create"; pathId: string; x: number; y: number; sessionType?: "claude" | "codex" | "coordinator"; provider?: "claude" | "codex"; mode?: "quick" | "role"; role?: string; title?: string }
  | { type: "folder:update_preset"; pathId: string; defaultProvider?: "claude" | "codex"; defaultMode?: "quick" | "role"; defaultRole?: string }
  | { type: "terminal:input"; terminalId: string; data: string }
  | { type: "terminal:resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal:close"; terminalId: string }
  | { type: "terminal:list"; pathId: string }
  | { type: "terminal:reconnect"; terminalId: string }
  | { type: "terminal:update"; terminalId: string; x: number; y: number; width: number; height: number; title?: string }
  | { type: "session:list"; pathId: string }
  | { type: "terminal:promote"; terminalId: string; role?: string; name?: string }
  | { type: "terminal:demote"; terminalId: string }
  | { type: "usage:cost_request"; pathId: string }
  | { type: "usage:record"; pathId: string; terminalId: string; event: Record<string, unknown> }
  | { type: "artifact:list"; terminalId: string }
  | { type: "artifact:read"; terminalId: string; fileName: string }
  | { type: "chat:send"; pathId: string; to: string; msg: string; msgType?: string }
  | { type: "scratchpad:load"; pathId: string };

// Server -> Client
export type ServerMessage =
  | { type: "folder:list"; folders: FolderEntry[] }
  | { type: "folder:added"; folder: FolderEntry }
  | { type: "folder:removed"; pathId: string }
  | { type: "folder:error"; message: string }
  | { type: "fs:readdir"; path: string; entries: DirEntry[] }
  | { type: "fs:error"; path: string; message: string }
  | { type: "terminal:created"; terminalId: string; pathId: string; x: number; y: number; sessionType: string; sessionName: string; tag?: string; mode?: "quick" | "role"; provider?: "claude" | "codex"; autoStarted?: boolean; title?: string }
  | { type: "folder:preset_updated"; pathId: string; folder: FolderEntry }
  | { type: "terminal:output"; terminalId: string; data: string }
  | { type: "terminal:exit"; terminalId: string; exitCode: number }
  | { type: "terminal:error"; terminalId: string; message: string }
  | { type: "terminal:list"; pathId: string; terminals: TerminalRegistryEntry[] }
  | { type: "terminal:reconnected"; terminalId: string; pathId: string; bufferedOutput: string }
  | { type: "session:list"; pathId: string; sessions: SessionHistoryEntry[] }
  | { type: "usage:cost_summary"; pathId: string; summary: CostSummary }
  | { type: "terminal:promoted"; terminalId: string; mode: "role"; persistence: "persistent"; tag?: string; newName?: string; newSessionName?: string }
  | { type: "terminal:demoted"; terminalId: string }
  | { type: "message:new"; terminalId: string; from: string; tag: string; preview: string; msgType?: string; messageId?: string; taskId?: string; artifactPath?: string }
  | { type: "message:urgent"; terminalId: string; from: string; msgType: string; preview: string; messageId?: string }
  | { type: "artifact:update"; terminalId: string; files: ArtifactFileInfo[] }
  | { type: "artifact:content"; terminalId: string; fileName: string; content: string }
  | { type: "scratchpad:history"; pathId: string; entries: ScratchpadEntry[] }
  | { type: "scratchpad:message"; pathId: string; entry: ScratchpadEntry }
  | { type: "coordinator:complete"; terminalId: string; sessionName: string; folderPath: string }
  | { type: "chat:error"; message: string };

export type ScratchpadEntry = {
  ts: string;
  from: string;
  to: string;
  tag: string;
  msg: string;
  msgType?: string;
  id?: string;
  ref?: string | null;
};
