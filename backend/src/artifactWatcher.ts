import fs from "node:fs";
import path from "node:path";

export type ArtifactFileInfo = { name: string; sizeBytes: number; mtime: string };

type WatchState = {
  watcher: fs.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
};

function scanDir(dir: string): ArtifactFileInfo[] {
  try {
    const names = fs.readdirSync(dir);
    return names
      .filter((n) => {
        if (n.startsWith(".")) return false;
        try {
          return !fs.statSync(path.join(dir, n)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

export class ArtifactWatcher {
  private watched = new Map<string, WatchState>();

  watch(sessionDir: string, onUpdate: (files: ArtifactFileInfo[]) => void): void {
    if (this.watched.has(sessionDir)) return;

    // Initial scan
    onUpdate(scanDir(sessionDir));

    const state: WatchState = {
      watcher: null as unknown as fs.FSWatcher,
      debounceTimer: null,
    };

    const debouncedScan = () => {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        onUpdate(scanDir(sessionDir));
      }, 200);
    };

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    state.watcher = fs.watch(sessionDir, (eventType) => {
      if (eventType === "rename" || eventType === "change") {
        debouncedScan();
      }
    });

    this.watched.set(sessionDir, state);
  }

  unwatch(sessionDir: string): void {
    const state = this.watched.get(sessionDir);
    if (state) {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.watcher.close();
      this.watched.delete(sessionDir);
    }
  }

  unwatchAll(): void {
    for (const dir of this.watched.keys()) {
      this.unwatch(dir);
    }
  }
}
