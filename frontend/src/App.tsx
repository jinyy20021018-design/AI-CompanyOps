import { useState, useCallback, useEffect, useRef } from "react";
import { useSocket } from "./hooks/useSocket";
// Structured layout components
import { TopNav } from "./components/TopNav";
import { CoordinatorBar } from "./components/CoordinatorBar";
import { OverviewGrid } from "./components/OverviewGrid";
import { FocusView } from "./components/FocusView";
// Canvas layout components
import { ProjectSidebar } from "./components/ProjectSidebar";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { TerminalCanvas, type TerminalCanvasHandle } from "./components/TerminalCanvas";
import { TerminalWindow } from "./components/TerminalWindow";
import { SpawnMenu, type SpawnOption } from "./components/SpawnMenu";
import { ArtifactViewer } from "./components/ArtifactViewer";
import { SettingsPanel, type CoordinatorEngine, type CanvasTheme } from "./components/SettingsPanel";
import { ChatPanel } from "./components/ChatPanel";
import { findFreePosition, arrangeTerminals, nudgeOverlaps } from "./utils/placement";
// Shared
import { TerminalPane } from "./components/TerminalPane";
import type { FolderEntry, TerminalWindowModel, ServerMessage, CostSummary, ScratchpadEntry } from "./types";

type LayoutMode = "structured" | "canvas";

const DEFAULT_WIDTH = 540;
const DEFAULT_HEIGHT = 320;
const COORD_WIDTH = 660;
const COORD_HEIGHT = 420;

export default function App() {
  const { send, addHandler } = useSocket("ws://localhost:3001");

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    () => (localStorage.getItem("layoutMode") as LayoutMode) || "structured"
  );
  useEffect(() => { localStorage.setItem("layoutMode", layoutMode); }, [layoutMode]);

  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<TerminalWindowModel[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [scratchpadMessages, setScratchpadMessages] = useState<Record<string, ScratchpadEntry[]>>({});
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>(
    () => (localStorage.getItem("canvasTheme") as CanvasTheme) || "dark"
  );

  // Structured mode state
  const [viewMode, setViewMode] = useState<"overview" | "focus">("overview");
  const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null);

  // Canvas mode state
  const [focusOrder, setFocusOrder] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [spawnMenu, setSpawnMenu] = useState<{ screenX: number; screenY: number; canvasX: number; canvasY: number } | null>(null);
  const positionUpdateTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingClickRef = useRef<{ x: number; y: number } | null>(null);

  const counterRef = useRef<Record<string, number>>({});
  const coordinatorSpawnedRef = useRef<Set<string>>(new Set());
  const foldersRef = useRef<FolderEntry[]>([]);
  const terminalsRef = useRef<TerminalWindowModel[]>([]);
  const pendingCommandRef = useRef<string | null>(null);
  const activityTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const coordinatorEngineRef = useRef<CoordinatorEngine>("claude");
  const canvasRef = useRef<TerminalCanvasHandle>(null);
  const restoredFoldersRef = useRef<Set<string>>(new Set());
  const coordinatorHasExistedRef = useRef<Set<string>>(new Set());

  const [artifactViewer, setArtifactViewer] = useState<{
    terminalId: string; fileName: string; content: string | null;
  } | null>(null); // used only for structured overview modal

  useEffect(() => { foldersRef.current = folders; }, [folders]);
  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => { localStorage.setItem("canvasTheme", canvasTheme); }, [canvasTheme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", canvasTheme);
  }, [canvasTheme]);

  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);


  // Debounced position sync (canvas mode)
  const syncPosition = useCallback((id: string, x: number, y: number, width: number, height: number) => {
    clearTimeout(positionUpdateTimers.current[id]);
    positionUpdateTimers.current[id] = setTimeout(() => {
      send({ type: "terminal:update", terminalId: id, x, y, width, height });
    }, 500);
  }, [send]);

  // Spawn coordinator helper
  const spawnCoordinator = useCallback((pathId: string) => {
    const engine = coordinatorEngineRef.current;
    // Coordinator gets Bash + Read only — no WebSearch/WebFetch/Write/Edit.
    // This forces it to delegate work via coagent spawn instead of doing it itself.
    const toolRestriction = engine === "claude" ? " --allowedTools Bash,Read" : "";
    if (coordinatorHasExistedRef.current.has(pathId)) {
      pendingCommandRef.current = `${engine} --model haiku${toolRestriction} --resume coordinator`;
    } else {
      pendingCommandRef.current = `${engine} --model haiku${toolRestriction} -n coordinator`;
      coordinatorHasExistedRef.current.add(pathId);
    }
    const sidebarW = sidebarCollapsed ? 48 : 280;
    const centerX = (window.innerWidth - sidebarW) / 2;
    const topY = COORD_HEIGHT / 2 + 20;
    pendingClickRef.current = { x: centerX, y: topY };
    send({ type: "terminal:create", pathId, x: centerX, y: topY, provider: coordinatorEngineRef.current as "claude" | "codex", mode: "role", role: "coordinator" });
  }, [send, sidebarCollapsed]);

  // Auto-spawn coordinator when a folder becomes active
  useEffect(() => {
    if (!activeId) return;
    if (coordinatorSpawnedRef.current.has(activeId)) return;
    if (!restoredFoldersRef.current.has(activeId)) return;
    const hasCoord = terminalsRef.current.some(
      (t) => t.pathId === activeId && t.tag === "coordinator" && !t.exited
    );
    if (hasCoord) {
      coordinatorSpawnedRef.current.add(activeId);
      return;
    }
    coordinatorSpawnedRef.current.add(activeId);
    spawnCoordinator(activeId);
  }, [activeId, terminals, spawnCoordinator]);

  useEffect(() => {
    return addHandler((msg: ServerMessage) => {
      switch (msg.type) {
        case "folder:list":
          setFolders(msg.folders);
          if (msg.folders.length > 0) {
            setActiveId((prev) => prev ?? msg.folders[0].id);
          }
          for (const f of msg.folders) {
            send({ type: "terminal:list", pathId: f.id });
          }
          break;

        case "folder:added":
          setFolders((prev) => [...prev, msg.folder]);
          setActiveId(msg.folder.id);
          setFolderError(null);
          send({ type: "terminal:list", pathId: msg.folder.id });
          break;

        case "folder:removed":
          setFolders((prev) => prev.filter((f) => f.id !== msg.pathId));
          setActiveId((prev) => (prev === msg.pathId ? null : prev));
          break;

        case "folder:error":
          setFolderError(msg.message);
          setTimeout(() => setFolderError(null), 4000);
          break;

        case "terminal:list": {
          const toRestore = msg.terminals.filter(
            (e) => e.persistence === "persistent" || e.role === "coordinator"
          );
          // Pre-collect titles already assigned by registry so counter doesn't collide
          const usedTitles = new Set(toRestore.map((e) => e.title).filter(Boolean));
          const restored: TerminalWindowModel[] = toRestore.map((entry) => {
            let title: string;
            if (entry.title) {
              title = entry.title;
            } else if (entry.role === "coordinator") {
              title = "Coordinator";
            } else {
              const provider = entry.provider ?? "claude";
              const key = `${entry.pathId}:${provider}`;
              let count = (counterRef.current[key] ?? 0) + 1;
              let candidate = `${provider}-${count}`;
              while (usedTitles.has(candidate)) { count++; candidate = `${provider}-${count}`; }
              counterRef.current[key] = count;
              title = candidate;
              usedTitles.add(title);
            }
            return {
            id: entry.terminalId,
            pathId: entry.pathId,
            title,
            tag: entry.role === "coordinator" ? "coordinator" : entry.tag,
            sessionName: entry.sessionName,
            x: entry.x,
            y: entry.y,
            width: entry.width,
            height: entry.height,
            mode: entry.mode,
            promoted: entry.promoted,
          };
          });

          if (restored.length > 0) {
            setTerminals((prev) => {
              const existingIds = new Set(prev.map((t) => t.id));
              const newOnes = restored.filter((t) => !existingIds.has(t.id));
              return [...prev, ...newOnes];
            });
            setFocusOrder((prev) => {
              const existingIds = new Set(prev);
              const newIds = restored.filter((t) => !existingIds.has(t.id)).map((t) => t.id);
              return [...prev, ...newIds];
            });

            const hasCoord = restored.some((t) => t.tag === "coordinator");
            if (hasCoord) {
              coordinatorSpawnedRef.current.add(msg.pathId);
              coordinatorHasExistedRef.current.add(msg.pathId);
            }

            for (const t of restored) {
              send({ type: "terminal:reconnect", terminalId: t.id });
              send({ type: "artifact:list", terminalId: t.id });
            }
          }

          restoredFoldersRef.current.add(msg.pathId);
          break;
        }

        case "terminal:created": {
          const isCoordinator = msg.sessionType === "coordinator";

          let title: string;
          if (isCoordinator) {
            title = "Coordinator";
          } else if (msg.title) {
            title = msg.title;
          } else {
            const provider = msg.provider ?? "claude";
            const key = `${msg.pathId}:${provider}`;
            const count = (counterRef.current[key] ?? 0) + 1;
            counterRef.current[key] = count;
            title = `${provider}-${count}`;
          }

          const click = pendingClickRef.current ?? { x: msg.x, y: msg.y };
          pendingClickRef.current = null;

          const termWidth = isCoordinator ? COORD_WIDTH : DEFAULT_WIDTH;
          const termHeight = isCoordinator ? COORD_HEIGHT : DEFAULT_HEIGHT;

          const pos = findFreePosition(click.x, click.y, termWidth, termHeight, terminalsRef.current);

          const newTerminal: TerminalWindowModel = {
            id: msg.terminalId,
            pathId: msg.pathId,
            title,
            tag: isCoordinator ? "coordinator" : undefined,
            sessionName: msg.sessionName,
            x: pos.x,
            y: pos.y,
            width: termWidth,
            height: termHeight,
            mode: msg.mode,
            provider: msg.provider,
          };

          // Sync display title to backend registry so agents can discover each other
          send({ type: "terminal:update", terminalId: msg.terminalId, x: pos.x, y: pos.y, width: termWidth, height: termHeight, title });

          setTerminals((prev) => {
            const filtered = isCoordinator
              ? prev.filter((t) => !(t.pathId === msg.pathId && t.tag === "coordinator"))
              : prev;
            return [...filtered, newTerminal];
          });
          setFocusOrder((prev) => {
            if (isCoordinator) {
              const oldCoordIds = new Set(
                terminalsRef.current.filter((t) => t.pathId === msg.pathId && t.tag === "coordinator").map((t) => t.id)
              );
              return [...prev.filter((v) => !oldCoordIds.has(v)), msg.terminalId];
            }
            return [...prev, msg.terminalId];
          });

          // Auto-input command
          let cmd: string | null = null;
          if (isCoordinator && pendingCommandRef.current) {
            cmd = pendingCommandRef.current;
            pendingCommandRef.current = null;
          } else if (!isCoordinator && !msg.autoStarted) {
            cmd = msg.provider === "codex" ? "codex" : "claude --model haiku";
          }
          if (cmd) {
            setTimeout(() => {
              send({ type: "terminal:input", terminalId: msg.terminalId, data: cmd + "\r" });
            }, 300);
          }
          send({ type: "artifact:list", terminalId: msg.terminalId });
          break;
        }

        case "terminal:output": {
          setTerminals((prev) =>
            prev.map((t) => (t.id === msg.terminalId ? { ...t, active: true } : t))
          );
          clearTimeout(activityTimers.current[msg.terminalId]);
          activityTimers.current[msg.terminalId] = setTimeout(() => {
            setTerminals((prev) =>
              prev.map((t) => (t.id === msg.terminalId ? { ...t, active: false } : t))
            );
          }, 1500);
          break;
        }

        case "terminal:exit":
          clearTimeout(activityTimers.current[msg.terminalId]);
          delete activityTimers.current[msg.terminalId];
          setTerminals((prev) =>
            prev.map((t) => t.id === msg.terminalId ? { ...t, active: false, exited: true, exitCode: msg.exitCode } : t)
          );
          break;

        case "terminal:promoted":
          setTerminals((prev) =>
            prev.map((t) => t.id === msg.terminalId
              ? {
                  ...t,
                  mode: "role",
                  promoted: true,
                  ...(msg.newName ? { title: msg.newName.charAt(0).toUpperCase() + msg.newName.slice(1) } : {}),
                  ...(msg.tag ? { tag: msg.tag } : {}),
                  ...(msg.newSessionName ? { sessionName: msg.newSessionName } : {}),
                }
              : t
            )
          );
          break;

        case "terminal:error":
          setTerminals((prev) => prev.filter((t) => t.id !== msg.terminalId));
          setFocusOrder((prev) => prev.filter((v) => v !== msg.terminalId));
          break;

        case "message:new": {
          const newMsg = {
            from: msg.from,
            tag: msg.tag,
            preview: msg.preview,
            msgType: msg.msgType as any,
            messageId: msg.messageId,
            taskId: msg.taskId,
            artifactPath: msg.artifactPath,
            ts: new Date().toISOString(),
          };
          setTerminals((prev) =>
            prev.map((t) => {
              if (t.id !== msg.terminalId) return t;
              const updated = {
                ...t,
                unreadCount: (t.unreadCount ?? 0) + 1,
                lastMessage: newMsg,
                messages: [...(t.messages ?? []), newMsg],
              };
              if (msg.msgType === "blocker") updated.hasBlocker = true;
              if (msg.msgType === "question") updated.pendingQuestions = (t.pendingQuestions ?? 0) + 1;
              if (msg.msgType === "handoff") updated.hasHandoff = true;
              if (msg.msgType === "artifact_ready") updated.hasArtifactReady = true;
              return updated;
            })
          );
          break;
        }

        case "message:urgent":
          setTerminals((prev) =>
            prev.map((t) => t.id === msg.terminalId ? { ...t, needsAttention: true } : t)
          );
          break;

        case "artifact:update":
          setTerminals((prev) =>
            prev.map((t) => (t.id === msg.terminalId ? { ...t, artifacts: msg.files } : t))
          );
          break;

        case "artifact:content":
          setArtifactViewer((prev) =>
            prev && prev.terminalId === msg.terminalId && prev.fileName === msg.fileName
              ? { ...prev, content: msg.content }
              : prev
          );
          setTerminals((prev) =>
            prev.map((t) =>
              t.id !== msg.terminalId ? t : {
                ...t,
                openArtifacts: (t.openArtifacts ?? []).map((a) =>
                  a.fileName === msg.fileName ? { ...a, content: msg.content } : a
                ),
              }
            )
          );
          break;

        case "usage:cost_summary":
          setCostSummary(msg.summary);
          break;

        case "folder:preset_updated":
          setFolders((prev) =>
            prev.map((f) => (f.id === msg.pathId ? msg.folder : f))
          );
          break;

        case "scratchpad:history":
          setScratchpadMessages((prev) => ({ ...prev, [msg.pathId]: msg.entries }));
          break;

        case "scratchpad:message":
          setScratchpadMessages((prev) => ({
            ...prev,
            [msg.pathId]: [...(prev[msg.pathId] ?? []), msg.entry],
          }));
          break;
      }
    });
  }, [addHandler, send]);

  // Auto-respawn coordinator when it exits
  useEffect(() => {
    for (const t of terminals) {
      if (t.tag === "coordinator" && t.exited) {
        setTerminals((prev) => prev.filter((x) => x.id !== t.id));
        setFocusOrder((prev) => prev.filter((x) => x !== t.id));
        spawnCoordinator(t.pathId);
        break;
      }
    }
  }, [terminals, spawnCoordinator]);

  // Poll cost data
  useEffect(() => {
    if (!activeId) { setCostSummary(null); return; }
    send({ type: "usage:cost_request", pathId: activeId });
    const interval = setInterval(() => {
      send({ type: "usage:cost_request", pathId: activeId });
    }, 30_000);
    return () => clearInterval(interval);
  }, [activeId, send]);

  const activeFolder = folders.find((f) => f.id === activeId) ?? null;
  const coordinator = terminals.find((t) => t.pathId === activeId && t.tag === "coordinator") ?? null;
  const agents = terminals.filter((t) => t.pathId === activeId && t.tag !== "coordinator");

  // ── Shared callbacks ──────────────────────────────────

  const handleChatSend = useCallback((to: string, msg: string, msgType: string) => {
    if (!activeId) return;
    send({ type: "chat:send", pathId: activeId, to, msg, msgType });
  }, [send, activeId]);

  useEffect(() => {
    if (showChat && activeId) {
      send({ type: "scratchpad:load", pathId: activeId });
    }
  }, [showChat, activeId, send]);

  const handleClose = useCallback((id: string) => {
    const target = terminalsRef.current.find((t) => t.id === id);
    if (target?.tag === "coordinator") return;
    if (target && target.mode !== "role" && !target.exited) {
      if (!window.confirm("This terminal is temporary and won't be restored. Close anyway?")) return;
    }
    send({ type: "terminal:close", terminalId: id });
    setTerminals((prev) => prev.filter((t) => t.id !== id));
    setFocusOrder((prev) => prev.filter((v) => v !== id));
    setFocusedTerminalId((prev) => (prev === id ? null : prev));
  }, [send]);


  // Overview grid modal (structured overview only)
  const handleArtifactClick = useCallback((terminalId: string, fileName: string) => {
    setArtifactViewer({ terminalId, fileName, content: null });
    send({ type: "artifact:read", terminalId, fileName });
  }, [send]);
  const handleArtifactClose = useCallback(() => { setArtifactViewer(null); }, []);

  // Per-terminal artifact panel (canvas + focus view)
  const handleTerminalArtifactToggle = useCallback((terminalId: string, fileName: string) => {
    setTerminals((prev) =>
      prev.map((t) => {
        if (t.id !== terminalId) return t;
        const already = (t.openArtifacts ?? []).find((a) => a.fileName === fileName);
        if (already) {
          // Already open — just activate it
          return { ...t, activeArtifactName: fileName };
        }
        // Open new tab
        return {
          ...t,
          openArtifacts: [...(t.openArtifacts ?? []), { fileName, content: null }],
          activeArtifactName: fileName,
        };
      })
    );
    // Fetch content (no-op if already cached — content update will be ignored if already set)
    const t = terminalsRef.current.find((t) => t.id === terminalId);
    const alreadyLoaded = (t?.openArtifacts ?? []).find((a) => a.fileName === fileName && a.content !== null);
    if (!alreadyLoaded) send({ type: "artifact:read", terminalId, fileName });
  }, [send]);

  const handleTerminalArtifactActivate = useCallback((terminalId: string, fileName: string) => {
    setTerminals((prev) =>
      prev.map((t) => t.id === terminalId ? { ...t, activeArtifactName: fileName } : t)
    );
  }, []);

  const handleTerminalArtifactClose = useCallback((terminalId: string, fileName: string) => {
    setTerminals((prev) =>
      prev.map((t) => {
        if (t.id !== terminalId) return t;
        const remaining = (t.openArtifacts ?? []).filter((a) => a.fileName !== fileName);
        const nextActive = t.activeArtifactName === fileName
          ? (remaining[remaining.length - 1]?.fileName ?? null)
          : t.activeArtifactName;
        return { ...t, openArtifacts: remaining, activeArtifactName: nextActive };
      })
    );
  }, []);

  const handleTerminalArtifactCloseAll = useCallback((terminalId: string) => {
    setTerminals((prev) =>
      prev.map((t) => t.id === terminalId ? { ...t, openArtifacts: [], activeArtifactName: null } : t)
    );
  }, []);


  const handleSelectFolder = useCallback((id: string) => {
    setActiveId(id);
    setArtifactViewer(null);
    setFocusedTerminalId(null);
    setViewMode("overview");
  }, []);

  const handleCloseWorkers = useCallback(() => {
    const workers = terminalsRef.current.filter((t) => t.pathId === activeId && t.tag !== "coordinator");
    if (workers.length === 0) return;
    const workerIds = new Set(workers.map((w) => w.id));
    for (const w of workers) send({ type: "terminal:close", terminalId: w.id });
    setTerminals((prev) => prev.filter((t) => !workerIds.has(t.id)));
    setFocusOrder((prev) => prev.filter((id) => !workerIds.has(id)));
    setFocusedTerminalId(null);
    setViewMode("overview");
  }, [activeId, send]);

  const handleAddFolder = useCallback((path: string) => { send({ type: "folder:add", path }); }, [send]);
  const handleRemoveFolder = useCallback((pathId: string) => { send({ type: "folder:remove", pathId }); }, [send]);

  // ── Structured mode callbacks ─────────────────────────

  const handleAgentClick = useCallback((id: string) => {
    setFocusedTerminalId(id);
    setViewMode("focus");
    setTerminals((prev) => prev.map((t) => (t.id === id && (t.unreadCount ?? 0) > 0 ? { ...t, unreadCount: 0 } : t)));
  }, []);

  const handleNewAgent = useCallback(() => {
    if (!activeId) return;
    const provider = (activeFolder?.defaultProvider ?? "claude") as "claude" | "codex";
    const key = `${activeId}:${provider}`;
    const count = (counterRef.current[key] ?? 0) + 1;
    counterRef.current[key] = count;
    const title = `${provider}-${count}`;
    send({ type: "terminal:create", pathId: activeId, x: 0, y: 0, provider, mode: "role", title });
  }, [activeId, activeFolder, send]);

  const handleRename = useCallback((id: string, name: string) => {
    setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, title: name } : t)));
    const t = terminalsRef.current.find((t) => t.id === id);
    if (t) send({ type: "terminal:update", terminalId: id, x: t.x, y: t.y, width: t.width, height: t.height, title: name });
  }, [send]);

  const handlePromote = useCallback((id: string) => {
    send({ type: "terminal:promote", terminalId: id });
  }, [send]);

  // ── Canvas mode callbacks ─────────────────────────────

  const handleCanvasClick = useCallback((canvasX: number, canvasY: number, screenX: number, screenY: number) => {
    if (!activeId) return;
    setSpawnMenu({ screenX, screenY, canvasX, canvasY });
  }, [activeId]);

  const handleSpawnSelect = useCallback((option: SpawnOption) => {
    if (!activeId) return;
    const cx = spawnMenu?.canvasX ?? window.innerWidth / 2;
    const cy = spawnMenu?.canvasY ?? window.innerHeight / 2;
    pendingClickRef.current = { x: cx, y: cy };
    pendingCommandRef.current = null;
    const provider = option as "claude" | "codex";
    const key = `${activeId}:${provider}`;
    const count = (counterRef.current[key] ?? 0) + 1;
    counterRef.current[key] = count;
    const title = `${provider}-${count}`;
    send({ type: "terminal:create", pathId: activeId, x: cx, y: cy, provider, mode: "role", title });
    setSpawnMenu(null);
  }, [activeId, send, spawnMenu]);

  const handleMove = useCallback((id: string, x: number, y: number) => {
    setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, x, y } : t)));
    const t = terminalsRef.current.find((t) => t.id === id);
    if (t) syncPosition(id, x, y, t.width, t.height);
  }, [syncPosition]);

  const handleResize = useCallback((id: string, width: number, height: number) => {
    setTerminals((prev) => {
      const updated = prev.map((t) => (t.id === id ? { ...t, width, height } : t));
      return nudgeOverlaps(updated, id);
    });
    const t = terminalsRef.current.find((t) => t.id === id);
    if (t) syncPosition(id, t.x, t.y, width, height);
  }, [syncPosition]);

  const handleFocus = useCallback((id: string) => {
    setFocusOrder((prev) => {
      if (prev[prev.length - 1] === id) return prev;
      return [...prev.filter((v) => v !== id), id];
    });
    setTerminals((prev) => prev.map((t) => (t.id === id && (t.unreadCount ?? 0) > 0 ? { ...t, unreadCount: 0 } : t)));
  }, []);

  const handleArrange = useCallback(() => {
    setTerminals((prev) => arrangeTerminals(prev));
  }, []);

  // Pre-refresh warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const hasQuick = terminals.some(t => t.mode !== "role" && t.tag !== "coordinator" && !t.exited);
      if (hasQuick) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [terminals]);

  const allActiveTerminals = terminals.filter((t) => t.pathId === activeId);
  const focusedTerminal = allActiveTerminals.find((t) => t.id === focusedTerminalId) ?? null;

  // Layout toggle shared between both modes
  const layoutToggle = (
    <div className="layout-toggle">
      <button className={`layout-toggle-btn${layoutMode === "structured" ? " active" : ""}`} onClick={() => setLayoutMode("structured")}>Structured</button>
      <button className={`layout-toggle-btn${layoutMode === "canvas" ? " active" : ""}`} onClick={() => setLayoutMode("canvas")}>Canvas</button>
    </div>
  );

  // ── STRUCTURED LAYOUT ─────────────────────────────────
  if (layoutMode === "structured") {
    return (
      <div className="app-shell">
        <div className="main-area">
          <TopNav
            folders={folders}
            activeFolder={activeFolder}
            activeId={activeId}
            onSelectFolder={handleSelectFolder}
            onAddFolder={handleAddFolder}
            onRemoveFolder={handleRemoveFolder}
            folderError={folderError}
            costSummary={costSummary}
            viewMode={viewMode}
            onViewModeChange={(mode) => {
              setViewMode(mode);
              if (mode === "focus") {
                const current = allActiveTerminals.find((t) => t.id === focusedTerminalId);
                if (!current) {
                  const target = agents[0] ?? coordinator;
                  if (target) setFocusedTerminalId(target.id);
                }
              }
            }}
            onOpenSettings={() => setShowSettings(true)}
            onOpenChat={() => setShowChat(true)}
            send={send}
            layoutToggle={layoutToggle}
          />
          {viewMode === "overview" && (
            <CoordinatorBar
              coordinator={coordinator}
              agents={agents}
              focusedTerminalId={focusedTerminalId}
              onAgentClick={handleAgentClick}
              onCoordinatorClick={() => { if (coordinator) { setFocusedTerminalId(coordinator.id); setViewMode("focus"); } }}
              onNewAgent={handleNewAgent}
            />
          )}
          <div className="content-area">
            {viewMode === "overview" ? (
              <OverviewGrid coordinator={coordinator} agents={agents} focusedTerminalId={focusedTerminalId} viewMode={viewMode} onAgentClick={handleAgentClick} onClose={handleClose} onRename={handleRename} onPromote={handlePromote} onArtifactClick={handleArtifactClick} send={send} addHandler={addHandler} theme={canvasTheme} />
            ) : (
              focusedTerminal && <FocusView terminal={focusedTerminal} onRename={handleRename} onPromote={handlePromote} onBack={() => setViewMode("overview")} send={send} addHandler={addHandler} theme={canvasTheme} />
            )}
          </div>
        </div>
        {artifactViewer && (
          <div className="artifact-modal-overlay" onClick={handleArtifactClose}>
            <div className="artifact-modal" onClick={(e) => e.stopPropagation()}>
              <div className="artifact-modal-header">
                <span className="artifact-modal-filename">{artifactViewer.fileName}</span>
                <button className="artifact-modal-close" onClick={handleArtifactClose}>×</button>
              </div>
              <div className="artifact-modal-content">
                {artifactViewer.content === null ? <span className="artifact-modal-loading">Loading...</span> : <pre>{artifactViewer.content}</pre>}
              </div>
            </div>
          </div>
        )}
        {showSettings && (
          <SettingsPanel canvasTheme={canvasTheme} onCanvasThemeChange={setCanvasTheme} onCloseWorkers={handleCloseWorkers} workerCount={agents.length} onClose={() => setShowSettings(false)} />
        )}
        {showChat && (
          <ChatPanel
            terminals={terminals.filter((t) => t.pathId === activeId && !t.exited)}
            messages={scratchpadMessages[activeId ?? ""] ?? []}
            onSend={handleChatSend}
            onClose={() => setShowChat(false)}
          />
        )}
      </div>
    );
  }

  // ── CANVAS LAYOUT ─────────────────────────────────────
  return (
    <div className="app-shell">
      {sidebarCollapsed ? (
        <div className="sidebar-collapsed">
          <button className="sidebar-expand-btn" onClick={() => setSidebarCollapsed(false)} title="Expand sidebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      ) : (
        <ProjectSidebar
          folders={folders} activeId={activeId} onSelect={handleSelectFolder} onAdd={handleAddFolder} onRemove={handleRemoveFolder}
          folderError={folderError} terminals={allActiveTerminals} focusedTerminalId={focusOrder[focusOrder.length - 1] ?? null}
          onTerminalClick={(id) => {
            handleFocus(id);
            const t = terminalsRef.current.find((t) => t.id === id);
            if (t) canvasRef.current?.centerOn(t.x, t.y, t.width, t.height);
          }} onTerminalClose={handleClose} onPromote={handlePromote}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      )}
      <div className="main-area">
        <WorkspaceHeader
          activeFolder={activeFolder}
          onOpenSettings={() => setShowSettings(true)}
          onOpenChat={() => setShowChat(true)}
          costSummary={costSummary}
          layoutToggle={layoutToggle}
        />
        <TerminalCanvas ref={canvasRef} canSpawn={activeFolder !== null} onCanvasClick={handleCanvasClick}>
          {terminals.filter((t) => t.pathId === activeId).map((t) => (
            <TerminalWindow
              key={t.id} model={t} onMove={handleMove} onResize={handleResize} onClose={handleClose}
              onFocus={handleFocus} onRename={handleRename} onPromote={handlePromote} zIndex={10 + focusOrder.indexOf(t.id)}
              onArtifactClick={handleTerminalArtifactToggle}
            >
              <TerminalPane terminalId={t.id} send={send} addHandler={addHandler} theme={canvasTheme} />
            </TerminalWindow>
          ))}
          {terminals.filter((t) => t.pathId === activeId && (t.openArtifacts?.length ?? 0) > 0).map((t) => (
            <ArtifactViewer
              key={t.id}
              terminal={t}
              openArtifacts={t.openArtifacts!}
              activeArtifactName={t.activeArtifactName ?? t.openArtifacts![0].fileName}
              onActivate={handleTerminalArtifactActivate}
              onClose={handleTerminalArtifactClose}
              onCloseAll={handleTerminalArtifactCloseAll}
            />
          ))}
        </TerminalCanvas>
        {spawnMenu && (
          <SpawnMenu x={spawnMenu.screenX} y={spawnMenu.screenY} onSelect={handleSpawnSelect} onClose={() => setSpawnMenu(null)} />
        )}
        {showSettings && (
          <SettingsPanel canvasTheme={canvasTheme} onCanvasThemeChange={setCanvasTheme} onCloseWorkers={handleCloseWorkers} onArrange={terminals.filter((t) => t.pathId === activeId).length > 1 ? handleArrange : undefined} workerCount={agents.length} onClose={() => setShowSettings(false)} />
        )}
        {showChat && (
          <ChatPanel
            terminals={terminals.filter((t) => t.pathId === activeId && !t.exited)}
            messages={scratchpadMessages[activeId ?? ""] ?? []}
            onSend={handleChatSend}
            onClose={() => setShowChat(false)}
          />
        )}
      </div>
    </div>
  );
}
