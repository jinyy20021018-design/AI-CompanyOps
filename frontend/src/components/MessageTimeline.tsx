import { useRef, useEffect, useState } from "react";
import type { ScratchpadEntry } from "../types";

const MSG_TYPE_STYLES: Record<string, { label: string; color: string }> = {
  task_assign:   { label: "TASK",    color: "#7aa2f7" },
  status_update: { label: "STATUS",  color: "#9ece6a" },
  handoff:       { label: "HANDOFF", color: "#bb9af7" },
  question:      { label: "Q",       color: "#e0af68" },
  blocker:       { label: "BLOCKED", color: "#f7768e" },
  chat:          { label: "CHAT",    color: "#787c99" },
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

type Props = {
  messages: ScratchpadEntry[];
  collapsed: boolean;
  onToggle: () => void;
};

export function MessageTimeline({ messages, collapsed, onToggle }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  return (
    <div className={`message-timeline${collapsed ? " message-timeline-collapsed" : ""}`}>
      <div className="message-timeline-header" onClick={onToggle}>
        <span className="message-timeline-title">Message Timeline</span>
        <span className="message-timeline-count">{messages.length}</span>
        <svg
          className={`message-timeline-chevron${collapsed ? "" : " open"}`}
          width="10" height="6" viewBox="0 0 10 6"
        >
          <path d="M0 0l5 6 5-6z" fill="currentColor" />
        </svg>
      </div>
      {!collapsed && (
        <div className="message-timeline-body" ref={scrollRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className="message-timeline-empty">No messages yet</div>
          ) : (
            messages.map((m, i) => {
              const style = MSG_TYPE_STYLES[m.msgType ?? "chat"] ?? MSG_TYPE_STYLES.chat;
              return (
                <div className="message-timeline-row" key={m.id ?? i}>
                  <span className="message-timeline-time">{formatTime(m.ts)}</span>
                  <span className="message-timeline-from">{m.from}</span>
                  <span className="message-timeline-arrow">&rarr;</span>
                  <span className="message-timeline-to">{m.to}</span>
                  <span
                    className="message-timeline-badge"
                    style={{ background: style.color }}
                  >
                    {style.label}
                  </span>
                  <span className="message-timeline-msg">{m.msg.slice(0, 120)}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
