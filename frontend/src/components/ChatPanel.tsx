import { useState, useRef, useEffect, useCallback } from "react";
import type { TerminalWindowModel, ScratchpadEntry } from "../types";

type Props = {
  terminals: TerminalWindowModel[];
  messages: ScratchpadEntry[];
  onSend: (to: string, msg: string, msgType: string) => void;
  onClose: () => void;
};

const MSG_TYPES = [
  { value: "task_assign", label: "task_assign" },
  { value: "chat", label: "chat" },
  { value: "question", label: "question" },
  { value: "status_update", label: "status_update" },
];

const TYPE_COLORS: Record<string, string> = {
  task_assign: "#7aa2f7",
  chat: "#9ece6a",
  question: "#e0af68",
  status_update: "#bb9af7",
  blocker: "#f7768e",
  handoff: "#2ac3de",
  artifact_ready: "#73daca",
};

function formatTime(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function shortName(name: string) {
  // Strip timestamp prefix like "2024-01-01-12-00-"
  return name.replace(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-/, "");
}

export function ChatPanel({ terminals, messages, onSend, onClose }: Props) {
  const coordinator = terminals.find((t) => t.tag === "coordinator");
  const workers = terminals.filter((t) => t.tag !== "coordinator");

  const agentOptions: { value: string; label: string }[] = [];
  if (coordinator) agentOptions.push({ value: coordinator.title.toLowerCase(), label: "Coordinator" });
  for (const w of workers) agentOptions.push({ value: w.title.toLowerCase(), label: w.title });
  agentOptions.push({ value: "*", label: "All agents (*)" });

  const [tab, setTab] = useState<"chat" | "send">("chat");
  const [to, setTo] = useState(agentOptions[0]?.value ?? "*");
  const [msgType, setMsgType] = useState("task_assign");
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Close on ESC or click outside
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onMouse = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [onClose]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (tab === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, tab]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(to, trimmed, msgType);
    setText("");
    // Switch to chat tab after sending so user sees the message appear
    setTab("chat");
  }, [text, to, msgType, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx !== -1 && !before.slice(atIdx + 1).includes(" ")) {
      setMentionStart(atIdx);
      setMentionQuery(before.slice(atIdx + 1).toLowerCase());
    } else {
      setMentionQuery(null);
    }
  };

  const handleMentionSelect = (agentValue: string) => {
    setTo(agentValue);
    const before = text.slice(0, mentionStart);
    const after = text.slice(textareaRef.current?.selectionStart ?? text.length);
    setText(before + after);
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  const filteredMentions = mentionQuery !== null
    ? agentOptions.filter((a) => a.label.toLowerCase().includes(mentionQuery))
    : [];

  // Filter out internal system noise (rename, system status messages)
  const visibleMessages = messages.filter(
    (m) => !(m.from === "system" && m.tag === "rename")
  );

  return (
    <div className="chat-panel" ref={panelRef}>
      <div className="chat-panel-header">
        <span className="chat-panel-title">Chat</span>
        <div className="chat-panel-tabs">
          <button
            className={`chat-panel-tab${tab === "chat" ? " active" : ""}`}
            onClick={() => setTab("chat")}
          >
            Group
          </button>
          <button
            className={`chat-panel-tab${tab === "send" ? " active" : ""}`}
            onClick={() => setTab("send")}
          >
            Send
          </button>
        </div>
        <button className="chat-panel-close" onClick={onClose}>×</button>
      </div>

      {tab === "chat" ? (
        <>
          <div className="chat-panel-feed">
            {visibleMessages.length === 0 ? (
              <div className="chat-panel-feed-empty">No messages yet</div>
            ) : (
              visibleMessages.map((m, i) => {
                const isUser = m.from === "user";
                return (
                  <div key={m.id ?? i} className={`chat-bubble${isUser ? " chat-bubble-user" : ""}`}>
                    <div className="chat-bubble-meta">
                      <span className="chat-bubble-from">{isUser ? "you" : shortName(m.from)}</span>
                      {m.to && m.to !== "*" && (
                        <span className="chat-bubble-arrow">→ {shortName(m.to)}</span>
                      )}
                      {m.to === "*" && (
                        <span className="chat-bubble-arrow">→ all</span>
                      )}
                      <span
                        className="chat-bubble-type"
                        style={{ background: TYPE_COLORS[m.msgType ?? m.tag] ?? "#545775" }}
                      >
                        {m.msgType ?? m.tag}
                      </span>
                      <span className="chat-bubble-time">{formatTime(m.ts)}</span>
                    </div>
                    <div className="chat-bubble-body">{m.msg}</div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Inline compose at bottom of group chat */}
          <div className="chat-panel-inline-compose">
            <div className="chat-panel-inline-selects">
              <select className="chat-panel-select-sm" value={to} onChange={(e) => setTo(e.target.value)}>
                {agentOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select className="chat-panel-select-sm" value={msgType} onChange={(e) => setMsgType(e.target.value)}>
                {MSG_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div style={{ position: "relative" }}>
              <textarea
                ref={textareaRef}
                className="chat-panel-textarea"
                placeholder="Message... (@ to mention, ⌘↵ to send)"
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                rows={2}
              />
              {filteredMentions.length > 0 && (
                <div className="chat-panel-mention-list">
                  {filteredMentions.map((opt) => (
                    <button
                      key={opt.value}
                      className="chat-panel-mention-item"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleMentionSelect(opt.value); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="chat-panel-footer">
              <button className="chat-panel-send" onClick={handleSend}>
                Send <kbd>⌘↵</kbd>
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="chat-panel-body">
          <div className="chat-panel-fields">
            <div className="chat-panel-row">
              <label className="chat-panel-label">To:</label>
              <select className="chat-panel-select" value={to} onChange={(e) => setTo(e.target.value)}>
                {agentOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="chat-panel-row">
              <label className="chat-panel-label">Type:</label>
              <select className="chat-panel-select" value={msgType} onChange={(e) => setMsgType(e.target.value)}>
                {MSG_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <textarea
              ref={textareaRef}
              className="chat-panel-textarea chat-panel-textarea-grow"
              placeholder="Type a message... (@ to mention an agent)"
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
            />
            {filteredMentions.length > 0 && (
              <div className="chat-panel-mention-list">
                {filteredMentions.map((opt) => (
                  <button
                    key={opt.value}
                    className="chat-panel-mention-item"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleMentionSelect(opt.value); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="chat-panel-footer">
            <button className="chat-panel-send" onClick={handleSend}>
              Send <kbd>⌘↵</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
