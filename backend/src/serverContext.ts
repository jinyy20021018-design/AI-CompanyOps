import { WebSocket, WebSocketServer } from "ws";
import { FolderRegistry } from "./folderRegistry.js";
import type { AgentChannel } from "./agentChannel.js";
import { TerminalRegistry } from "./terminalRegistry.js";
import { ScratchpadWatcher, type ScratchpadMessage } from "./scratchpadWatcher.js";
import { ArtifactWatcher } from "./artifactWatcher.js";
import type { ServerMessage } from "./protocol.js";

export type SessionMeta = { folderPath: string; sessionName: string; sessionDir: string };

export interface ServerContext {
  registry: FolderRegistry;
  agentChannel: AgentChannel;
  terminalRegistry: TerminalRegistry;
  scratchpadWatcher: ScratchpadWatcher;
  artifactWatcher: ArtifactWatcher;
  sessionMeta: Map<string, SessionMeta>;
  watchedDirCounts: Map<string, number>;
  pendingNotifications: Map<string, ScratchpadMessage[]>;
  wss: WebSocketServer;
  send: (ws: WebSocket, msg: ServerMessage) => void;
  broadcast: (msg: ServerMessage) => void;
}
