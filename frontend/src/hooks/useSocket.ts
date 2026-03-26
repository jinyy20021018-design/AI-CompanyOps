import { useEffect, useRef, useCallback } from "react";
import type { ClientMessage, ServerMessage } from "../types";

type MessageHandler = (msg: ServerMessage) => void;

export function useSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const disposed = useRef(false);

  const connect = useCallback(() => {
    if (disposed.current) return;
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Connected to backend");
      ws.send(JSON.stringify({ type: "folder:list" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data as string);
        for (const handler of handlersRef.current) {
          handler(msg);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!disposed.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url]);

  useEffect(() => {
    disposed.current = false;
    connect();
    return () => {
      disposed.current = true;
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws) {
        // Only close if actually open — avoids "closed before established" warning
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.addEventListener("open", () => ws.close(), { once: true });
        }
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const addHandler = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return { send, addHandler };
}
