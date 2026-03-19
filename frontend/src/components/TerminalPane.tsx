import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ClientMessage, ServerMessage } from "../types";

const DARK_THEME = {
  background: "#0e1117",
  foreground: "#e6edf3",
  cursor: "#e6edf3",
  cursorAccent: "#0e1117",
  selectionBackground: "#264f78",
  selectionForeground: "#e6edf3",
  black: "#484f58",
  red: "#f87171",
  green: "#56d364",
  yellow: "#e3b341",
  blue: "#6e94ff",
  magenta: "#bc8cff",
  cyan: "#58d5e3",
  white: "#e6edf3",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#7ee787",
  brightYellow: "#f0c74f",
  brightBlue: "#89a8ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#76e4f2",
  brightWhite: "#f0f6fc",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1f2328",
  cursor: "#1f2328",
  cursorAccent: "#ffffff",
  selectionBackground: "#add6ff",
  selectionForeground: "#1f2328",
  black: "#24292f",
  red: "#cf222e",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#4a6ce6",
  magenta: "#8250df",
  cyan: "#0a7d8c",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#116329",
  brightYellow: "#7d4e00",
  brightBlue: "#3b5dd4",
  brightMagenta: "#6639ba",
  brightCyan: "#065d6a",
  brightWhite: "#8c959f",
};

type Props = {
  terminalId: string;
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
  theme?: "dark" | "light";
};

export function TerminalPane({ terminalId, send, addHandler, theme = "dark" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, monospace",
      theme: theme === "light" ? LIGHT_THEME : DARK_THEME,
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
      if (msg.type === "terminal:reconnected" && msg.terminalId === terminalId) {
        if (msg.bufferedOutput) {
          term.write(msg.bufferedOutput);
        }
      }
    });

    // Forward paste events from the container to xterm (handles focus-loss edge cases)
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text");
      if (text) { e.preventDefault(); term.paste(text); }
    };
    containerRef.current.addEventListener("paste", onPaste);

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

    const container = containerRef.current;
    return () => {
      resizeObserver.disconnect();
      removeHandler();
      container?.removeEventListener("paste", onPaste);
      term.dispose();
    };
  }, [terminalId, send, addHandler]);

  // Update xterm theme when theme prop changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme === "light" ? LIGHT_THEME : DARK_THEME;
    }
  }, [theme]);

  return <div ref={containerRef} className="terminal-pane" />;
}
