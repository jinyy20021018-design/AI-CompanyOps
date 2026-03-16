import * as pty from "node-pty";
import crypto from "node:crypto";
import fs from "node:fs";

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
}

export class PtyManager {
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
    const id = crypto.randomUUID();
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
    };

    proc.onData((data: string) => {
      // Write to output log
      const line = JSON.stringify({ ts: new Date().toISOString(), data }) + "\n";
      outputStream.write(line);
      // Send to frontend
      onData(id, data);
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      outputStream.end();
      this.sessions.delete(id);
      onExit(id, exitCode);
    });

    this.sessions.set(id, session);
    return session;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.process.resize(cols, rows);
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.outputStream?.end();
      session.process.kill();
      this.sessions.delete(id);
    }
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.outputStream?.end();
      session.process.kill();
    }
    this.sessions.clear();
  }
}
