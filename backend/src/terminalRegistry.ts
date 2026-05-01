import fs from "node:fs";
import path from "node:path";

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

type LivenessChecker = (entry: TerminalRegistryEntry) => boolean;

export class TerminalRegistry {
  private registryPath(folderPath: string): string {
    return path.join(folderPath, "CoAgent_workspace", "_shared", "terminal-registry.json");
  }

  load(folderPath: string): TerminalRegistryEntry[] {
    const p = this.registryPath(folderPath);
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      return [];
    }
  }

  save(folderPath: string, entries: TerminalRegistryEntry[]): void {
    const p = this.registryPath(folderPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(entries, null, 2));
  }

  register(folderPath: string, entry: TerminalRegistryEntry): void {
    const entries = this.load(folderPath);
    // Remove any existing entry with the same terminalId
    const filtered = entries.filter((e) => e.terminalId !== entry.terminalId);
    filtered.push(entry);
    this.save(folderPath, filtered);
  }

  update(folderPath: string, terminalId: string, updates: Partial<TerminalRegistryEntry>): void {
    const entries = this.load(folderPath);
    const idx = entries.findIndex((e) => e.terminalId === terminalId);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], ...updates };
      this.save(folderPath, entries);
    }
  }

  markExited(folderPath: string, terminalId: string, exitCode: number): void {
    this.update(folderPath, terminalId, {
      status: "exited",
      exitCode,
      exitedAt: new Date().toISOString(),
    });
  }

  removeStaleCoordinators(folderPath: string): void {
    const entries = this.load(folderPath);
    const filtered = entries.filter((e) => !(e.role === "coordinator" && e.status === "exited"));
    this.save(folderPath, filtered);
  }

  listRunning(folderPath: string): TerminalRegistryEntry[] {
    return this.load(folderPath).filter((e) => e.status === "running");
  }

  // Returns running entries plus recently-exited persistent/coordinator entries
  // so the frontend can attempt to resume them after a backend restart.
  listRestorable(folderPath: string): TerminalRegistryEntry[] {
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;
    return this.load(folderPath).filter((e) => {
      if (e.status === "running") return true;
      if (e.status === "exited" && (e.persistence === "persistent" || e.role === "coordinator")) {
        if (!e.exitedAt) return true; // no timestamp — include it
        return now - new Date(e.exitedAt).getTime() < twoHours;
      }
      return false;
    });
  }

  normalizePathId(folderPath: string, pathId: string): void {
    const entries = this.load(folderPath);
    let changed = false;
    for (const entry of entries) {
      if (entry.pathId !== pathId) {
        entry.pathId = pathId;
        changed = true;
      }
    }
    if (changed) this.save(folderPath, entries);
  }

  pruneStale(folderPath: string, options: { isAlive?: LivenessChecker } = {}): void {
    const entries = this.load(folderPath);
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;

    const kept = entries.filter((e) => {
      const isAlive = options.isAlive;
      if (isAlive) {
        if (isAlive(e)) {
          e.status = "running";
          delete e.exitCode;
          delete e.exitedAt;
          return true;
        }
        if (e.status === "running") {
          e.status = "exited";
          e.exitedAt = new Date().toISOString();
          e.exitCode = -1;
          return true; // Keep but mark exited — will be pruned later
        }
      } else if (e.status === "running") {
        // Check if PID is still alive. This is valid only for local PTY mode;
        // container mode passes a Docker-backed liveness checker above.
        try {
          process.kill(e.pid, 0);
          return true;
        } catch {
          e.status = "exited";
          e.exitedAt = new Date().toISOString();
          e.exitCode = -1;
          return true;
        }
      }
      // Remove exited entries older than 2 hours
      if (e.status === "exited" && e.exitedAt) {
        const exitedAt = new Date(e.exitedAt).getTime();
        return now - exitedAt < twoHours;
      }
      return true;
    });

    this.save(folderPath, kept);
  }
}
