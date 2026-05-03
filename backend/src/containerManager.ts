import crypto from "node:crypto";
import fs from "node:fs";
import { Duplex } from "node:stream";
import Docker from "dockerode";
import type { Container } from "dockerode";
import type {
  AgentChannel,
  AgentDataListener,
  AgentExitListener,
  AgentSession,
  AgentWriteOptions,
} from "./agentChannel.js";

/**
 * Docker-backed AgentChannel.
 *
 * Each agent runs in its own container (image: $COAGENT_AGENT_IMAGE). I/O is
 * shuttled via Docker's hijacked attach stream: writes go to stdin, the data
 * event yields stdout/stderr (TTY mode merges them into one stream).
 *
 * Path translation: the orchestrator mounts the host's projects root at
 * /projects (its own view). Agent containers receive the SAME host root mounted
 * at the SAME /projects path inside the container. This keeps cwd / sessionDir
 * strings identical across orchestrator and agent — no per-call translation.
 */

const RING_BUFFER_SIZE = 500;

interface ContainerSession {
  id: string;
  pathId: string;
  cwd: string;
  label: string;
  containerId: string;
  pid: number;
  createdAt: number;
  sessionDir: string;
  container: Container;
  stream: Duplex;
  outputStream: fs.WriteStream | null;
  recentOutput: string[];
  lastOutputTime: number;
  // Mutable so the live `onData`/`onExit` callbacks can be swapped on reattach.
  onData: AgentDataListener;
  onExit: AgentExitListener;
  // Extra subscribers for one-shot watchers (subscribeData).
  extraDataListeners: Set<(data: string) => void>;
  // Set true after we observe natural exit so killAll/kill don't double-fire.
  exited: boolean;
}

export interface ContainerManagerOptions {
  /** Docker host endpoint (e.g. tcp://docker-proxy:2375). */
  dockerHost: string;
  /** Image used for every spawned agent. */
  agentImage: string;
  /** Anthropic API key forwarded to each agent's claude CLI via env. */
  anthropicApiKey: string;
  /** Inside-container view of the projects mount (e.g. /projects). */
  projectsRoot: string;
  /** Host path of the projects mount (used as bind source). */
  hostProjectsRoot: string;
  /** Inside-container view of the orchestrator (used by `coagent recall` etc.). */
  orchestratorUrl: string;
  /** Optional CPU limit (cores) per agent. */
  cpus?: number;
  /** Optional memory limit per agent (bytes). */
  memoryBytes?: number;
}

export class ContainerManager implements AgentChannel {
  private docker: Docker;
  private sessions = new Map<string, ContainerSession>();
  private pendingCreates = new Map<string, Promise<AgentSession>>();

  constructor(private readonly opts: ContainerManagerOptions) {
    // dockerode accepts a URL via the `host`+`port` pair OR a `socketPath`. We
    // get a `tcp://docker-proxy:2375` style URL; parse it.
    const url = new URL(opts.dockerHost);
    if (url.protocol === "tcp:" || url.protocol === "http:") {
      this.docker = new Docker({ host: url.hostname, port: Number(url.port || 2375) });
    } else if (url.protocol === "unix:") {
      this.docker = new Docker({ socketPath: url.pathname });
    } else {
      throw new Error(`unsupported DOCKER_HOST scheme: ${opts.dockerHost}`);
    }
  }

  async create(
    pathId: string,
    cwd: string,
    label: string,
    sessionDir: string,
    onData: AgentDataListener,
    onExit: AgentExitListener,
    extraEnv?: Record<string, string>
  ): Promise<AgentSession> {
    return this.createWithId(crypto.randomUUID(), pathId, cwd, label, sessionDir, onData, onExit, extraEnv);
  }

  async createWithId(
    id: string,
    pathId: string,
    cwd: string,
    label: string,
    sessionDir: string,
    onData: AgentDataListener,
    onExit: AgentExitListener,
    extraEnv?: Record<string, string>
  ): Promise<AgentSession> {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.onData = onData;
      existing.onExit = onExit;
      return this.toAgentSession(existing);
    }

    const pending = this.pendingCreates.get(id);
    if (pending) {
      const created = await pending;
      const session = this.sessions.get(id);
      if (session) {
        session.onData = onData;
        session.onExit = onExit;
      }
      return created;
    }

    const create = this.createWithIdUnlocked(id, pathId, cwd, label, sessionDir, onData, onExit, extraEnv);
    this.pendingCreates.set(id, create);
    try {
      return await create;
    } finally {
      this.pendingCreates.delete(id);
    }
  }

  private async createWithIdUnlocked(
    id: string,
    pathId: string,
    cwd: string,
    label: string,
    sessionDir: string,
    onData: AgentDataListener,
    onExit: AgentExitListener,
    extraEnv?: Record<string, string>
  ): Promise<AgentSession> {
    const env = this.buildEnv(extraEnv);
    const binds = this.buildBinds();
    await this.removeStoppedContainerWithId(id);
    const labels = {
      "coagent.managed": "true",
      "coagent.terminal_id": id,
      "coagent.path_id": pathId,
      "coagent.label": label,
    };

    const hostConfig: Docker.HostConfig = {
      Binds: binds,
      NetworkMode: "coagent_net",
      AutoRemove: false, // we remove explicitly on kill so the orphan reaper has predictable state
      ExtraHosts: ["host.docker.internal:host-gateway"],
      // Drop ALL Linux capabilities: agent shells don't need ptrace, mknod, etc.
      // CAP_NET_BIND_SERVICE, CAP_SYS_ADMIN, etc. are all gone.
      CapDrop: ["ALL"],
      // Prevent privilege escalation (suid binaries can't gain capabilities).
      SecurityOpt: ["no-new-privileges:true"],
      // Hard fork bomb cap; ample for normal tool use (npm, pip, git, claude).
      PidsLimit: 512,
    };
    if (this.opts.cpus) hostConfig.NanoCpus = Math.floor(this.opts.cpus * 1e9);
    if (this.opts.memoryBytes) hostConfig.Memory = this.opts.memoryBytes;

    const container = await this.docker.createContainer({
      Image: this.opts.agentImage,
      name: `coagent-agent-${id}`,
      Tty: true,
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      StdinOnce: false,
      WorkingDir: cwd,
      Env: env,
      Labels: labels,
      HostConfig: hostConfig,
    });

    // Attach BEFORE start so we don't lose early output.
    const stream = (await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    })) as unknown as Duplex;

    await container.start();
    const inspect = await container.inspect();
    const pid = inspect.State?.Pid ?? 0;

    const outputPath = `${sessionDir}/output.jsonl`;
    let outputStream: fs.WriteStream | null = null;
    try {
      outputStream = fs.createWriteStream(outputPath, { flags: "a" });
    } catch {
      // sessionDir may not exist if caller mis-scaffolded; tolerate, mirroring PtyManager behavior.
    }

    const session: ContainerSession = {
      id,
      pathId,
      cwd,
      label,
      containerId: container.id,
      pid,
      createdAt: Date.now(),
      sessionDir,
      container,
      stream,
      outputStream,
      recentOutput: [],
      lastOutputTime: Date.now(),
      onData,
      onExit,
      extraDataListeners: new Set(),
      exited: false,
    };

    this.wireStream(session);
    this.wireWait(session);

    this.sessions.set(id, session);

    return this.toAgentSession(session);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  getPid(id: string): number | undefined {
    return this.sessions.get(id)?.pid;
  }

  getBufferedOutput(id: string): string {
    return this.sessions.get(id)?.recentOutput.join("") ?? "";
  }

  getLastOutputTime(id: string): number {
    return this.sessions.get(id)?.lastOutputTime ?? 0;
  }

  write(id: string, data: string, options: AgentWriteOptions = {}): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Same normalization PtyManager applies, unless this is raw terminal input.
    if (!options.raw && data.length > 1 && !data.includes("\x1b")) {
      data = data.replace(/\n/g, "\r");
      if (!data.endsWith("\r")) data += "\r";
      data = data.replace(/\r+$/, "\r");
    }
    try {
      session.stream.write(data);
    } catch (e) {
      console.warn(`[containerManager] write to ${id} failed:`, (e as Error).message);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.container.resize({ h: rows, w: cols }).catch((e) => {
      console.warn(`[containerManager] resize ${id} failed:`, (e as Error).message);
    });
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Mirror PtyManager: do NOT fire onExit on explicit kill. Drop subscribers first.
    session.extraDataListeners.clear();
    session.outputStream?.end();
    this.sessions.delete(id);
    session.exited = true;
    void this.stopAndRemove(session.container).catch((e) => {
      console.warn(`[containerManager] kill ${id} failed:`, (e as Error).message);
    });
  }

  /**
   * Find and remove any agent containers labeled `coagent.managed=true` whose
   * terminal_id is NOT in `knownIds`. These are leftovers from a crashed
   * orchestrator. Safe to call at startup before any sessions are registered.
   */
  async reapOrphans(knownIds: Set<string>): Promise<number> {
    let removed = 0;
    try {
      const all = await this.docker.listContainers({
        all: true,
        filters: { label: ["coagent.managed=true"] },
      });
      for (const info of all) {
        const tid = info.Labels?.["coagent.terminal_id"];
        if (!tid || knownIds.has(tid)) continue;
        try {
          const c = this.docker.getContainer(info.Id);
          await c.remove({ force: true });
          removed++;
        } catch (e) {
          console.warn(`[containerManager] reap ${info.Id} failed:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.warn(`[containerManager] reapOrphans listing failed:`, (e as Error).message);
    }
    return removed;
  }

  async listRunningTerminalIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
      const all = await this.docker.listContainers({
        all: false,
        filters: { label: ["coagent.managed=true"] },
      });
      for (const info of all) {
        const tid = info.Labels?.["coagent.terminal_id"];
        if (tid) ids.add(tid);
      }
    } catch (e) {
      console.warn(`[containerManager] listRunningTerminalIds failed:`, (e as Error).message);
    }
    return ids;
  }

  async killAll(): Promise<void> {
    const toStop = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.allSettled(
      toStop.map(async (s) => {
        s.extraDataListeners.clear();
        s.outputStream?.end();
        s.exited = true;
        await this.stopAndRemove(s.container);
      })
    );
  }

  subscribeData(id: string, listener: (data: string) => void): () => void {
    const session = this.sessions.get(id);
    if (!session) return () => {};
    session.extraDataListeners.add(listener);
    return () => session.extraDataListeners.delete(listener);
  }

  async reattach(
    id: string,
    onData: AgentDataListener,
    onExit: AgentExitListener
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return this.reattachExistingContainer(id, onData, onExit);

    // Tear down the old stream wiring, attach a fresh one with `logs: true` to
    // replay any output Docker buffered while we were disconnected.
    try {
      session.stream.removeAllListeners();
    } catch { /* noop */ }

    const fresh = (await session.container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
      // dockerode types don't surface this, but Docker accepts it.
      // logs: true,  // would replay; left off because we already keep our own ring buffer
    })) as unknown as Duplex;

    session.stream = fresh;
    session.onData = onData;
    session.onExit = onExit;
    this.wireStream(session);
    this.wireWait(session);
    return true;
  }

  // ── private helpers ─────────────────────────────────────────────────────────

  private async reattachExistingContainer(
    id: string,
    onData: AgentDataListener,
    onExit: AgentExitListener
  ): Promise<boolean> {
    try {
      const matches = await this.docker.listContainers({
        all: false,
        filters: {
          label: [
            "coagent.managed=true",
            `coagent.terminal_id=${id}`,
          ],
        },
      });
      const info = matches[0];
      if (!info) return false;

      const container = this.docker.getContainer(info.Id);
      const inspect = await container.inspect();
      if (!inspect.State?.Running) return false;

      const stream = (await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      })) as unknown as Duplex;

      const sessionDir = inspect.Config?.WorkingDir || "/workspace";
      let outputStream: fs.WriteStream | null = null;
      try {
        outputStream = fs.createWriteStream(`${sessionDir}/output.jsonl`, { flags: "a" });
      } catch {}

      const session: ContainerSession = {
        id,
        pathId: inspect.Config?.Labels?.["coagent.path_id"] ?? "",
        cwd: sessionDir,
        label: inspect.Config?.Labels?.["coagent.label"] ?? id,
        containerId: container.id,
        pid: inspect.State?.Pid ?? 0,
        createdAt: Date.now(),
        sessionDir,
        container,
        stream,
        outputStream,
        recentOutput: [],
        lastOutputTime: Date.now(),
        onData,
        onExit,
        extraDataListeners: new Set(),
        exited: false,
      };

      this.sessions.set(id, session);
      this.wireStream(session);
      this.wireWait(session);
      return true;
    } catch (e) {
      console.warn(`[containerManager] reattach existing ${id} failed:`, (e as Error).message);
      return false;
    }
  }

  private async removeStoppedContainerWithId(id: string): Promise<void> {
    try {
      const matches = await this.docker.listContainers({
        all: true,
        filters: {
          label: [
            "coagent.managed=true",
            `coagent.terminal_id=${id}`,
          ],
        },
      });
      for (const info of matches) {
        if (info.State === "running") continue;
        await this.docker.getContainer(info.Id).remove({ force: true });
      }
    } catch (e) {
      console.warn(`[containerManager] cleanup stopped container ${id} failed:`, (e as Error).message);
    }
  }

  private wireStream(session: ContainerSession): void {
    session.stream.on("data", (chunk: Buffer) => {
      const data = chunk.toString("utf-8");
      const line = JSON.stringify({ ts: new Date().toISOString(), data }) + "\n";
      session.outputStream?.write(line);
      session.recentOutput.push(data);
      if (session.recentOutput.length > RING_BUFFER_SIZE) session.recentOutput.shift();
      session.lastOutputTime = Date.now();
      session.onData(session.id, data);
      for (const fn of session.extraDataListeners) {
        try { fn(data); } catch { /* user listener swallowed */ }
      }
    });
    session.stream.on("error", (e) => {
      console.warn(`[containerManager] stream ${session.id} error:`, e?.message);
    });
  }

  private wireWait(session: ContainerSession): void {
    session.container
      .wait()
      .then((info: { StatusCode: number }) => {
        if (session.exited) return; // explicit kill already handled cleanup
        session.exited = true;
        session.outputStream?.end();
        this.sessions.delete(session.id);
        try {
          session.onExit(session.id, info.StatusCode);
        } catch (e) {
          console.warn(`[containerManager] onExit ${session.id} threw:`, (e as Error).message);
        }
        // Best-effort remove now that the container has exited.
        session.container.remove({ force: false }).catch(() => {});
      })
      .catch(() => {
        // The wait may reject if the container is removed underfoot; that's fine.
      });
  }

  private async stopAndRemove(container: Container): Promise<void> {
    try {
      await container.stop({ t: 2 });
    } catch {
      // Already stopped or gone.
    }
    try {
      await container.remove({ force: true });
    } catch {
      // Already removed.
    }
  }

  private buildEnv(extraEnv?: Record<string, string>): string[] {
    const env: Record<string, string> = {
      TERM: "xterm-256color",
      COLUMNS: "80",
      LINES: "24",
      COAGENT_ANTHROPIC_API_KEY: this.opts.anthropicApiKey,
      COAGENT_ORCHESTRATOR_URL: this.opts.orchestratorUrl,
      ...(extraEnv ?? {}),
    };
    return Object.entries(env).map(([k, v]) => `${k}=${v}`);
  }

  private buildBinds(): string[] {
    // Mount the host's projects root at the same path inside the agent so that
    // every absolute path the orchestrator carries (cwd, sessionDir, etc.)
    // resolves identically inside the agent container.
    return [`${this.opts.hostProjectsRoot}:${this.opts.projectsRoot}`];
  }

  private toAgentSession(s: ContainerSession): AgentSession {
    return {
      id: s.id,
      pathId: s.pathId,
      cwd: s.cwd,
      label: s.label,
      pid: s.pid,
      createdAt: s.createdAt,
      sessionDir: s.sessionDir,
      recentOutput: s.recentOutput,
      lastOutputTime: s.lastOutputTime,
    };
  }
}
