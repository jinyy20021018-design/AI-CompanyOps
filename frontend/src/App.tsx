import { useState, useCallback, useEffect, useRef } from "react";
import { useSocket } from "./hooks/useSocket";
import { TopNav } from "./components/TopNav";
import { CoordinatorBar } from "./components/CoordinatorBar";
import { OverviewGrid } from "./components/OverviewGrid";
import { FocusView } from "./components/FocusView";
import { SettingsPanel, type CoordinatorEngine, type CanvasTheme } from "./components/SettingsPanel";
import { ChatPanel } from "./components/ChatPanel";
import { FileBrowser } from "./components/FileBrowser";
import { MessageTimeline } from "./components/MessageTimeline";
import type { FolderEntry, TerminalWindowModel, ServerMessage, CostSummary, ScratchpadEntry } from "./types";
import { PresentationPage } from "./components/PresentationPage";

const COORD_WIDTH = 500;
const COORD_HEIGHT = 320;
const CLAUDE_PERMISSION_ARGS = "--allowedTools Bash,Read,Edit,Write --permission-mode dontAsk";

const DEPARTMENTS = [
  { id: "product",     title: "Product" },
  { id: "engineering", title: "Engineering" },
  { id: "marketing",   title: "Marketing" },
  { id: "qa",          title: "QA" },
  { id: "finance",     title: "Finance" },
] as const;
const FIXED_WORKER_COUNT = 5; // 1 CEO + 5 departments = 6 total

export default function App() {
  const { send, addHandler } = useSocket("ws://localhost:3001");

  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [restoredFlag, setRestoredFlag] = useState(0); // triggers re-render after terminal:list
  const [terminals, setTerminals] = useState<TerminalWindowModel[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [scratchpadMessages, setScratchpadMessages] = useState<Record<string, ScratchpadEntry[]>>({});
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>(
    () => (localStorage.getItem("canvasTheme") as CanvasTheme) || "dark"
  );

  const [viewMode, setViewMode] = useState<"overview" | "focus" | "files">("overview");
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null);

  const counterRef = useRef<Record<string, number>>({});
  const coordinatorSpawnedRef = useRef<Set<string>>(new Set());
  const foldersRef = useRef<FolderEntry[]>([]);
  const terminalsRef = useRef<TerminalWindowModel[]>([]);
  const pendingCommandRef = useRef<string | null>(null);
  const activityTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const outputBuffers = useRef<Record<string, string>>({});
  const humanWaitTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const coordinatorEngineRef = useRef<CoordinatorEngine>("claude");
  const restoredFoldersRef = useRef<Set<string>>(new Set());
  const coordinatorHasExistedRef = useRef<Set<string>>(new Set());
  const workersSpawnedRef = useRef<Set<string>>(new Set());

  const [artifactViewer, setArtifactViewer] = useState<{
    terminalId: string; fileName: string; content: string | null;
  } | null>(null); // used only for structured overview modal

  const [presentation, setPresentation] = useState<{
    terminalId: string; sessionName: string;
  } | null>(null);

  useEffect(() => { foldersRef.current = folders; }, [folders]);
  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => { localStorage.setItem("canvasTheme", canvasTheme); }, [canvasTheme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", canvasTheme);
  }, [canvasTheme]);

  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);


  // Spawn coordinator helper
  const spawnCoordinator = useCallback((pathId: string) => {
    const engine = coordinatorEngineRef.current;
    const claudeMode = engine === "claude" ? ` ${CLAUDE_PERMISSION_ARGS}` : "";
    if (coordinatorHasExistedRef.current.has(pathId)) {
      pendingCommandRef.current = engine === "claude"
        ? `coagent-claude --model sonnet${claudeMode} --resume coordinator`
        : `${engine} --model sonnet --resume coordinator`;
    } else {
      pendingCommandRef.current = engine === "claude"
        ? `coagent-claude --model sonnet${claudeMode} -n coordinator`
        : `${engine} --model sonnet -n coordinator`;
      coordinatorHasExistedRef.current.add(pathId);
    }
    console.log("[CoAgent] Sending terminal:create for coordinator", pathId);
    send({ type: "terminal:create", pathId, x: 0, y: 0, provider: coordinatorEngineRef.current as "claude" | "codex", mode: "role", role: "coordinator" });
  }, [send]);

  // Auto-spawn coordinator when a folder becomes active
  useEffect(() => {
    console.log("[CoAgent] Coordinator effect:", { activeId, hasFlag: activeId ? restoredFoldersRef.current.has(activeId) : false, alreadySpawned: activeId ? coordinatorSpawnedRef.current.has(activeId) : false });
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
    console.log("[CoAgent] Spawning coordinator for", activeId);
    coordinatorSpawnedRef.current.add(activeId);
    spawnCoordinator(activeId);
  }, [activeId, terminals, restoredFlag, spawnCoordinator]);

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
          console.log("[CoAgent] folder:added", msg.folder);
          setFolders((prev) => [...prev, msg.folder]);
          setActiveId(msg.folder.id);
          setFolderError(null);
          send({ type: "terminal:list", pathId: msg.folder.id });
          break;

        case "folder:removed":
          setFolders((prev) => prev.filter((f) => f.id !== msg.pathId));
          setActiveId((prev) => (prev === msg.pathId ? null : prev));
          // Clear coordinator tracking so it re-spawns if folder is re-added
          coordinatorSpawnedRef.current.delete(msg.pathId);
          coordinatorHasExistedRef.current.delete(msg.pathId);
          restoredFoldersRef.current.delete(msg.pathId);
          workersSpawnedRef.current.delete(msg.pathId);
          // Remove terminals belonging to this folder
          setTerminals((prev) => prev.filter((t) => t.pathId !== msg.pathId));
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
              title = "CEO";
            } else {
              const provider = entry.provider ?? "claude";
              const key = `${msg.pathId}:${provider}`;
              let count = (counterRef.current[key] ?? 0) + 1;
              let candidate = `${provider}-${count}`;
              while (usedTitles.has(candidate)) { count++; candidate = `${provider}-${count}`; }
              counterRef.current[key] = count;
              title = candidate;
              usedTitles.add(title);
            }
            return {
            id: entry.terminalId,
            pathId: msg.pathId,
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
          console.log("[CoAgent] terminal:list done, restoredFlag triggered for", msg.pathId);
          setRestoredFlag((n) => n + 1); // trigger coordinator spawn effect
          break;
        }

        case "terminal:created": {
          console.log("[CoAgent] terminal:created", msg.terminalId, msg.sessionType);
          const isCoordinator = msg.sessionType === "coordinator";

          let title: string;
          if (isCoordinator) {
            title = "CEO";
          } else if (msg.title) {
            title = msg.title;
          } else {
            const provider = msg.provider ?? "claude";
            const key = `${msg.pathId}:${provider}`;
            const count = (counterRef.current[key] ?? 0) + 1;
            counterRef.current[key] = count;
            title = `${provider}-${count}`;
          }

          const newTerminal: TerminalWindowModel = {
            id: msg.terminalId,
            pathId: msg.pathId,
            title,
            tag: isCoordinator ? "coordinator" : (msg.tag ?? undefined),
            sessionName: msg.sessionName,
            x: 0,
            y: 0,
            width: isCoordinator ? COORD_WIDTH : 420,
            height: isCoordinator ? COORD_HEIGHT : 260,
            mode: msg.mode,
            provider: msg.provider,
          };

          // Sync display title to backend registry
          send({ type: "terminal:update", terminalId: msg.terminalId, x: 0, y: 0, width: newTerminal.width, height: newTerminal.height, title });

          setTerminals((prev) => {
            const filtered = isCoordinator
              ? prev.filter((t) => !(t.pathId === msg.pathId && t.tag === "coordinator"))
              : prev;
            return [...filtered, newTerminal];
          });

          // Auto-input command
          let cmd: string | null = null;
          if (isCoordinator && pendingCommandRef.current && !msg.autoStarted) {
            cmd = pendingCommandRef.current;
            pendingCommandRef.current = null;
          } else if (!isCoordinator && !msg.autoStarted) {
            cmd = msg.provider === "codex" ? "codex" : `coagent-claude --model haiku ${CLAUDE_PERMISSION_ARGS}`;
          }
          if (msg.autoStarted) pendingCommandRef.current = null;
          if (cmd) {
            setTimeout(() => {
              send({ type: "terminal:input", terminalId: msg.terminalId, data: cmd + "\r" });
            }, 300);
          }
          send({ type: "artifact:list", terminalId: msg.terminalId });
          break;
        }

        case "terminal:output": {
          // Clear waitingForHuman when new output arrives (human responded)
          setTerminals((prev) =>
            prev.map((t) => (t.id === msg.terminalId ? { ...t, active: true, waitingForHuman: false } : t))
          );
          clearTimeout(activityTimers.current[msg.terminalId]);
          clearTimeout(humanWaitTimers.current[msg.terminalId]);

          // Buffer last 500 chars for pattern detection
          const buf = (outputBuffers.current[msg.terminalId] ?? "") + msg.data;
          outputBuffers.current[msg.terminalId] = buf.slice(-500);

          // After output settles (2s idle), check if Claude is waiting for human
          humanWaitTimers.current[msg.terminalId] = setTimeout(() => {
            const recent = outputBuffers.current[msg.terminalId] ?? "";
            // Strip ANSI escape codes for pattern matching
            const clean = recent.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
            const waitingPatterns = [
              /\(y\/n\)\s*$/,
              /\(Y\/n\)\s*$/,
              /\[Y\/n\]\s*$/,
              /\[yes\/no\]\s*$/i,
              /Do you want to proceed/i,
              /Allow\s+.*\?/i,
              /Press Enter to continue/i,
              /waiting for (?:your |user )?(?:input|response|confirmation)/i,
              /\?\s*$/,
            ];
            const isWaiting = waitingPatterns.some((p) => p.test(clean.trim()));
            if (isWaiting) {
              setTerminals((prev) =>
                prev.map((t) => (t.id === msg.terminalId && !t.exited ? { ...t, waitingForHuman: true } : t))
              );
            }
          }, 2000);

          activityTimers.current[msg.terminalId] = setTimeout(() => {
            setTerminals((prev) =>
              prev.map((t) => (t.id === msg.terminalId ? { ...t, active: false } : t))
            );
          }, 1500);
          break;
        }

        case "terminal:exit":
          clearTimeout(activityTimers.current[msg.terminalId]);
          clearTimeout(humanWaitTimers.current[msg.terminalId]);
          delete activityTimers.current[msg.terminalId];
          delete humanWaitTimers.current[msg.terminalId];
          delete outputBuffers.current[msg.terminalId];
          setTerminals((prev) =>
            prev.map((t) => t.id === msg.terminalId ? { ...t, active: false, exited: true, exitCode: msg.exitCode, waitingForHuman: false } : t)
          );
          break;

        case "coordinator:complete":
          setPresentation({ terminalId: msg.terminalId, sessionName: msg.sessionName });
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

        case "terminal:demoted":
          setTerminals((prev) =>
            prev.map((t) => t.id === msg.terminalId
              ? { ...t, mode: "quick", promoted: false }
              : t
            )
          );
          break;

        case "terminal:error":
          setTerminals((prev) => prev.filter((t) => t.id !== msg.terminalId));
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

        case "artifact:preview:open":
          window.open(msg.url, "_blank");
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

  // Auto-respawn all 6 stable agents when they exit
  useEffect(() => {
    for (const t of terminals) {
      if (!t.exited) continue;
      if (t.tag === "coordinator") {
        setTerminals((prev) => prev.filter((x) => x.id !== t.id));
        spawnCoordinator(t.pathId);
        break;
      }
      const dept = DEPARTMENTS.find((d) => d.id === t.tag);
      if (dept) {
        setTerminals((prev) => prev.filter((x) => x.id !== t.id));
        const provider = (foldersRef.current.find((f) => f.id === t.pathId)?.defaultProvider ?? "claude") as "claude" | "codex";
        send({ type: "terminal:create", pathId: t.pathId, x: 0, y: 0, provider, mode: "role", role: dept.id, title: dept.title });
        break;
      }
    }
  }, [terminals, spawnCoordinator, send]);

  // Auto-spawn fixed workers when coordinator is ready
  useEffect(() => {
    if (!activeId) return;
    if (workersSpawnedRef.current.has(activeId)) return;
    const hasCoord = terminals.some(
      (t) => t.pathId === activeId && t.tag === "coordinator" && !t.exited
    );
    console.log("[CoAgent] Worker effect:", { activeId, hasCoord, workerCount: terminals.filter(t => t.pathId === activeId && t.tag !== "coordinator").length });
    if (!hasCoord) return;
    const existingWorkers = terminals.filter(
      (t) => t.pathId === activeId && t.tag !== "coordinator"
    );
    if (existingWorkers.length >= FIXED_WORKER_COUNT) {
      workersSpawnedRef.current.add(activeId);
      return;
    }
    workersSpawnedRef.current.add(activeId);
    const provider = (foldersRef.current.find((f) => f.id === activeId)?.defaultProvider ?? "claude") as "claude" | "codex";
    for (const dept of DEPARTMENTS) {
      if (!existingWorkers.some((w) => w.tag === dept.id)) {
        send({ type: "terminal:create", pathId: activeId, x: 0, y: 0, provider, mode: "role", role: dept.id, title: dept.title });
      }
    }
  }, [activeId, terminals, send]);

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
    if (activeId) {
      send({ type: "scratchpad:load", pathId: activeId });
    }
  }, [activeId, send]);

  const handleClose = useCallback((_id: string) => {
    // Terminals are fixed — closing is disabled
    return;
  }, []);


  // Overview grid modal (structured overview only)
  const handleArtifactClick = useCallback((terminalId: string, fileName: string) => {
    setArtifactViewer({ terminalId, fileName, content: null });
    send({ type: "artifact:read", terminalId, fileName });
  }, [send]);
  const handleArtifactClose = useCallback(() => { setArtifactViewer(null); }, []);



  const handleSelectFolder = useCallback((id: string) => {
    setActiveId(id);
    setArtifactViewer(null);
    setPresentation(null);
    setFocusedTerminalId(null);
    setViewMode("overview");
  }, []);

  const handleCloseWorkers = useCallback(() => {
    // Terminals are fixed — closing workers is disabled
    return;
  }, []);

  const handleAddFolder = useCallback((path: string) => {
    if (foldersRef.current.length >= 1) return; // only allow 1 folder
    send({ type: "folder:add", path });
  }, [send]);
  const handleRemoveFolder = useCallback((pathId: string) => {
    // Remove folder — backend handles killing all terminals for it
    send({ type: "folder:remove", pathId });
    // Clear frontend terminal state immediately
    setTerminals((prev) => prev.filter((t) => t.pathId !== pathId));
    setFocusedTerminalId(null);
    setViewMode("overview");
  }, [send]);

  // ── Structured mode callbacks ─────────────────────────

  const handleAgentClick = useCallback((id: string) => {
    setFocusedTerminalId(id);
    setViewMode("focus");
    setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, unreadCount: 0, needsAttention: false, pendingQuestions: 0, hasBlocker: false, hasHandoff: false, hasArtifactReady: false } : t)));
  }, []);

  const pickerOpenRef = useRef(false);
  const handlePickFolder = useCallback(async () => {
    if (foldersRef.current.length >= 1) return; // only allow 1 folder
    if (pickerOpenRef.current) return; // prevent double-open
    pickerOpenRef.current = true;
    try {
      const res = await fetch("http://localhost:3001/pick-folder", { method: "POST" });
      const data = await res.json();
      if (data.path) {
        send({ type: "folder:add", path: data.path });
      } else if (data.manual) {
        const manualPath = window.prompt(data.message ?? "Enter project folder path", data.suggestedPath ?? "/projects");
        if (manualPath?.trim()) {
          send({ type: "folder:add", path: manualPath.trim() });
        }
      } else if (!data.cancelled) {
        setFolderError("Could not open folder picker");
      }
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Could not open folder picker");
      setTimeout(() => setFolderError(null), 4000);
    } finally {
      pickerOpenRef.current = false;
    }
  }, [send]);

  const handleNewAgent = useCallback(() => {
    // Terminals are fixed at 5 — manual creation disabled
    return;
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, title: name } : t)));
    const t = terminalsRef.current.find((t) => t.id === id);
    if (t) send({ type: "terminal:update", terminalId: id, x: t.x, y: t.y, width: t.width, height: t.height, title: name });
  }, [send]);

  const handlePromote = useCallback((id: string) => {
    const t = terminalsRef.current.find((t) => t.id === id);
    if (t?.promoted) {
      send({ type: "terminal:demote", terminalId: id });
    } else {
      send({ type: "terminal:promote", terminalId: id });
    }
  }, [send]);


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
        />
        {activeId && (
          <MessageTimeline
            messages={scratchpadMessages[activeId] ?? []}
            collapsed={timelineCollapsed}
            onToggle={() => setTimelineCollapsed((v) => !v)}
          />
        )}
        {!activeId ? (
          <div className="welcome-screen">
            <div className="welcome-content">
              <div className="welcome-icon">📂</div>
              <h2 className="welcome-title">Choose a project folder</h2>
              <p className="welcome-desc">CoAgent needs a project folder to start orchestrating agents.</p>
              <button className="welcome-pick-btn" onClick={handlePickFolder}>
                Open folder...
              </button>
            </div>
          </div>
        ) : <>
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
          ) : viewMode === "files" ? (
            <FileBrowser terminals={allActiveTerminals} send={send} addHandler={addHandler} />
          ) : (
            focusedTerminal && <FocusView terminal={focusedTerminal} onRename={handleRename} onPromote={handlePromote} onBack={() => setViewMode("overview")} send={send} addHandler={addHandler} theme={canvasTheme} />
          )}
        </div>
        </>}
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
      {presentation && (
        <PresentationPage
          terminalId={presentation.terminalId}
          sessionName={presentation.sessionName}
          onClose={() => setPresentation(null)}
          send={send}
          addHandler={addHandler}
        />
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
