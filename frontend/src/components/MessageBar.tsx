import { useState } from "react";
import type { AgentMessage } from "../types";

type Props = {
  messages: AgentMessage[];
};

export function MessageBar({ messages }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (messages.length === 0) return null;

  const latest = messages[messages.length - 1];

  return (
    <div className="message-bar" onClick={(e) => e.stopPropagation()}>
      {/* Latest message — always visible */}
      <button
        className="message-bar-latest"
        onClick={() => setExpanded((p) => !p)}
        title={expanded ? "Collapse messages" : `${messages.length} message${messages.length > 1 ? "s" : ""} — click to expand`}
      >
        <span className={`message-bar-type message-bar-type-${latest.msgType ?? "chat"}`}>
          {latest.msgType ?? latest.tag}
        </span>
        <span className="message-bar-preview">{latest.preview}</span>
        <span className="message-bar-from">{latest.from}</span>
        {messages.length > 1 && (
          <span className="message-bar-count">{messages.length}</span>
        )}
        <span className="message-bar-chevron">{expanded ? "▾" : "▸"}</span>
      </button>

      {/* Expanded list — older messages */}
      {expanded && messages.length > 1 && (
        <div className="message-bar-list">
          {[...messages].reverse().slice(1).map((m, i) => (
            <div
              key={i}
              className={`message-bar-item${m.msgType === "blocker" ? " message-bar-item-blocker" : m.msgType === "question" ? " message-bar-item-question" : ""}`}
            >
              <span className={`message-bar-type message-bar-type-${m.msgType ?? "chat"}`}>
                {m.msgType ?? m.tag}
              </span>
              <span className="message-bar-preview">{m.preview}</span>
              <span className="message-bar-from">{m.from}</span>
              {m.ts && (
                <span className="message-bar-time">
                  {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
