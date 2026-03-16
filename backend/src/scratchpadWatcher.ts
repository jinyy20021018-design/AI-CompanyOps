import fs from "node:fs";
import path from "node:path";

export type ScratchpadMessage = {
  ts: string;
  from: string;
  to: string;
  tag: string;
  msg: string;
  ref?: string | null;
};

type WatchState = {
  watcher: fs.FSWatcher;
  lastSize: number;
  buffer: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
};

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
      watcher: null as unknown as fs.FSWatcher,
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
            const msg = JSON.parse(trimmed) as ScratchpadMessage;
            onMessage(msg);
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

    state.watcher = fs.watch(filePath, (eventType) => {
      if (eventType === "change") {
        debouncedRead();
      }
    });

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
