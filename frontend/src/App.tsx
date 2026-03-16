import { useState, useCallback, useEffect, useRef } from "react";
import { useSocket } from "./hooks/useSocket";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { TerminalCanvas } from "./components/TerminalCanvas";
import { TerminalWindow } from "./components/TerminalWindow";
import { TerminalPane } from "./components/TerminalPane";
import { SpawnMenu, type SpawnOption } from "./components/SpawnMenu";
import { SettingsPanel, type CoordinatorEngine, type CanvasTheme } from "./components/SettingsPanel";
import { findFreePosition, arrangeTerminals, nudgeOverlaps } from "./utils/placement";
import type { FolderEntry, TerminalWindowModel, ServerMessage } from "./types";

const DEFAULT_WIDTH = 540;
const DEFAULT_HEIGHT = 320;

export default function App() {
  const { send, addHandler } = useSocket("ws://localhost:3001");

  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<TerminalWindowModel[]>([]);
  const [focusOrder, setFocusOrder] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [coordinatorEngine, setCoordinatorEngine] = useState<CoordinatorEngine>(
    () => (localStorage.getItem("coordinatorEngine") as CoordinatorEngine) || "claude"
  );
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>(
    () => (localStorage.getItem("canvasTheme") as CanvasTheme) || "dark"
  );

  const counterRef = useRef<Record<string, number>>({});
  const coordinatorSpawnedRef = useRef<Set<string>>(new Set());
  const foldersRef = useRef<FolderEntry[]>([]);
  const terminalsRef = useRef<TerminalWindowModel[]>([]);
  const pendingClickRef = useRef<{ x: number; y: number } | null>(null);
  const pendingCommandRef = useRef<string | null>(null);
  const activityTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const coordinatorEngineRef = useRef(coordinatorEngine);
  const [spawnMenu, setSpawnMenu] = useState<{ screenX: number; screenY: number; canvasX: number; canvasY: number } | null>(null);

  useEffect(() => { foldersRef.current = folders; }, [folders]);
  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => { coordinatorEngineRef.current = coordinatorEngine; }, [coordinatorEngine]);

  // Persist settings
  useEffect(() => { localStorage.setItem("coordinatorEngine", coordinatorEngine); }, [coordinatorEngine]);
  useEffect(() => { localStorage.setItem("canvasTheme", canvasTheme); }, [canvasTheme]);

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", canvasTheme);
  }, [canvasTheme]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Spawn coordinator helper — place at center-top of canvas
  const spawnCoordinator = useCallback((pathId: string) => {
    const engine = coordinatorEngineRef.current;
    pendingCommandRef.current = engine;
    // Pass the desired *center* of the terminal (findFreePosition subtracts width/2, height/2)
    const sidebarW = sidebarCollapsed ? 48 : 280;
    const centerX = (window.innerWidth - sidebarW) / 2;
    const centerY = 220; // 400/2 + 20px top padding
    send({ type: "terminal:create", pathId, x: centerX, y: centerY, sessionType: "coordinator" });
  }, [send, sidebarCollapsed]);

  // Auto-spawn coordinator when a folder becomes active (center-top of canvas)
  useEffect(() => {
    if (!activeId) return;
    if (coordinatorSpawnedRef.current.has(activeId)) return;
    const hasExisting = terminalsRef.current.some(
      (t) => t.pathId === activeId && t.tag === "coordinator" && !t.exited
    );
    if (hasExisting) return;
    coordinatorSpawnedRef.current.add(activeId);
    spawnCoordinator(activeId);
  }, [activeId, spawnCoordinator]);

  useEffect(() => {
    return addHandler((msg: ServerMessage) => {
      switch (msg.type) {
        case "folder:list":
          setFolders(msg.folders);
          if (msg.folders.length > 0) {
            setActiveId((prev) => prev ?? msg.folders[0].id);
          }
          break;

        case "folder:added":
          setFolders((prev) => [...prev, msg.folder]);
          setActiveId(msg.folder.id);
          setFolderError(null);
          break;

        case "folder:removed":
          setFolders((prev) => prev.filter((f) => f.id !== msg.pathId));
          setActiveId((prev) => (prev === msg.pathId ? null : prev));
          break;

        case "folder:error":
          setFolderError(msg.message);
          setTimeout(() => setFolderError(null), 4000);
          break;

        case "terminal:created": {
          const isCoordinator = msg.sessionType === "coordinator";
          const folder = foldersRef.current.find((f) => f.id === msg.pathId);
          const label = folder?.label ?? "terminal";

          let title: string;
          if (isCoordinator) {
            title = "Coordinator";
          } else {
            const count = (counterRef.current[msg.pathId] ?? 0) + 1;
            counterRef.current[msg.pathId] = count;
            title = `${label} #${count}`;
          }

          // Use queued canvas-space click coords for smart placement
          const click = pendingClickRef.current ?? { x: msg.x, y: msg.y };
          pendingClickRef.current = null;

          const termWidth = isCoordinator ? 600 : DEFAULT_WIDTH;
          const termHeight = isCoordinator ? 400 : DEFAULT_HEIGHT;

          const pos = findFreePosition(
            click.x,
            click.y,
            termWidth,
            termHeight,
            terminalsRef.current
          );

          const newTerminal: TerminalWindowModel = {
            id: msg.terminalId,
            pathId: msg.pathId,
            title,
            tag: msg.sessionType === "coordinator" ? "coordinator" : (msg.sessionType !== "shell" ? msg.sessionType : undefined),
            sessionName: msg.sessionName,
            x: pos.x,
            y: pos.y,
            width: termWidth,
            height: termHeight,
          };

          setTerminals((prev) => [...prev, newTerminal]);
          setFocusOrder((prev) => [...prev, msg.terminalId]);

          // Auto-input queued command (e.g. "claude" or "codex")
          const cmd = pendingCommandRef.current;
          if (cmd) {
            pendingCommandRef.current = null;
            setTimeout(() => {
              send({ type: "terminal:input", terminalId: msg.terminalId, data: cmd + "\n" });
            }, 300);
          }
          break;
        }

        case "terminal:output": {
          // Mark terminal as active, debounce back to idle after 1.5s
          setTerminals((prev) =>
            prev.map((t) => (t.id === msg.terminalId && !t.active ? { ...t, active: true } : t))
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
            prev.map((t) =>
              t.id === msg.terminalId
                ? { ...t, active: false, exited: true, exitCode: msg.exitCode }
                : t
            )
          );
          break;

        case "message:new":
          setTerminals((prev) =>
            prev.map((t) =>
              t.id === msg.terminalId
                ? { ...t, unreadCount: (t.unreadCount ?? 0) + 1 }
                : t
            )
          );
          break;
      }
    });
  }, [addHandler]);

  // Auto-respawn coordinator when it exits
  useEffect(() => {
    for (const t of terminals) {
      if (t.tag === "coordinator" && t.exited) {
        // Remove the exited coordinator and respawn
        setTerminals((prev) => prev.filter((x) => x.id !== t.id));
        setFocusOrder((prev) => prev.filter((x) => x !== t.id));
        spawnCoordinator(t.pathId);
        break;
      }
    }
  }, [terminals, spawnCoordinator]);

  const activeFolder = folders.find((f) => f.id === activeId) ?? null;

  const handleCanvasClick = useCallback(
    (canvasX: number, canvasY: number, screenX: number, screenY: number) => {
      if (!activeId) return;
      setSpawnMenu({ screenX, screenY, canvasX, canvasY });
    },
    [activeId]
  );

  const handleSpawnSelect = useCallback(
    (option: SpawnOption) => {
      if (!activeId || !spawnMenu) return;
      pendingClickRef.current = { x: spawnMenu.canvasX, y: spawnMenu.canvasY };
      if (option === "claude") {
        pendingCommandRef.current = "claude";
      } else if (option === "codex") {
        pendingCommandRef.current = "codex";
      }
      send({ type: "terminal:create", pathId: activeId, x: spawnMenu.canvasX, y: spawnMenu.canvasY, sessionType: option });
      setSpawnMenu(null);
    },
    [activeId, spawnMenu, send]
  );

  const handleMove = useCallback((id: string, x: number, y: number) => {
    setTerminals((prev) =>
      prev.map((t) => (t.id === id ? { ...t, x, y } : t))
    );
  }, []);

  const handleResize = useCallback((id: string, width: number, height: number) => {
    setTerminals((prev) => {
      const updated = prev.map((t) => (t.id === id ? { ...t, width, height } : t));
      return nudgeOverlaps(updated, id);
    });
  }, []);

  const handleFocus = useCallback((id: string) => {
    setFocusOrder((prev) => {
      if (prev[prev.length - 1] === id) return prev;
      return [...prev.filter((v) => v !== id), id];
    });
    setTerminals((prev) =>
      prev.map((t) => (t.id === id && (t.unreadCount ?? 0) > 0 ? { ...t, unreadCount: 0 } : t))
    );
  }, []);

  const handleTagChange = useCallback((id: string, tag: string) => {
    setTerminals((prev) =>
      prev.map((t) => (t.id === id ? { ...t, tag } : t))
    );
  }, []);

  const handleClose = useCallback(
    (id: string) => {
      // Prevent closing coordinator terminals
      const target = terminalsRef.current.find((t) => t.id === id);
      if (target?.tag === "coordinator") return;
      send({ type: "terminal:close", terminalId: id });
      setTerminals((prev) => prev.filter((t) => t.id !== id));
      setFocusOrder((prev) => prev.filter((v) => v !== id));
    },
    [send]
  );

  const handleArrange = useCallback(() => {
    setTerminals((prev) => arrangeTerminals(prev));
  }, []);

  const handleAddFolder = useCallback(
    (path: string) => { send({ type: "folder:add", path }); },
    [send]
  );

  const handleRemoveFolder = useCallback(
    (pathId: string) => { send({ type: "folder:remove", pathId }); },
    [send]
  );

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
          folders={folders}
          activeId={activeId}
          onSelect={setActiveId}
          onAdd={handleAddFolder}
          onRemove={handleRemoveFolder}
          folderError={folderError}
          send={send}
          addHandler={addHandler}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      )}
      <div className="main-area">
        <WorkspaceHeader
          activeFolder={activeFolder}
          terminalCount={terminals.filter((t) => t.pathId === activeId).length}
          onArrange={terminals.filter((t) => t.pathId === activeId).length > 1 ? handleArrange : undefined}
          onOpenSettings={() => setShowSettings(true)}
        />
        <TerminalCanvas
          canSpawn={activeFolder !== null}
          onCanvasClick={handleCanvasClick}
        >
          {terminals.map((t) => (
              <TerminalWindow
                key={t.id}
                model={t}
                onMove={handleMove}
                onResize={handleResize}
                onClose={handleClose}
                onFocus={handleFocus}
                onTagChange={handleTagChange}
                zIndex={10 + focusOrder.indexOf(t.id)}
              >
                <TerminalPane
                  terminalId={t.id}
                  send={send}
                  addHandler={addHandler}
                />
              </TerminalWindow>
          ))}
        </TerminalCanvas>
        {spawnMenu && (
          <SpawnMenu
            x={spawnMenu.screenX}
            y={spawnMenu.screenY}
            onSelect={handleSpawnSelect}
            onClose={() => setSpawnMenu(null)}
          />
        )}
        {showSettings && (
          <SettingsPanel
            coordinatorEngine={coordinatorEngine}
            canvasTheme={canvasTheme}
            onCoordinatorEngineChange={setCoordinatorEngine}
            onCanvasThemeChange={setCanvasTheme}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>
    </div>
  );
}
