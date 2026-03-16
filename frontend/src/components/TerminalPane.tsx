import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ClientMessage, ServerMessage } from "../types";

type Props = {
  terminalId: string;
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
};

export function TerminalPane({ terminalId, send, addHandler }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', Menlo, Monaco, monospace",
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#3a3a5c",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fit;

    requestAnimationFrame(() => {
      fit.fit();
      send({
        type: "terminal:resize",
        terminalId,
        cols: term.cols,
        rows: term.rows,
      });
    });

    term.onData((data) => {
      send({ type: "terminal:input", terminalId, data });
    });

    const removeHandler = addHandler((msg: ServerMessage) => {
      if (msg.type === "terminal:output" && msg.terminalId === terminalId) {
        term.write(msg.data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fit.fit();
        send({
          type: "terminal:resize",
          terminalId,
          cols: term.cols,
          rows: term.rows,
        });
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      removeHandler();
      term.dispose();
    };
  }, [terminalId, send, addHandler]);

  return <div ref={containerRef} className="terminal-pane" />;
}
