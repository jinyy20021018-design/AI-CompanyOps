import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FolderEntry } from "./protocol.js";

const DEFAULT_STATE_DIR = (process.env.COAGENT_MODE ?? "container") === "container" && fs.existsSync("/orch-state")
  ? "/orch-state"
  : path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "../../");
const DATA_FILE = path.join(process.env.COAGENT_STATE_DIR ?? DEFAULT_STATE_DIR, "folders.json");

function defaultProvider(): "claude" | "codex" {
  if (process.env.COAGENT_DEFAULT_PROVIDER === "codex") return "codex";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return "claude";
}

export class FolderRegistry {
  private folders: Map<string, FolderEntry> = new Map();

  constructor() {
    this.load();
    this.ensureDefaultFolder();
  }

  private load(): void {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const entries: FolderEntry[] = JSON.parse(raw);
        let changed = false;
        for (const entry of entries) {
          if (entry.defaultProvider === "codex" && defaultProvider() === "claude") {
            entry.defaultProvider = "claude";
            changed = true;
          }
          this.folders.set(entry.id, entry);
        }
        if (changed) this.save();
      }
    } catch {
      // start with empty list on parse error
    }
  }

  private save(): void {
    const entries = Array.from(this.folders.values());
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2), "utf-8");
  }

  private ensureDefaultFolder(): void {
    if (this.folders.size > 0) return;
    const defaultPath = process.env.COAGENT_DEFAULT_PROJECT_PATH;
    if (!defaultPath) return;

    const resolved = path.resolve(defaultPath);
    try {
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return;
      const id = `default-${crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 12)}`;
      this.folders.set(id, {
        id,
        label: path.basename(resolved),
        path: resolved,
        defaultProvider: defaultProvider(),
      });
      this.save();
    } catch {
      // Default folder is a convenience; an unavailable path should not block startup.
    }
  }

  add(folderPath: string): FolderEntry {
    const resolved = path.resolve(folderPath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Path does not exist: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved}`);
    }

    for (const entry of this.folders.values()) {
      if (entry.path === resolved) {
        throw new Error(`Folder already added: ${resolved}`);
      }
    }

    const id = crypto.randomUUID();
    const label = path.basename(resolved);
    const entry: FolderEntry = { id, label, path: resolved };
    this.folders.set(id, entry);
    this.save();
    return entry;
  }

  remove(id: string): boolean {
    const deleted = this.folders.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  list(): FolderEntry[] {
    return Array.from(this.folders.values());
  }

  resolve(id: string): FolderEntry | undefined {
    return this.folders.get(id);
  }

  updatePreset(id: string, preset: { defaultProvider?: "claude" | "codex"; defaultMode?: "quick" | "role"; defaultRole?: string }): FolderEntry | undefined {
    const entry = this.folders.get(id);
    if (!entry) return undefined;
    if (preset.defaultProvider !== undefined) entry.defaultProvider = preset.defaultProvider;
    if (preset.defaultMode !== undefined) entry.defaultMode = preset.defaultMode;
    if (preset.defaultRole !== undefined) entry.defaultRole = preset.defaultRole;
    this.save();
    return entry;
  }
}
