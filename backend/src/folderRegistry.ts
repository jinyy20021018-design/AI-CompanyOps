import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FolderEntry } from "./protocol.js";

const PROJECT_ROOT = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "../.."
);
const DATA_FILE = path.join(PROJECT_ROOT, "folders.json");
const AUTH_FILE = path.join(PROJECT_ROOT, ".coagent-auth");

function getConfiguredDefaultProvider(): "claude" | "codex" {
  try {
    if (!fs.existsSync(AUTH_FILE)) return "claude";
    const auth = fs.readFileSync(AUTH_FILE, "utf-8");
    const explicit = auth.match(/^COAGENT_DEFAULT_PROVIDER=(claude|codex)$/m)?.[1];
    if (explicit === "claude" || explicit === "codex") return explicit;
    const provider = auth.match(/^COAGENT_PROVIDER=(.+)$/m)?.[1];
    return provider === "codex" ? "codex" : "claude";
  } catch {
    return "claude";
  }
}

export class FolderRegistry {
  private folders: Map<string, FolderEntry> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const entries: FolderEntry[] = JSON.parse(raw);
        for (const entry of entries) {
          this.folders.set(entry.id, entry);
        }
      }
    } catch {
      // start with empty list on parse error
    }
  }

  private save(): void {
    const entries = Array.from(this.folders.values());
    fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2), "utf-8");
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
    const entry: FolderEntry = { id, label, path: resolved, defaultProvider: getConfiguredDefaultProvider() };
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
