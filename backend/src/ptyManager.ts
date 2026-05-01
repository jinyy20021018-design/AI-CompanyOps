import * as pty from "node-pty";
import crypto from "node:crypto";
import fs from "node:fs";
import type { AgentChannel, AgentDataListener, AgentExitListener, AgentWriteOptions } from "./agentChannel.js";

export interface PtySession {
  id: string;
  pathId: string;
  cwd: string;
  label: string;
  pid: number;
  createdAt: number;
  sessionDir: string;
  process: pty.IPty;
  outputStream: fs.WriteStream | null;
  recentOutput: string[];
  onDataDisposable: pty.IDisposable | null;
  onExitDisposable: pty.IDisposable | null;
  lastOutputTime: number;
}

const RING_BUFFER_SIZE = 500;

export class PtyManager implements AgentChannel {
  private sessions: Map<string, PtySession> = new Map();

  create(
    pathId: string,
    cwd: string,
    label: string,
    sessionDir: string,
    onData: (id: string, data: string) => void,
    onExit: (id: string, exitCode: number) => void,
    extraEnv?: Record<string, string>
  ): PtySession {
    return this.createWithId(crypto.randomUUID(), pathId, cwd, label, sessionDir, onData, onExit, extraEnv);
  }

  createWithId(
    id: string,
    pathId: string,
    cwd: string,
    label: string,
    sessionDir: string,
    onData: (id: string, data: string) => void,
    onExit: (id: string, exitCode: number) => void,
    extraEnv?: Record<string, string>
  ): PtySession {
    const shell = process.env.SHELL || "/bin/zsh";

    // Open output log stream
    const outputPath = `${sessionDir}/output.jsonl`;
    const outputStream = fs.createWriteStream(outputPath, { flags: "a" });

    const proc = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        COAGENT_SESSION_DIR: sessionDir,
        ...extraEnv,
      } as Record<string, string>,
    });

    const session: PtySession = {
      id,
      pathId,
      cwd,
      label,
      pid: proc.pid,
      createdAt: Date.now(),
      sessionDir,
      process: proc,
      outputStream,
      recentOutput: [],
      onDataDisposable: null,
      onExitDisposable: null,
      lastOutputTime: Date.now(),
    };

    const dataDisposable = proc.onData((data: string) => {
      // Write to output log
      const line = JSON.stringify({ ts: new Date().toISOString(), data }) + "\n";
      outputStream.write(line);
      // Ring buffer
      session.recentOutput.push(data);
      if (session.recentOutput.length > RING_BUFFER_SIZE) {
        session.recentOutput.shift();
      }
      // Track last output time for idle detection
      session.lastOutputTime = Date.now();
      // Send to frontend
      onData(id, data);
    });

    const exitDisposable = proc.onExit(({ exitCode }: { exitCode: number }) => {
      outputStream.end();
      this.sessions.delete(id);
      onExit(id, exitCode);
    });

    session.onDataDisposable = dataDisposable;
    session.onExitDisposable = exitDisposable;

    this.sessions.set(id, session);
    return session;
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  getBufferedOutput(id: string): string {
    const session = this.sessions.get(id);
    if (!session) return "";
    return session.recentOutput.join("");
  }

  reattach(
    id: string,
    onData: (id: string, data: string) => void,
    onExit: (id: string, exitCode: number) => void
  ): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // Dispose old listeners
    session.onDataDisposable?.dispose();
    session.onExitDisposable?.dispose();

    // Wire new listeners
    const dataDisposable = session.process.onData((data: string) => {
      const line = JSON.stringify({ ts: new Date().toISOString(), data }) + "\n";
      session.outputStream?.write(line);
      session.recentOutput.push(data);
      if (session.recentOutput.length > RING_BUFFER_SIZE) {
        session.recentOutput.shift();
      }
      session.lastOutputTime = Date.now();
      onData(id, data);
    });

    const exitDisposable = session.process.onExit(({ exitCode }: { exitCode: number }) => {
      session.outputStream?.end();
      this.sessions.delete(id);
      onExit(id, exitCode);
    });

    session.onDataDisposable = dataDisposable;
    session.onExitDisposable = exitDisposable;

    return true;
  }

  getLastOutputTime(id: string): number {
    return this.sessions.get(id)?.lastOutputTime ?? 0;
  }

  write(id: string, data: string, options: AgentWriteOptions = {}): void {
    // Raw terminal input must be passed through unchanged. IMEs can commit
    // multiple characters at once, so length alone cannot identify commands.
    if (!options.raw && data.length > 1 && !data.includes("\x1b")) {
      // Replace all internal \n with \r (PTY needs carriage return, not newline)
      data = data.replace(/\n/g, "\r");
      // Ensure it ends with \r so the input is always submitted
      if (!data.endsWith("\r")) {
        data += "\r";
      }
      // Collapse multiple trailing \r into one
      data = data.replace(/\r+$/, "\r");
    }
    this.sessions.get(id)?.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.process.resize(cols, rows);
  }

  getPid(id: string): number | undefined {
    return this.sessions.get(id)?.pid;
  }

  /**
   * Subscribe a one-shot listener to a session's data stream. Returns a disposer.
   * Used for transient watchers (e.g., "No conversation found" detection on `claude --resume`)
   * without exposing the underlying IPty handle.
   */
  subscribeData(id: string, listener: (data: string) => void): () => void {
    const session = this.sessions.get(id);
    if (!session) return () => {};
    const disposable = session.process.onData((data: string) => listener(data));
    return () => disposable.dispose();
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.outputStream?.end();
      session.onDataDisposable?.dispose();
      session.onExitDisposable?.dispose();
      session.process.kill();
      this.sessions.delete(id);
    }
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.outputStream?.end();
      session.onDataDisposable?.dispose();
      session.onExitDisposable?.dispose();
      session.process.kill();
    }
    this.sessions.clear();
  }
}
