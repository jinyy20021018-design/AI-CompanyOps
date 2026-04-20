import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { usePresentationArtifacts } from "../hooks/usePresentationArtifacts";
import type { ServerMessage, ClientMessage } from "../types";

const TAB_ORDER = ["final-report.md", "prd.md", "architecture.md", "gtm.md", "qa-review.md", "financial-model.md", "status-board.md"];
const TAB_LABELS: Record<string, string> = {
  "final-report.md": "Executive Summary",
  "prd.md": "Product",
  "architecture.md": "Engineering",
  "gtm.md": "Marketing",
  "qa-review.md": "QA",
  "financial-model.md": "Finance",
  "status-board.md": "Status Board",
};

const AGENTS = [
  { id: "CEO", label: "Coord.", border: "#7c3aed", bg: "#2e1065" },
  { id: "PRD", label: "Product", border: "#4c1d95", bg: "#1e1a2e" },
  { id: "ENG", label: "Engineer", border: "#4c1d95", bg: "#1e1a2e" },
  { id: "MKT", label: "Marketing", border: "#4c1d95", bg: "#1e1a2e" },
  { id: "QA", label: "QA", border: "#4c1d95", bg: "#1e1a2e" },
  { id: "FIN", label: "Finance", border: "#4c1d95", bg: "#1e1a2e" },
];

interface Props {
  terminalId: string;
  sessionName: string;
  onClose: () => void;
  send: (msg: ClientMessage) => void;
  addHandler: (handler: (msg: ServerMessage) => void) => () => void;
}

export function PresentationPage({ terminalId, sessionName, onClose, send, addHandler }: Props) {
  const { files, contents, loading } = usePresentationArtifacts(terminalId, send, addHandler);
  const [phase, setPhase] = useState<"intro" | "report">("intro");
  const [activeTab, setActiveTab] = useState<string>("");

  // Auto-transition from intro to report after 4s
  useEffect(() => {
    const t = setTimeout(() => setPhase("report"), 4000);
    return () => clearTimeout(t);
  }, []);

  // Set initial active tab when files load
  useEffect(() => {
    if (files.length === 0) return;
    const ordered = TAB_ORDER.filter((name) => files.some((f) => f.name === name));
    const others = files.filter((f) => f.name !== "app-preview.html" && !TAB_ORDER.includes(f.name)).map((f) => f.name);
    const allTabs = [...ordered, ...others];
    if (!activeTab && allTabs.length > 0) setActiveTab(allTabs[0]);
  }, [files, activeTab]);

  const mdFiles = files.filter((f) => f.name !== "app-preview.html");
  const orderedTabs = [
    ...TAB_ORDER.filter((name) => mdFiles.some((f) => f.name === name)),
    ...mdFiles.filter((f) => !TAB_ORDER.includes(f.name)).map((f) => f.name),
  ];
  const appPreviewHtml = contents["app-preview.html"] ?? null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#0a0a0f", display: "flex", flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      animation: "fadeIn 0.6s ease",
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: translateY(0) } }
        .agent-avatar { animation: slideUp 0.5s ease forwards; opacity: 0; }
        .agent-avatar:nth-child(1) { animation-delay: 0.3s }
        .agent-avatar:nth-child(2) { animation-delay: 0.6s }
        .agent-avatar:nth-child(3) { animation-delay: 0.9s }
        .agent-avatar:nth-child(4) { animation-delay: 1.2s }
        .agent-avatar:nth-child(5) { animation-delay: 1.5s }
        .agent-avatar:nth-child(6) { animation-delay: 1.8s }
        .md-content h1 { color: #e5e7eb; font-size: 18px; font-weight: 700; border-bottom: 1px solid #1f1f2e; padding-bottom: 8px; margin: 0 0 12px 0 }
        .md-content h2 { color: #e5e7eb; font-size: 14px; font-weight: 600; margin: 16px 0 8px 0 }
        .md-content h3 { color: #c4b5fd; font-size: 13px; font-weight: 600; margin: 12px 0 6px 0 }
        .md-content p { color: #9ca3af; font-size: 13px; line-height: 1.75; margin: 0 0 10px 0 }
        .md-content ul, .md-content ol { color: #9ca3af; font-size: 13px; line-height: 1.75; padding-left: 20px; margin: 0 0 10px 0 }
        .md-content li { margin-bottom: 4px }
        .md-content strong { color: #c4b5fd }
        .md-content code { background: #1f1f2e; color: #a78bfa; padding: 1px 5px; border-radius: 3px; font-size: 12px }
        .md-content pre { background: #1f1f2e; padding: 12px; border-radius: 6px; overflow-x: auto; margin: 0 0 12px 0 }
        .md-content pre code { background: none; padding: 0 }
        .md-content table { border-collapse: collapse; width: 100%; margin: 0 0 12px 0 }
        .md-content th { background: #1f1f2e; color: #c4b5fd; font-size: 12px; padding: 6px 10px; text-align: left }
        .md-content td { color: #9ca3af; font-size: 12px; padding: 6px 10px; border-top: 1px solid #1f1f2e }
        .tab-btn { padding: 10px 16px; font-size: 11px; cursor: pointer; border: none; background: none; white-space: nowrap; transition: color 0.2s }
        .tab-btn:hover { color: #c4b5fd !important }
      `}</style>

      {/* Close button */}
      <button
        onClick={onClose}
        style={{ position: "absolute", top: 16, right: 20, background: "none", border: "none", color: "#6b7280", fontSize: 20, cursor: "pointer", zIndex: 10 }}
      >×</button>

      {/* Phase 1: Cinematic Intro */}
      {phase === "intro" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 24px" }}>
          <div style={{ color: "#7c3aed", fontSize: 10, letterSpacing: 4, textTransform: "uppercase", marginBottom: 20 }}>
            COAGENT · AI COMPANY REPORT
          </div>
          <div style={{ color: "#fff", fontSize: 32, fontWeight: 800, marginBottom: 6 }}>
            {sessionName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </div>
          <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 32 }}>Full company deliverable</div>
          <div style={{ display: "flex", gap: 16, marginBottom: 28, justifyContent: "center", flexWrap: "wrap" }}>
            {AGENTS.map((a) => (
              <div key={a.id} className="agent-avatar" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: a.bg, border: `2px solid ${a.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#c4b5fd", fontWeight: 700 }}>
                  {a.id}
                </div>
                <div style={{ fontSize: 9, color: "#6b7280" }}>{a.label}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setPhase("report")}
            style={{ marginTop: 8, background: "none", border: "1px solid #4c1d95", color: "#a78bfa", padding: "6px 20px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
          >
            View Report ↓
          </button>
        </div>
      )}

      {/* Phase 2: Split view */}
      {phase === "report" && (
        <>
          {/* Compact hero header */}
          <div style={{ borderBottom: "1px solid #1a0a3a", padding: "14px 24px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ color: "#7c3aed", fontSize: 9, letterSpacing: 3, textTransform: "uppercase" }}>COAGENT</div>
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 700 }}>{sessionName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</div>
            <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
              {AGENTS.map((a) => (
                <div key={a.id} style={{ width: 24, height: 24, borderRadius: "50%", background: a.bg, border: `1.5px solid ${a.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#c4b5fd", fontWeight: 700 }}>
                  {a.id}
                </div>
              ))}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                onClick={() => window.print()}
                style={{ background: "#1f1030", color: "#a78bfa", fontSize: 10, padding: "5px 12px", borderRadius: 4, border: "1px solid #4c1d95", cursor: "pointer" }}
              >
                Export PDF
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(window.location.href); }}
                style={{ background: "#7c3aed", color: "#fff", fontSize: 10, padding: "5px 12px", borderRadius: 4, border: "none", cursor: "pointer" }}
              >
                Share ↗
              </button>
            </div>
          </div>

          {/* Split content */}
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden" }}>

            {/* Left: App preview iframe */}
            <div style={{ borderRight: "1px solid #1a0a3a", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "8px 12px", background: "#080810", borderBottom: "1px solid #1a0a3a", display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f57" }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#febc2e" }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#28c840" }} />
                <div style={{ flex: 1, background: "#0f0f1a", borderRadius: 3, padding: "2px 10px", fontSize: 10, color: "#4b5563", textAlign: "center" }}>
                  app-preview.html
                </div>
              </div>
              <div style={{ flex: 1, overflow: "hidden" }}>
                {loading && !appPreviewHtml ? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#4b5563", fontSize: 12 }}>
                    Loading preview...
                  </div>
                ) : appPreviewHtml ? (
                  <iframe
                    srcDoc={appPreviewHtml}
                    style={{ width: "100%", height: "100%", border: "none" }}
                    sandbox="allow-scripts"
                    title="App Preview"
                  />
                ) : (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#4b5563", fontSize: 12 }}>
                    No app preview generated
                  </div>
                )}
              </div>
            </div>

            {/* Right: Proposal tabs */}
            <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid #1a0a3a", background: "#080810", flexShrink: 0 }}>
                {orderedTabs.map((name) => (
                  <button
                    key={name}
                    className="tab-btn"
                    onClick={() => setActiveTab(name)}
                    style={{
                      color: activeTab === name ? "#a78bfa" : "#4b5563",
                      borderBottom: activeTab === name ? "2px solid #7c3aed" : "2px solid transparent",
                    }}
                  >
                    {TAB_LABELS[name] ?? name.replace(".md", "")}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
                {loading && !contents[activeTab] ? (
                  <div style={{ color: "#4b5563", fontSize: 12 }}>Loading...</div>
                ) : contents[activeTab] ? (
                  <div className="md-content">
                    <ReactMarkdown>{contents[activeTab]}</ReactMarkdown>
                  </div>
                ) : (
                  <div style={{ color: "#4b5563", fontSize: 12 }}>No content</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
