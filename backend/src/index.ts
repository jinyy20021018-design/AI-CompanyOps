import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { FolderRegistry } from "./folderRegistry.js";
import { PtyManager } from "./ptyManager.js";
import { TerminalRegistry } from "./terminalRegistry.js";
import {
  recordUsageEvent,
  readCostSummary,
  refreshCostSummary,
  type UsageEvent,
} from "./usageLogger.js";
import type { ClientMessage, ServerMessage, DirEntry, TerminalRegistryEntry, ArtifactFileInfo, ScratchpadEntry } from "./protocol.js";
import { ScratchpadWatcher, type ScratchpadMessage } from "./scratchpadWatcher.js";
import { ArtifactWatcher } from "./artifactWatcher.js";
import { scanClaudeUsage } from "./usageParser.js";
import { getHoncho, getProjectSessionId, isHonchoAvailable } from "./honchoClient.js";
import { ensureWorkspace } from "./workspace.js";
import { createSessionFolder, updateActiveSession, finalizeSession, scanSessionHistory, writeSessionContext } from "./sessionLifecycle.js";
import { createScratchpadRouter } from "./messageRouting.js";
import { recordSpawnEvent, recordExitEvent, injectCoordinatorContext } from "./honchoIntegration.js";

const PORT = 3001;
const registry = new FolderRegistry();
const ptyManager = new PtyManager();
const terminalRegistry = new TerminalRegistry();
const scratchpadWatcher = new ScratchpadWatcher();
const artifactWatcher = new ArtifactWatcher();

// Track which sharedDirs are being watched and how many terminals reference them
const watchedDirCounts = new Map<string, number>();

// Pending notifications for busy terminals (queued until idle)
const pendingNotifications = new Map<string, ScratchpadMessage[]>();

const server = http.createServer((req, res) => {
  // CORS headers for cross-origin requests from frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/usage") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { sessionDir, event } = JSON.parse(body) as { sessionDir: string; event: UsageEvent };
        if (!sessionDir || !event) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "sessionDir and event required" }));
          return;
        }
        const sessionName = path.basename(sessionDir);
        const workspace = path.dirname(path.dirname(sessionDir));
        const folderPath = path.dirname(workspace);
        recordUsageEvent(folderPath, sessionName, event);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Invalid JSON" }));
      }
    });
  } else if (req.method === "GET" && req.url?.startsWith("/honcho/context")) {
    const url = new URL(req.url, "http://localhost");
    const peerName = url.searchParams.get("peer");
    const sessionQuery = url.searchParams.get("session");
    const query = url.searchParams.get("query") || "project knowledge";
    (async () => {
      try {
        const honcho = getHoncho();
        if (sessionQuery) {
          const workspacePeer = await honcho.peer(`workspace-${sessionQuery}`);
          const rep = await workspacePeer.representation({ searchQuery: query, searchTopK: 15 });
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(rep || "No shared memory yet.");
        } else {
          const peer = await honcho.peer(peerName || "coordinator");
          const rep = await peer.representation({ searchQuery: query, searchTopK: 10 });
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(rep || "No memory available yet.");
        }
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Honcho unavailable");
      }
    })();
  } else if (req.method === "POST" && req.url === "/honcho/memory") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const { peer, content, type, folderPath } = JSON.parse(body);
      (async () => {
        try {
          const honcho = getHoncho();
          const p = await honcho.peer(peer);
          const session = await honcho.session(getProjectSessionId(folderPath));
          await session.addPeers(p);
          await session.addMessages([
            p.message(content, { metadata: { type } })
          ]);
          const workspacePeer = await honcho.peer(`workspace-${getProjectSessionId(folderPath)}`);
          await session.addPeers(workspacePeer);
          await session.addMessages([workspacePeer.message(content, { metadata: { type, from: peer } })]);
          res.writeHead(200); res.end("ok");
        } catch (e) {
          res.writeHead(500); res.end("error");
        }
      })();
    });
  } else if (req.method === "POST" && req.url === "/spawn") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      (async () => {
        try {
          const { folderPath, title, task, x: reqX = 200, y: reqY = 200 } = JSON.parse(body);
          if (!folderPath || !title || !task) {
            res.writeHead(400); res.end(JSON.stringify({ error: "folderPath, title, and task required" })); return;
          }

          const folder = registry.list().find(f => f.path === folderPath);
          if (!folder) { res.writeHead(404); res.end(JSON.stringify({ error: "Folder not found" })); return; }

          ensureWorkspace(folderPath);
          const sharedDir = path.join(folderPath, "CoAgent_workspace", "_shared");
          const tempId = crypto.randomUUID();
          const { sessionDir, sessionName } = createSessionFolder(folderPath, tempId, "claude", "quick");
          const cwd = sessionDir;

          // Write spawned-worker CLAUDE.md with task embedded (before Claude starts)
          fs.writeFileSync(path.join(sessionDir, "CLAUDE.md"), [
            `# Spawned Worker Agent`,
            ``,
            `You were spawned automatically by the coordinator to complete a specific task.`,
            `**Start work immediately. Do not wait for human input.**`,
            ``,
            `## Your assigned task`,
            task,
            ``,
            `## Workflow`,
            `1. Do the work. Save all outputs to \`$COAGENT_SESSION_DIR/artifacts/\`.`,
            `2. When done, report back:`,
            `   \`\`\`bash`,
            `   coagent send --to "role:coordinator" --type status_update --msg "Done: [one-line summary] — artifacts at $COAGENT_SESSION_DIR/artifacts/"`,
            `   \`\`\``,
            `3. Then enter the **wait loop** — keep checking inbox every 30 seconds:`,
            `   \`\`\`bash`,
            `   while true; do sleep 30 && coagent inbox; done`,
            `   \`\`\``,
            `4. When coordinator sends a \`task_assign\` message → apply the revision and report back again.`,
            `5. When coordinator sends "approved" or "closed" → exit the loop and stop.`,
            ``,
            `## Rules`,
            `- Never stop working until coordinator explicitly says "approved" or "closed"`,
            `- All outputs go to \`$COAGENT_SESSION_DIR/artifacts/\``,
            `- Always report back after completing or revising`,
          ].join("\n"));

          const claudeSessionsBefore = snapshotClaudeSessions(cwd);

          // Two-phase auto-start:
          //   Phase 1 — fixed 1s timeout for shell init (reliable across all prompt themes:
          //             zsh/bash/oh-my-zsh/powerlevel10k all use different prompt chars)
          //   Phase 2 — watch Claude's output for the "? for shortcuts" hint which appears
          //             at the end of Claude's startup banner, then inject the task
          let taskInjected = false;
          let claudeOutputSoFar = "";  // only accumulate AFTER claude starts (Phase 2 only)

          const session = ptyManager.create(
            folder.id,
            cwd,
            folder.label,
            sessionDir,
            (terminalId, data) => {
              broadcast({ type: "terminal:output", terminalId, data });

              // Phase 2: watch for Claude ready, inject task once
              // Detect Claude Code ready state by looking for the prompt symbol (❯)
              // or model indicators (Haiku, Sonnet, Opus) that appear when Claude is ready for input
              if (!taskInjected) {
                claudeOutputSoFar += data;
                const ready = claudeOutputSoFar.includes("❯") ||
                  claudeOutputSoFar.includes("for shortcuts") ||
                  /Haiku|Sonnet|Opus|Claude\s*Code/i.test(claudeOutputSoFar);
                if (ready) {
                  taskInjected = true;
                  setTimeout(() => ptyManager.write(terminalId, task + "\r"), 500);
                }
              }
            },
            (terminalId, exitCode) => {
              const meta = sessionMeta.get(terminalId);
              if (meta) {
                finalizeSession(meta.sessionDir, exitCode);
                refreshCostSummary(meta.folderPath);
                updateActiveSession(meta.folderPath, meta.sessionName, "remove");
                terminalRegistry.markExited(meta.folderPath, terminalId, exitCode);
                artifactWatcher.unwatch(path.join(meta.sessionDir, "artifacts"));
                const sd = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
                const remaining = (watchedDirCounts.get(sd) ?? 1) - 1;
                if (remaining <= 0) { scratchpadWatcher.unwatch(sd); watchedDirCounts.delete(sd); }
                else { watchedDirCounts.set(sd, remaining); }
                sessionMeta.delete(terminalId);
              }
              broadcast({ type: "terminal:exit", terminalId, exitCode });
            },
            {
              COAGENT_SHARED_DIR: sharedDir,
              COAGENT_SESSION_NAME: sessionName,
              COAGENT_FOLDER_PATH: folderPath,
              PATH: `${path.join(sharedDir, "bin")}:${process.env.PATH}`,
            }
          );

          sessionMeta.set(session.id, { folderPath, sessionName, sessionDir });
          updateActiveSession(folderPath, sessionName, "add");

          // Update session.json with actual terminalId
          const sessionJsonPath = path.join(sessionDir, "session.json");
          try {
            const sjson = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
            sjson.terminalId = session.id;
            sjson.pid = session.pid;
            sjson.tag = "worker";
            fs.writeFileSync(sessionJsonPath, JSON.stringify(sjson, null, 2));
          } catch {}

          terminalRegistry.register(folderPath, {
            terminalId: session.id,
            pathId: folder.id,
            sessionName,
            sessionDir,
            sessionType: "claude",
            role: "worker",
            title,
            tag: "worker",
            x: reqX,
            y: reqY,
            width: 420,
            height: 260,
            pid: session.pid,
            startedAt: new Date().toISOString(),
            status: "running",
            mode: "quick",
            provider: "claude",
            persistence: "ephemeral",
          });

          const count = watchedDirCounts.get(sharedDir) ?? 0;
          if (count === 0) {
            scratchpadWatcher.watch(sharedDir, createScratchpadRouter(ctx, sharedDir, folder));
          }
          watchedDirCounts.set(sharedDir, count + 1);

          broadcast({
            type: "terminal:created",
            terminalId: session.id,
            pathId: folder.id,
            x: reqX,
            y: reqY,
            sessionType: "claude",
            sessionName,
            tag: "worker",
            mode: "quick",
            provider: "claude",
            autoStarted: true,
            title,
          });

          artifactWatcher.watch(path.join(sessionDir, "artifacts"), (files) =>
            broadcast({ type: "artifact:update", terminalId: session.id, files }));

          watchForNewClaudeSession(cwd, claudeSessionsBefore, (uuid) =>
            terminalRegistry.update(folderPath, session.id, { claudeSessionId: uuid }));

          // Phase 1: fixed 1s for shell init, then start Claude.
          // Task injection (Phase 2) happens via output-monitoring above.
          setTimeout(() => {
            ptyManager.write(session.id, `claude --dangerously-skip-permissions --model haiku\r`);
          }, 1000);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, terminalId: session.id, sessionName }));

        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
        }
      })();
    });
  } else if (req.method === "POST" && req.url === "/pick-folder") {
    // Open native macOS folder picker dialog
    try {
      const result = execSync(
        `osascript -e 'set theFolder to choose folder with prompt "Choose a project folder for CoAgent"' -e 'POSIX path of theFolder'`,
        { encoding: "utf-8", timeout: 60000 }
      ).trim();
      if (result) {
        // Remove trailing slash
        const folderPath = result.endsWith("/") ? result.slice(0, -1) : result;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: folderPath }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: null, cancelled: true }));
      }
    } catch {
      // User cancelled the dialog or osascript not available
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: null, cancelled: true }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, sock, head) => {
  if (req.url === "/" || req.url?.startsWith("/?")) {
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit("connection", ws, req));
  } else {
    sock.destroy();
  }
});

// Snapshot existing Claude session files for a given CWD before spawning a terminal.
// Returns the set of pre-existing JSONL filenames so we can detect the new one later.
function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[\/_ .]/g, "-");
}

function snapshotClaudeSessions(cwd: string): Set<string> {
  try {
    const encoded = encodeClaudeProjectDir(cwd);
    const projectDir = path.join(os.homedir(), ".claude", "projects", encoded);
    if (!fs.existsSync(projectDir)) return new Set();
    return new Set(fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl")));
  } catch {
    return new Set();
  }
}

// Poll for a new JSONL file that appeared after the snapshot was taken.
// Calls onFound(uuid) when found. Gives up after ~30 seconds.
function watchForNewClaudeSession(
  cwd: string,
  beforeFiles: Set<string>,
  onFound: (uuid: string) => void
): void {
  const encoded = encodeClaudeProjectDir(cwd);
  const projectDir = path.join(os.homedir(), ".claude", "projects", encoded);
  let attempts = 0;
  const poll = () => {
    attempts++;
    try {
      if (fs.existsSync(projectDir)) {
        const current = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
        const newFile = current.find((f) => !beforeFiles.has(f));
        if (newFile) { onFound(newFile.replace(".jsonl", "")); return; }
      }
    } catch {}
    if (attempts < 15) setTimeout(poll, 2000);
  };
  setTimeout(poll, 2000);
}

// Backfill claudeSessionId for registry entries that predate the UUID-capture logic.
// Reads ~/.claude/history.jsonl and matches each entry by CWD + nearest timestamp.
function backfillClaudeSessionIds(folderPath: string, entries: TerminalRegistryEntry[]): void {
  const historyPath = path.join(os.homedir(), ".claude", "history.jsonl");
  if (!fs.existsSync(historyPath)) return;

  let history: Array<{ sessionId: string; project: string; timestamp: number }> = [];
  try {
    history = fs.readFileSync(historyPath, "utf-8")
      .split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.sessionId && e.project && e.timestamp);
  } catch { return; }

  // De-duplicate existing claudeSessionId assignments — if two entries share the same UUID,
  // clear it from all but the earliest one so the backfill can re-assign correctly.
  const seenIds = new Map<string, TerminalRegistryEntry>();
  for (const entry of [...entries].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())) {
    if (!entry.claudeSessionId) continue;
    if (seenIds.has(entry.claudeSessionId)) {
      terminalRegistry.update(folderPath, entry.terminalId, { claudeSessionId: undefined });
      entry.claudeSessionId = undefined;
    } else {
      seenIds.set(entry.claudeSessionId, entry);
    }
  }

  // Compute after de-dup so newly-cleared entries are included
  const needsBackfill = entries.filter((e) => !e.claudeSessionId && e.provider !== "codex");
  if (needsBackfill.length === 0) return;

  const usedSessionIds = new Set(entries.filter((e) => e.claudeSessionId).map((e) => e.claudeSessionId!));

  // Sort by startedAt so earlier terminals get first pick of closest sessions
  const sorted = [...needsBackfill].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  for (const entry of sorted) {
    // All session types now run from sessionDir as cwd.
    // Also try folderPath as a fallback for pre-migration entries.
    const startTs = new Date(entry.startedAt).getTime();
    // Try sessionDir first (current cwd); fall back to folderPath for pre-migration entries
    const candidates = [entry.sessionDir, folderPath];
    let match: { sessionId: string; delta: number } | undefined;
    for (const cwd of candidates) {
      match = history
        .filter((e) => e.project === cwd && !usedSessionIds.has(e.sessionId))
        .map((e) => ({ sessionId: e.sessionId, delta: Math.abs(e.timestamp - startTs) }))
        .sort((a, b) => a.delta - b.delta)[0];
      if (match) break;
    }

    // Accept if within 24h of when the terminal started
    if (match && match.delta < 24 * 60 * 60 * 1000) {
      terminalRegistry.update(folderPath, entry.terminalId, { claudeSessionId: match.sessionId });
      entry.claudeSessionId = match.sessionId;
      usedSessionIds.add(match.sessionId);
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Track session metadata for cleanup
const sessionMeta = new Map<string, { folderPath: string; sessionName: string; sessionDir: string }>();

// Build the shared ServerContext used by extracted modules
const ctx = {
  registry,
  ptyManager,
  terminalRegistry,
  scratchpadWatcher,
  artifactWatcher,
  sessionMeta,
  watchedDirCounts,
  pendingNotifications,
  wss,
  send,
  broadcast,
};

// Prune stale registry entries on startup
for (const folder of registry.list()) {
  try {
    terminalRegistry.pruneStale(folder.path);
  } catch {}
}

wss.on("connection", (ws: WebSocket) => {
  console.log("Client connected");

  ws.on("message", async (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "folder:list": {
        const folders = registry.list();
        for (const f of folders) {
          ensureWorkspace(f.path);
        }
        send(ws, { type: "folder:list", folders });
        break;
      }

      case "folder:add": {
        try {
          const folder = registry.add(msg.path);
          ensureWorkspace(folder.path);
          send(ws, { type: "folder:added", folder });
        } catch (err) {
          send(ws, {
            type: "folder:error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
        break;
      }

      case "folder:remove": {
        // Kill all terminals belonging to this folder
        for (const [tid, meta] of sessionMeta.entries()) {
          const folder = registry.resolve(msg.pathId);
          if (folder && meta.folderPath === folder.path) {
            ptyManager.kill(tid);
            sessionMeta.delete(tid);
          }
        }
        registry.remove(msg.pathId);
        send(ws, { type: "folder:removed", pathId: msg.pathId });
        break;
      }

      case "fs:readdir": {
        try {
          const dirents = fs.readdirSync(msg.path, { withFileTypes: true });
          const entries: DirEntry[] = dirents
            .filter((d) => !d.name.startsWith("."))
            .map((d) => {
              const fullPath = path.join(msg.path, d.name);
              const entry: DirEntry = { name: d.name, isDir: d.isDirectory() };
              if (d.isDirectory()) {
                try {
                  entry.childCount = fs.readdirSync(fullPath).filter((n) => !n.startsWith(".")).length;
                } catch { entry.childCount = 0; }
              } else {
                try {
                  const stat = fs.statSync(fullPath);
                  const m = stat.mtime;
                  const day = String(m.getDate()).padStart(2, "0");
                  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m.getMonth()];
                  const h = String(m.getHours()).padStart(2, "0");
                  const min = String(m.getMinutes()).padStart(2, "0");
                  entry.mtime = `${day} ${mon} ${h}:${min}`;
                } catch {}
              }
              return entry;
            })
            .sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
          send(ws, { type: "fs:readdir", path: msg.path, entries });
        } catch (err) {
          send(ws, {
            type: "fs:error",
            path: msg.path,
            message: err instanceof Error ? err.message : "Failed to read directory",
          });
        }
        break;
      }

      case "folder:update_preset": {
        const updated = registry.updatePreset(msg.pathId, {
          defaultProvider: msg.defaultProvider,
          defaultMode: msg.defaultMode,
          defaultRole: msg.defaultRole,
        });
        if (updated) {
          send(ws, { type: "folder:preset_updated", pathId: msg.pathId, folder: updated });
        }
        break;
      }

      case "terminal:create": {
        console.log("[Backend] terminal:create received", msg.pathId, msg.role);
        const folder = registry.resolve(msg.pathId);
        if (!folder) {
          console.log("[Backend] Unknown folder ID:", msg.pathId);
          send(ws, {
            type: "terminal:error",
            terminalId: "",
            message: "Unknown folder ID",
          });
          return;
        }

        try {
          const provider = msg.provider ?? "claude";
          const mode = msg.mode ?? "quick";
          const role = msg.role;
          const DEPT_IDS = new Set(["product", "engineering", "marketing", "qa", "finance"]);
          const sessionType = role === "coordinator" ? "coordinator"
            : (role && DEPT_IDS.has(role)) ? role
            : (msg.sessionType || provider);
          const persistence = mode === "role" ? "persistent" : "ephemeral";

          // Clean up stale coordinator entries before spawning a new one
          if (sessionType === "coordinator") {
            terminalRegistry.removeStaleCoordinators(folder.path);
          }

          // Pre-generate terminal ID to use in folder naming
          const tempId = crypto.randomUUID();
          const { sessionDir, sessionName } = createSessionFolder(folder.path, tempId, sessionType, mode);

          const sharedDir = path.join(folder.path, "CoAgent_workspace", "_shared");
          // All session types run from their sessionDir so relative paths (e.g. artifacts/) resolve correctly.
          // Workers access the project folder via COAGENT_FOLDER_PATH.
          const cwd = sessionDir;

          // Inject Honcho cross-project memory into coordinator CLAUDE.md
          // Best-effort: try with a 3s timeout so it doesn't block terminal creation
          if (sessionType === "coordinator" && isHonchoAvailable()) {
            try {
              await Promise.race([
                injectCoordinatorContext(sessionDir, folder.path),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
              ]);
            } catch {}
          }

          // Snapshot existing Claude sessions before spawning so we can identify the new UUID
          const claudeSessionsBefore = snapshotClaudeSessions(cwd);

          console.log("[Backend] Creating PTY for", sessionType, "in", cwd);
          const session = ptyManager.create(
            msg.pathId,
            cwd,
            folder.label,
            sessionDir,
            (terminalId, data) => {
              send(ws, { type: "terminal:output", terminalId, data });
            },
            (terminalId, exitCode) => {
              // Finalize session
              const meta = sessionMeta.get(terminalId);
              if (meta) {
                finalizeSession(meta.sessionDir, exitCode);
                refreshCostSummary(meta.folderPath);
                updateActiveSession(meta.folderPath, meta.sessionName, "remove");
                // Mark exited in terminal registry
                terminalRegistry.markExited(meta.folderPath, terminalId, exitCode);
                // Stop watching artifacts
                artifactWatcher.unwatch(path.join(meta.sessionDir, "artifacts"));
                // Decrement watcher ref count
                const sd = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
                const remaining = (watchedDirCounts.get(sd) ?? 1) - 1;
                if (remaining <= 0) {
                  scratchpadWatcher.unwatch(sd);
                  watchedDirCounts.delete(sd);
                } else {
                  watchedDirCounts.set(sd, remaining);
                }
                // Record exit event to Honcho
                recordExitEvent(meta.sessionName, meta.folderPath, exitCode);

                sessionMeta.delete(terminalId);
              }
              send(ws, { type: "terminal:exit", terminalId, exitCode });
            },
            {
              COAGENT_SHARED_DIR: sharedDir,
              COAGENT_SESSION_NAME: sessionName,
              COAGENT_FOLDER_PATH: folder.path,
              COAGENT_DEPARTMENT: DEPT_IDS.has(sessionType) ? sessionType : (sessionType === "coordinator" ? "ceo" : ""),
              PATH: `${path.join(sharedDir, "bin")}:${process.env.PATH}`,
            }
          );

          // Track session metadata
          sessionMeta.set(session.id, { folderPath: folder.path, sessionName, sessionDir });

          // Record spawn event to Honcho
          recordSpawnEvent(sessionName, folder.path, folder.label);

          const tag = sessionType === "coordinator" ? "coordinator" : (role ?? sessionType);

          // Update session.json with actual terminalId (ptyManager generates its own)
          const sessionJsonPath = path.join(sessionDir, "session.json");
          try {
            const sjson = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
            sjson.terminalId = session.id;
            sjson.pid = session.pid;
            sjson.tag = tag;
            fs.writeFileSync(sessionJsonPath, JSON.stringify(sjson, null, 2));
          } catch {}

          // Register as active session
          updateActiveSession(folder.path, sessionName, "add");

          // Register in terminal registry
          terminalRegistry.register(folder.path, {
            terminalId: session.id,
            pathId: msg.pathId,
            sessionName,
            sessionDir,
            sessionType,
            role: sessionType === "coordinator" ? "coordinator" : "worker",
            title: msg.title ?? "",
            tag,
            x: msg.x,
            y: msg.y,
            width: sessionType === "coordinator" ? 500 : 420,
            height: sessionType === "coordinator" ? 320 : 260,
            pid: session.pid,
            startedAt: new Date().toISOString(),
            status: "running",
            mode,
            provider,
            persistence,
          });

          // Start watching scratchpad for this folder if not already
          const count = watchedDirCounts.get(sharedDir) ?? 0;
          if (count === 0) {
            scratchpadWatcher.watch(sharedDir, createScratchpadRouter(ctx, sharedDir, folder));
          }
          watchedDirCounts.set(sharedDir, count + 1);

          console.log("[Backend] Sending terminal:created", session.id, sessionType);
          send(ws, {
            type: "terminal:created",
            terminalId: session.id,
            pathId: msg.pathId,
            x: msg.x,
            y: msg.y,
            sessionType,
            sessionName,
            tag,
            mode,
            provider,
            ...(msg.title ? { title: msg.title } : {}),
          });

          // Start watching session artifacts directory
          artifactWatcher.watch(path.join(sessionDir, "artifacts"), (files) => {
            send(ws, { type: "artifact:update", terminalId: session.id, files });
          });

          // Watch for the new Claude session UUID and persist it for future resume
          if (provider === "claude") {
            const terminalId = session.id;
            const folderPath = folder.path;
            watchForNewClaudeSession(cwd, claudeSessionsBefore, (uuid) => {
              terminalRegistry.update(folderPath, terminalId, { claudeSessionId: uuid });
            });
          }
        } catch (err) {
          console.error("[Backend] terminal:create FAILED:", err);
          send(ws, {
            type: "terminal:error",
            terminalId: "",
            message: err instanceof Error ? err.message : "Failed to create terminal",
          });
        }
        break;
      }

      case "terminal:input": {
        ptyManager.write(msg.terminalId, msg.data);
        break;
      }

      case "terminal:resize": {
        ptyManager.resize(msg.terminalId, msg.cols, msg.rows);
        break;
      }

      case "terminal:close": {
        // Never kill stable agents (CEO + departments) via close — they auto-respawn
        const STABLE_AGENTS = new Set(["coordinator", "product", "engineering", "marketing", "qa", "finance"]);
        const closeMeta = sessionMeta.get(msg.terminalId);
        if (closeMeta) {
          const sessionJsonPath = path.join(closeMeta.sessionDir, "session.json");
          try {
            const sjson = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
            if (STABLE_AGENTS.has(sjson.type)) break;
          } catch {}
        }
        ptyManager.kill(msg.terminalId);
        break;
      }

      case "terminal:list": {
        const folder = registry.resolve(msg.pathId);
        if (!folder) break;
        terminalRegistry.pruneStale(folder.path);
        const restorable = terminalRegistry.listRestorable(folder.path);
        // Backfill claudeSessionId for older entries that don't have it yet
        backfillClaudeSessionIds(folder.path, restorable);
        // Returns running + recently-exited persistent/coordinator entries.
        // The reconnect handler will re-spawn PTYs for any that are no longer alive.
        send(ws, { type: "terminal:list", pathId: msg.pathId, terminals: restorable });
        break;
      }

      case "terminal:reconnect": {
        let meta = sessionMeta.get(msg.terminalId);

        // If sessionMeta is missing (backend restart), rebuild from registry
        if (!meta) {
          for (const folder of registry.list()) {
            const entries = terminalRegistry.load(folder.path);
            const entry = entries.find(e => e.terminalId === msg.terminalId);
            if (entry) {
              meta = { folderPath: folder.path, sessionName: entry.sessionName, sessionDir: entry.sessionDir };
              sessionMeta.set(msg.terminalId, meta);
              break;
            }
          }
        }

        if (!meta) {
          send(ws, { type: "terminal:error", terminalId: msg.terminalId, message: "Terminal not found" });
          break;
        }

        // Safety: skip if session directory no longer exists
        if (!fs.existsSync(meta.sessionDir)) {
          console.log("[Backend] Session dir missing, skipping reconnect:", meta.sessionDir);
          sessionMeta.delete(msg.terminalId);
          send(ws, { type: "terminal:error", terminalId: msg.terminalId, message: "Session directory missing" });
          break;
        }

        const onExitReconnect = (terminalId: string, exitCode: number) => {
          const m = sessionMeta.get(terminalId);
          if (m) {
            finalizeSession(m.sessionDir, exitCode);
            refreshCostSummary(m.folderPath);
            updateActiveSession(m.folderPath, m.sessionName, "remove");
            terminalRegistry.markExited(m.folderPath, terminalId, exitCode);
            artifactWatcher.unwatch(path.join(m.sessionDir, "artifacts"));
            const sd = path.join(m.folderPath, "CoAgent_workspace", "_shared");
            const remaining = (watchedDirCounts.get(sd) ?? 1) - 1;
            if (remaining <= 0) {
              scratchpadWatcher.unwatch(sd);
              watchedDirCounts.delete(sd);
            } else {
              watchedDirCounts.set(sd, remaining);
            }
            sessionMeta.delete(terminalId);
          }
          send(ws, { type: "terminal:exit", terminalId, exitCode });
        };

        if (!ptyManager.has(msg.terminalId)) {
          // Backend was restarted — PTY is gone. Spawn a fresh shell and auto-resume the session.
          const entries = terminalRegistry.load(meta.folderPath);
          const entry = entries.find(e => e.terminalId === msg.terminalId);
          if (!entry) {
            send(ws, { type: "terminal:error", terminalId: msg.terminalId, message: "Terminal not found" });
            break;
          }

          const sharedDir = path.join(meta.folderPath, "CoAgent_workspace", "_shared");

          ptyManager.createWithId(
            msg.terminalId,
            entry.pathId,
            meta.sessionDir,
            entry.title || entry.sessionName,
            meta.sessionDir,
            (terminalId, data) => { send(ws, { type: "terminal:output", terminalId, data }); },
            onExitReconnect,
            {
              COAGENT_SHARED_DIR: sharedDir,
              COAGENT_SESSION_NAME: meta.sessionName,
              COAGENT_FOLDER_PATH: meta.folderPath,
              PATH: `${path.join(sharedDir, "bin")}:${process.env.PATH}`,
            }
          );

          terminalRegistry.update(meta.folderPath, msg.terminalId, { status: "running", pid: ptyManager["sessions"].get(msg.terminalId)?.pid ?? entry.pid });
          updateActiveSession(meta.folderPath, meta.sessionName, "add");

          // Re-watch artifacts
          artifactWatcher.watch(path.join(meta.sessionDir, "artifacts"), (files) => {
            send(ws, { type: "artifact:update", terminalId: msg.terminalId, files });
          });

          // Re-watch scratchpad
          const count = watchedDirCounts.get(sharedDir) ?? 0;
          if (count === 0) {
            const folderPath = meta.folderPath;
            const pathId = entry.pathId;
            scratchpadWatcher.watch(sharedDir, createScratchpadRouter(ctx, sharedDir, { path: folderPath, id: pathId }));
          }
          watchedDirCounts.set(sharedDir, count + 1);

          send(ws, { type: "terminal:reconnected", terminalId: msg.terminalId, pathId: meta.folderPath, bufferedOutput: "" });

          // Write recent session context to CLAUDE.md before auto-resume
          writeSessionContext(meta.sessionDir);

          // Auto-resume the Claude/Codex session
          const provider = entry.provider ?? "claude";
          if (provider === "codex") {
            setTimeout(() => { ptyManager.write(msg.terminalId, "codex\r"); }, 300);
          } else {
            // Use the stored Claude session UUID to bypass the interactive picker entirely.
            const uuid = entry.claudeSessionId;
            if (uuid) {
              setTimeout(() => {
                ptyManager.write(msg.terminalId, `claude --model haiku --dangerously-skip-permissions --resume ${uuid}\r`);
              }, 300);
              // Watch PTY output for "No conversation found" — if resume fails, start fresh
              const termId = msg.terminalId;
              const session = ptyManager["sessions"].get(termId);
              if (session) {
                let disposed = false;
                const disposable = session.process.onData((data: string) => {
                  if (disposed) return;
                  if (data.includes("No conversation found")) {
                    disposed = true;
                    disposable.dispose();
                    terminalRegistry.update(meta.folderPath, termId, { claudeSessionId: undefined });
                    setTimeout(() => { ptyManager.write(termId, "claude --model haiku --dangerously-skip-permissions\r"); }, 200);
                  }
                });
                // Always clean up after 6s
                setTimeout(() => { if (!disposed) { disposed = true; disposable.dispose(); } }, 6000);
              }
            } else {
              // No UUID — start fresh
              setTimeout(() => { ptyManager.write(msg.terminalId, "claude --model haiku --dangerously-skip-permissions\r"); }, 300);
            }
          }
          break;
        }

        const success = ptyManager.reattach(
          msg.terminalId,
          (terminalId, data) => { send(ws, { type: "terminal:output", terminalId, data }); },
          onExitReconnect
        );

        if (success) {
          // Re-attach artifact watcher to new WS connection
          artifactWatcher.unwatch(path.join(meta.sessionDir, "artifacts"));
          artifactWatcher.watch(path.join(meta.sessionDir, "artifacts"), (files) => {
            send(ws, { type: "artifact:update", terminalId: msg.terminalId, files });
          });

          const bufferedOutput = ptyManager.getBufferedOutput(msg.terminalId);
          send(ws, {
            type: "terminal:reconnected",
            terminalId: msg.terminalId,
            pathId: meta.folderPath,
            bufferedOutput,
          });
          // No context injection needed — Claude already has history via --resume
        }
        break;
      }

      case "terminal:promote": {
        const meta = sessionMeta.get(msg.terminalId);
        if (!meta) break;

        const promoteName = msg.role ?? meta.sessionName;
        const oldSessionDir = meta.sessionDir;
        const sessionsDir = path.join(meta.folderPath, "CoAgent_workspace", "sessions");
        const newSessionDir = path.join(sessionsDir, promoteName);

        // 1. Rename session folder if name changed
        if (promoteName !== meta.sessionName && !fs.existsSync(newSessionDir)) {
          try {
            fs.renameSync(oldSessionDir, newSessionDir);
          } catch {
            // Fall back: keep old dir
          }
        }

        const effectiveDir = fs.existsSync(newSessionDir) ? newSessionDir : oldSessionDir;
        const effectiveName = fs.existsSync(newSessionDir) ? promoteName : meta.sessionName;

        // 2. Copy notes.md → memory.md, reset notes.md
        const notesPath = path.join(effectiveDir, "notes.md");
        const memoryPath = path.join(effectiveDir, "memory.md");
        try {
          const notesContent = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";
          fs.writeFileSync(memoryPath, notesContent);
          fs.writeFileSync(notesPath, "");
        } catch {}

        // 3. Rewrite CLAUDE.md with full identity
        const sharedDir = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
        const allEntries = terminalRegistry.load(meta.folderPath);
        const coworkers = allEntries
          .filter(e => e.terminalId !== msg.terminalId && e.status === "running")
          .map(e => `- ${e.title || e.sessionName} (${e.role})`)
          .join("\n");

        fs.writeFileSync(path.join(effectiveDir, "CLAUDE.md"), `# ${promoteName}
You are a promoted agent in the CoAgent workspace.

## Identity
- **Name**: ${promoteName}
- **Role**: ${msg.role ?? "worker"}
- **Session**: ${effectiveName}
- **Status**: Promoted (persistent)

## Coworkers
${coworkers || "- No other active agents"}

## Memory
Your persistent memory is in \`memory.md\`. Update it with important context.
Shared team memory is in \`$COAGENT_SHARED_DIR/memory/shared.md\` — you can append to it.

## On startup
1. \`coagent context\` — project goals
2. \`coagent inbox\` — messages for you
3. \`coagent tasks\` — current task board
4. \`coagent sessions\` — active terminals
5. Read \`memory.md\` — your persistent memory

## Commands
\`\`\`bash
coagent send --to "recipient" --type blocker --msg "Message"
coagent memory --content "Learning" --type learning
coagent task start --id t1 --title "Task"
coagent task done --id t1 --result "Done"
\`\`\`
`);

        // 4. Update session.json
        const promoteJsonPath = path.join(effectiveDir, "session.json");
        try {
          const sjson = JSON.parse(fs.readFileSync(promoteJsonPath, "utf-8"));
          sjson.mode = "role";
          sjson.tag = promoteName;
          sjson.promoted = true;
          sjson.promotedAt = new Date().toISOString();
          fs.writeFileSync(promoteJsonPath, JSON.stringify(sjson, null, 2));
        } catch {}

        // 5. Update sessionMeta with new paths
        meta.sessionDir = effectiveDir;
        meta.sessionName = effectiveName;

        // 6. Update terminal registry
        terminalRegistry.update(meta.folderPath, msg.terminalId, {
          mode: "role",
          persistence: "persistent",
          promoted: true,
          sessionName: effectiveName,
          sessionDir: effectiveDir,
          ...(msg.role ? { tag: msg.role, title: msg.role } : {}),
        });

        // 7. Update active sessions in state.json
        updateActiveSession(meta.folderPath, meta.sessionName, "add");

        // 8. Notify coordinator via scratchpad
        const scratchpadPath = path.join(sharedDir, "scratchpad.jsonl");
        const promoMsg = JSON.stringify({
          ts: new Date().toISOString(),
          from: "system",
          to: "coordinator",
          tag: "promotion",
          msg: `Terminal promoted to "${promoteName}"`,
          msgType: "status_update",
        });
        try { fs.appendFileSync(scratchpadPath, promoMsg + "\n"); } catch {}

        // 9. Update PTY env vars
        ptyManager.write(msg.terminalId, `export COAGENT_SESSION_DIR="${effectiveDir}" COAGENT_SESSION_NAME="${effectiveName}"\r`);

        send(ws, {
          type: "terminal:promoted",
          terminalId: msg.terminalId,
          mode: "role",
          persistence: "persistent",
          tag: msg.role,
          newName: promoteName,
          newSessionName: effectiveName,
        });
        break;
      }

      case "terminal:demote": {
        const meta = sessionMeta.get(msg.terminalId);
        if (!meta) break;

        // Revert session.json
        const demoteJsonPath = path.join(meta.sessionDir, "session.json");
        try {
          const sjson = JSON.parse(fs.readFileSync(demoteJsonPath, "utf-8"));
          sjson.mode = "quick";
          sjson.promoted = false;
          delete sjson.promotedAt;
          fs.writeFileSync(demoteJsonPath, JSON.stringify(sjson, null, 2));
        } catch {}

        // Update terminal registry
        terminalRegistry.update(meta.folderPath, msg.terminalId, {
          mode: "quick",
          persistence: "ephemeral",
          promoted: false,
        });

        send(ws, { type: "terminal:demoted", terminalId: msg.terminalId });
        break;
      }

      case "terminal:update": {
        // Find which folder this terminal belongs to
        const meta = sessionMeta.get(msg.terminalId);
        if (meta) {
          const prevTitle = msg.title ? (() => {
            const entries = terminalRegistry.load(meta.folderPath);
            const entry = entries.find(e => e.terminalId === msg.terminalId);
            return entry?.title || "";
          })() : undefined;

          terminalRegistry.update(meta.folderPath, msg.terminalId, {
            x: msg.x,
            y: msg.y,
            width: msg.width,
            height: msg.height,
            ...(msg.title ? { title: msg.title } : {}),
          });

          // If title changed, notify the terminal and announce on scratchpad
          if (msg.title && prevTitle !== msg.title) {
            // Announce rename on scratchpad so other agents see it
            const sharedDir = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
            const scratchpadPath = path.join(sharedDir, "scratchpad.jsonl");
            const renameMsg = JSON.stringify({
              ts: new Date().toISOString(),
              from: "system",
              to: "*",
              tag: "rename",
              msg: `Terminal "${prevTitle || meta.sessionName}" is now "${msg.title}"`,
              msgType: "status_update",
            });
            try { fs.appendFileSync(scratchpadPath, renameMsg + "\n"); } catch {}
          }
        }
        break;
      }

      case "session:list": {
        const folder = registry.resolve(msg.pathId);
        if (!folder) break;
        const running = terminalRegistry.listRunning(folder.path);
        const sessions = scanSessionHistory(folder.path, running);
        send(ws, { type: "session:list", pathId: msg.pathId, sessions });
        break;
      }

      case "usage:cost_request": {
        const folder = registry.resolve(msg.pathId);
        if (folder) {
          // Build PID → sessionName map from terminal registry
          const allEntries = terminalRegistry.load(folder.path);
          const pidMap = new Map<number, string>();
          for (const entry of allEntries) {
            if (entry.pid && entry.sessionName) {
              pidMap.set(entry.pid, entry.sessionName);
            }
          }
          const summary = scanClaudeUsage(folder.path, pidMap);
          send(ws, { type: "usage:cost_summary", pathId: msg.pathId, summary });
        }
        break;
      }

      case "usage:record": {
        const folder = registry.resolve(msg.pathId);
        const meta = sessionMeta.get(msg.terminalId);
        if (folder && meta) {
          recordUsageEvent(meta.folderPath, meta.sessionName, msg.event as UsageEvent);
          const summary = readCostSummary(meta.folderPath);
          if (summary) {
            send(ws, { type: "usage:cost_summary", pathId: msg.pathId, summary });
          }
        }
        break;
      }

      case "artifact:list": {
        const meta = sessionMeta.get(msg.terminalId);
        if (!meta) break;
        const artifactsDir = path.join(meta.sessionDir, "artifacts");
        try {
          const names = fs.readdirSync(artifactsDir).filter((n) => {
            if (n.startsWith(".")) return false;
            try { return !fs.statSync(path.join(artifactsDir, n)).isDirectory(); } catch { return false; }
          });
          const files: ArtifactFileInfo[] = names.map((name) => {
            const stat = fs.statSync(path.join(artifactsDir, name));
            return { name, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
          });
          send(ws, { type: "artifact:update", terminalId: msg.terminalId, files });
        } catch {
          send(ws, { type: "artifact:update", terminalId: msg.terminalId, files: [] });
        }
        break;
      }

      case "artifact:read": {
        const meta = sessionMeta.get(msg.terminalId);
        if (!meta) break;
        // Directory traversal protection
        if (msg.fileName.includes("..") || msg.fileName.includes("/")) break;
        // Try session artifacts dir first, fall back to project root
        let filePath = path.join(meta.sessionDir, "artifacts", msg.fileName);
        if (!fs.existsSync(filePath)) {
          const rootPath = path.join(meta.folderPath, msg.fileName);
          if (fs.existsSync(rootPath)) filePath = rootPath;
        }
        try {
          const stat = fs.statSync(filePath);
          const cap = 100 * 1024; // 100KB
          const fd = fs.openSync(filePath, "r");
          const buf = Buffer.alloc(Math.min(stat.size, cap));
          fs.readSync(fd, buf, 0, buf.length, 0);
          fs.closeSync(fd);
          let content = buf.toString("utf-8");
          if (stat.size > cap) content += "\n\n[truncated at 100KB]";
          send(ws, { type: "artifact:content", terminalId: msg.terminalId, fileName: msg.fileName, content });
        } catch {
          send(ws, { type: "artifact:content", terminalId: msg.terminalId, fileName: msg.fileName, content: "[error reading file]" });
        }
        break;
      }

      case "chat:send": {
        const folder = registry.resolve(msg.pathId);
        if (!folder) { console.log("[chat:send] folder not found for pathId:", msg.pathId); break; }
        const sharedDir = path.join(folder.path, "CoAgent_workspace", "_shared");
        const scratchpadPath = path.join(sharedDir, "scratchpad.jsonl");
        console.log("[chat:send] writing to", scratchpadPath, "to:", msg.to, "msg:", msg.msg.slice(0, 60));
        const entry = {
          ts: new Date().toISOString(),
          from: "user",
          to: msg.to,
          tag: msg.msgType ?? "task_assign",
          msg: msg.msg,
          ref: null,
          id: crypto.randomUUID(),
          msgType: msg.msgType ?? "task_assign",
          status: "sent",
        };
        try {
          fs.appendFileSync(scratchpadPath, JSON.stringify(entry) + "\n");
          console.log("[chat:send] write succeeded");
        } catch (e) {
          console.error("[chat:send] write failed:", e);
        }
        break;
      }

      case "scratchpad:load": {
        const folder = registry.resolve(msg.pathId);
        if (!folder) break;
        const filePath = path.join(folder.path, "CoAgent_workspace", "_shared", "scratchpad.jsonl");
        try {
          const lines = fs.readFileSync(filePath, "utf-8").split("\n");
          const entries: ScratchpadEntry[] = [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.ts && parsed.from && parsed.to && parsed.tag && parsed.msg) {
                entries.push(parsed as ScratchpadEntry);
              }
            } catch {}
          }
          send(ws, { type: "scratchpad:history", pathId: msg.pathId, entries });
        } catch {
          send(ws, { type: "scratchpad:history", pathId: msg.pathId, entries: [] });
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

// Periodic flush: deliver queued notifications to idle terminals
const notificationFlushTimer = setInterval(() => {
  for (const [tid, msgs] of pendingNotifications.entries()) {
    if (msgs.length === 0) continue;
    if (!ptyManager.has(tid)) { pendingNotifications.delete(tid); continue; }
    const lastOutput = ptyManager.getLastOutputTime(tid);
    if (Date.now() - lastOutput > 3000) {
      const summary = msgs.map(m => `[${m.msgType}] from ${m.from}: ${m.msg.slice(0, 80)}`).join("; ");
      const prompt = `You have ${msgs.length} new message(s): ${summary}. Run coagent inbox, read them, and act on each.\r`;
      ptyManager.write(tid, prompt);
      pendingNotifications.delete(tid);
    }
  }
}, 3000);

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  clearInterval(notificationFlushTimer);
  scratchpadWatcher.unwatchAll();
  artifactWatcher.unwatchAll();
  ptyManager.killAll();
  wss.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Terminal Canvas backend listening on ws://localhost:${PORT} (HTTP POST /usage for usage recording)`);
});
