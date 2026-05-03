/**
 * AgentChannel — abstraction over the agent-runtime transport.
 *
 * Two implementations:
 *   - PtyManager (legacy): each agent is a node-pty child process in this Node.js process.
 *   - ContainerManager (sandbox, Phase C): each agent is a Docker container; I/O via Docker attach.
 *
 * The interface signatures intentionally mirror PtyManager's existing methods so the rest of
 * the backend (index.ts, messageRouting.ts) can switch transports without semantic changes.
 *
 * Methods return `T | Promise<T>` so callers can `await` uniformly; PtyManager remains synchronous.
 */
export interface AgentSession {
  id: string;
  pathId: string;
  cwd: string;
  label: string;
  pid: number;
  createdAt: number;
  sessionDir: string;
  recentOutput: string[];
  lastOutputTime: number;
}

export type AgentDataListener = (id: string, data: string) => void;
export type AgentExitListener = (id: string, exitCode: number) => void;
export type AgentWriteOptions = {
  raw?: boolean;
};

export interface AgentChannel {
  create(
    pathId: string,
    cwd: string,
    label: string,
    sessionDir: string,
    onData: AgentDataListener,
    onExit: AgentExitListener,
    extraEnv?: Record<string, string>
  ): AgentSession | Promise<AgentSession>;

  createWithId(
    id: string,
    pathId: string,
    cwd: string,
    label: string,
    sessionDir: string,
    onData: AgentDataListener,
    onExit: AgentExitListener,
    extraEnv?: Record<string, string>
  ): AgentSession | Promise<AgentSession>;

  write(id: string, data: string, options?: AgentWriteOptions): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  has(id: string): boolean;
  getBufferedOutput(id: string): string;
  getLastOutputTime(id: string): number;
  getPid(id: string): number | undefined;

  /**
   * Subscribe to raw output of a single session. Returns a disposer function.
   * Used for one-shot watchers (e.g., detecting "No conversation found" from claude --resume)
   * without coupling that logic to the transport implementation.
   */
  subscribeData(id: string, listener: (data: string) => void): () => void;

  reattach(
    id: string,
    onData: AgentDataListener,
    onExit: AgentExitListener
  ): boolean | Promise<boolean>;

  killAll(): void | Promise<void>;
}
