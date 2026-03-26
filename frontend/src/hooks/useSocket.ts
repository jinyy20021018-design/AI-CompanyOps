import { useEffect, useRef, useCallback } from "react";
import type { ClientMessage, ServerMessage } from "../types";

type MessageHandler = (msg: ServerMessage) => void;

export function useSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    // Don't create a new connection if one is already open or connecting
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // Only log + init if this is still the active socket
      if (wsRef.current === ws) {
        console.log("Connected to backend");
        ws.send(JSON.stringify({ type: "folder:list" }));
      } else {
        // Stale socket from a previous mount — close it
        ws.close();
      }
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return; // ignore messages from stale sockets
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
      // Only reconnect if this is still the active socket
      if (wsRef.current === ws) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn("WebSocket not open, message dropped:", msg.type);
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
