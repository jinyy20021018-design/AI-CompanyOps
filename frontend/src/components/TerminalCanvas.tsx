import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
  type WheelEvent,
} from "react";

type Viewport = { x: number; y: number; scale: number };

type Props = {
  canSpawn: boolean;
  onCanvasClick: (canvasX: number, canvasY: number, screenX: number, screenY: number) => void;
  children: ReactNode;
};

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;

function clampScale(s: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

export function TerminalCanvas({ canSpawn, onCanvasClick, children }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef(viewport);
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const isPanning = useRef(false);
  const spaceHeld = useRef(false);

  // Keep ref in sync so event handlers always read current values
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  // Space key → pan cursor mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        spaceHeld.current = true;
        if (outerRef.current) outerRef.current.style.cursor = "grab";
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
        if (outerRef.current) outerRef.current.style.cursor = canSpawn ? "crosshair" : "default";
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [canSpawn]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = outerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom (trackpad) or Ctrl+wheel
      const factor = Math.exp(-e.deltaY * 0.008);
      setViewport((v) => {
        const newScale = clampScale(v.scale * factor);
        const ratio = newScale / v.scale;
        return { scale: newScale, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
      });
    } else {
      // Two-finger scroll → pan
      setViewport((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  }, []);

  // Attach wheel with { passive: false } via ref (React synthetic events can't do this)
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const handler = (e: Event) => handleWheel(e as unknown as WheelEvent);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [handleWheel]);

  const startPan = useCallback((clientX: number, clientY: number) => {
    isPanning.current = true;
    if (outerRef.current) outerRef.current.style.cursor = "grabbing";
    panState.current = {
      startX: clientX,
      startY: clientY,
      originX: viewportRef.current.x,
      originY: viewportRef.current.y,
    };

    const onMove = (ev: PointerEvent) => {
      if (!panState.current) return;
      setViewport((v) => ({
        ...v,
        x: panState.current!.originX + (ev.clientX - panState.current!.startX),
        y: panState.current!.originY + (ev.clientY - panState.current!.startY),
      }));
    };
    const onUp = () => {
      panState.current = null;
      // Small delay so the click handler sees isPanning=true and skips spawn
      setTimeout(() => { isPanning.current = false; }, 10);
      if (outerRef.current) {
        outerRef.current.style.cursor = spaceHeld.current ? "grab" : (canSpawn ? "crosshair" : "default");
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [canSpawn]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only act on events directly on the outer canvas (not on terminal windows)
    if (e.target !== e.currentTarget && !spaceHeld.current) return;
    if (e.button === 1 || spaceHeld.current) {
      e.preventDefault();
      startPan(e.clientX, e.clientY);
    }
  }, [startPan]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSpawn) return;
    if (e.target !== e.currentTarget) return;
    if (isPanning.current) return;

    const rect = outerRef.current!.getBoundingClientRect();
    const v = viewportRef.current;
    const canvasX = (e.clientX - rect.left - v.x) / v.scale;
    const canvasY = (e.clientY - rect.top - v.y) / v.scale;
    onCanvasClick(canvasX, canvasY, e.clientX, e.clientY);
  }, [canSpawn, onCanvasClick]);

  const zoomToward = useCallback((factor: number) => {
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setViewport((v) => {
      const newScale = clampScale(v.scale * factor);
      const ratio = newScale / v.scale;
      return { scale: newScale, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  const resetViewport = useCallback(() => setViewport({ x: 0, y: 0, scale: 1 }), []);

  return (
    <div
      ref={outerRef}
      className="terminal-canvas"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {!canSpawn && (
        <div className="canvas-empty-hint">
          Select a folder from the sidebar
          <br />
          then click anywhere to open a terminal
        </div>
      )}

      <div className="canvas-watermark">
        click canvas to open a terminal
      </div>

      <div
        className="canvas-viewport"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {children}
      </div>

      {/* Zoom controls */}
      <div className="canvas-controls">
        <button className="canvas-btn" onClick={() => zoomToward(ZOOM_STEP)} title="Zoom in (scroll up)">+</button>
        <span className="canvas-scale">{Math.round(viewport.scale * 100)}%</span>
        <button className="canvas-btn" onClick={() => zoomToward(1 / ZOOM_STEP)} title="Zoom out (scroll down)">−</button>
        <div className="canvas-divider" />
        <button className="canvas-btn" onClick={resetViewport} title="Reset view">Reset</button>
      </div>

      {/* Mini hint */}
      <div className="canvas-nav-hint">
        Scroll to pan · Pinch or Ctrl+scroll to zoom · Space+drag to pan
      </div>
    </div>
  );
}
