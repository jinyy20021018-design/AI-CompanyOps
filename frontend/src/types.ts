export type FolderEntry = {
  id: string;
  label: string;
  path: string;
};

export type DirEntry = {
  name: string;
  isDir: boolean;
  childCount?: number;
  mtime?: string;
};

export type TerminalWindowModel = {
  id: string;
  pathId: string;
  title: string;
  tag?: string;
  sessionName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  active?: boolean;
  exited?: boolean;
  exitCode?: number;
  unreadCount?: number;
};

export type CostSummary = {
  updatedAt: string;
  workspace_total_usd: number;
  workspace_total_tokens: number;
  by_session: Record<string, { provider: string; cost_usd: number; tokens: number }>;
  by_model: Record<string, { cost_usd: number; tokens: number }>;
};

export type ServerMessage =
  | { type: "folder:list"; folders: FolderEntry[] }
  | { type: "folder:added"; folder: FolderEntry }
  | { type: "folder:removed"; pathId: string }
  | { type: "folder:error"; message: string }
  | { type: "fs:readdir"; path: string; entries: DirEntry[] }
  | { type: "fs:error"; path: string; message: string }
  | { type: "terminal:created"; terminalId: string; pathId: string; x: number; y: number; sessionType: string; sessionName: string }
  | { type: "terminal:output"; terminalId: string; data: string }
  | { type: "terminal:exit"; terminalId: string; exitCode: number }
  | { type: "terminal:error"; terminalId: string; message: string }
  | { type: "usage:cost_summary"; pathId: string; summary: CostSummary }
  | { type: "message:new"; terminalId: string; from: string; tag: string; preview: string };

export type ClientMessage =
  | { type: "folder:add"; path: string }
  | { type: "folder:remove"; pathId: string }
  | { type: "folder:list" }
  | { type: "fs:readdir"; path: string }
  | { type: "terminal:create"; pathId: string; x: number; y: number; sessionType?: "claude" | "codex" | "coordinator" }
  | { type: "terminal:input"; terminalId: string; data: string }
  | { type: "terminal:resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal:close"; terminalId: string }
  | { type: "usage:cost_request"; pathId: string };
