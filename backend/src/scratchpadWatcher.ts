import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";

export type ScratchpadMessage = {
  ts: string;
  from: string;
  to: string;
  tag: string;
  msg: string;
  ref?: string | null;
  id?: string;
  msgType?: string;
  status?: string;
  taskId?: string;
  artifactPath?: string;
};

// Cross-cutting: abstract over fs.FSWatcher (native) and chokidar.FSWatcher
// (polling). chokidar's close() is async; fs.FSWatcher's is sync. Caller does
// not await — losing the close-completion signal is acceptable.
interface CloseableWatcher {
  close(): void | Promise<void>;
}

type WatchState = {
  watcher: CloseableWatcher;
  lastSize: number;
  buffer: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Polling is required when the watched file lives on a Docker Desktop bind mount
 * (macOS osxfs/gRPC-FUSE drops inotify events under load). Container mode opts in
 * via env; legacy host-mode keeps native fs.watch.
 */
const USE_POLLING = process.env.COAGENT_FS_POLLING === "1";

function isValidMessage(obj: unknown): obj is ScratchpadMessage {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.ts === "string" &&
    typeof o.from === "string" &&
    typeof o.to === "string" &&
    typeof o.tag === "string" &&
    typeof o.msg === "string"
  );
}

export class ScratchpadWatcher {
  private watched = new Map<string, WatchState>();

  watch(sharedDir: string, onMessage: (msg: ScratchpadMessage) => void): void {
    if (this.watched.has(sharedDir)) return;

    const filePath = path.join(sharedDir, "scratchpad.jsonl");

    // Ensure file exists
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "");
    }

    const stat = fs.statSync(filePath);
    const state: WatchState = {
      watcher: null as unknown as CloseableWatcher,
      lastSize: stat.size,
      buffer: "",
      debounceTimer: null,
    };

    const readNew = () => {
      try {
        const currentStat = fs.statSync(filePath);
        if (currentStat.size <= state.lastSize) return;

        const fd = fs.openSync(filePath, "r");
        const bytesToRead = currentStat.size - state.lastSize;
        const buf = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buf, 0, bytesToRead, state.lastSize);
        fs.closeSync(fd);

        state.lastSize = currentStat.size;
        state.buffer += buf.toString("utf-8");

        // Process complete lines
        const lines = state.buffer.split("\n");
        // Last element is either empty (if ends with \n) or incomplete
        state.buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (!isValidMessage(parsed)) continue;
            onMessage(parsed);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // File may have been deleted or is temporarily unavailable
      }
    };

    const debouncedRead = () => {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(readNew, 100);
    };

    if (USE_POLLING) {
      const watcher = chokidar.watch(filePath, {
        usePolling: true,
        interval: 250,
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
        ignoreInitial: true,
      });
      watcher.on("change", debouncedRead);
      watcher.on("add", debouncedRead);
      state.watcher = watcher;
    } else {
      state.watcher = fs.watch(filePath, (eventType) => {
        if (eventType === "change") {
          debouncedRead();
        }
      });
    }

    this.watched.set(sharedDir, state);
  }

  unwatch(sharedDir: string): void {
    const state = this.watched.get(sharedDir);
    if (state) {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.watcher.close();
      this.watched.delete(sharedDir);
    }
  }

  unwatchAll(): void {
    for (const sharedDir of this.watched.keys()) {
      this.unwatch(sharedDir);
    }
  }
}
