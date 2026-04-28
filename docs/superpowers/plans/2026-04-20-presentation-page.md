# Presentation Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the CEO agent exits successfully, auto-pop a full-screen cinematic overlay showing the Engineering agent's generated app UI preview (in an iframe) alongside beautifully rendered proposal tabs for all department artifacts.

**Architecture:** The backend detects coordinator exit (exitCode 0) and broadcasts a `coordinator:complete` WebSocket event. The frontend listens for this event, fetches all artifacts via existing WebSocket messages, and renders a `PresentationPage` overlay — cinematic hero (6 agent avatars + session stats) transitioning into a split view (iframe on left, tabbed markdown on right).

**Tech Stack:** React 19, react-markdown (new), existing WebSocket artifact protocol, inline iframe srcdoc for app preview, purple/dark theme (#0a0a0f, #7c3aed).

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `frontend/package.json` | Add react-markdown dependency |
| Modify | `backend/src/protocol.ts` | Add `coordinator:complete` to ServerMessage union |
| Modify | `frontend/src/types.ts` | Mirror `coordinator:complete` in frontend ServerMessage |
| Modify | `backend/src/index.ts` | Emit `coordinator:complete` when CEO exits with code 0 |
| Modify | `backend/src/sessionLifecycle.ts` | Update Engineering fallback prompt to generate app-preview.html |
| Create | `frontend/src/hooks/usePresentationArtifacts.ts` | Hook: fetch artifact list + contents via WebSocket |
| Create | `frontend/src/components/PresentationPage.tsx` | Full overlay: cinematic hero + split iframe/tabs |
| Modify | `frontend/src/App.tsx` | Listen for coordinator:complete, render PresentationPage overlay |

---

## Task 1: Install react-markdown

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps/frontend
npm install react-markdown
```

Expected output: `added 1 package` (or similar), no errors.

- [ ] **Step 2: Verify it appears in package.json**

```bash
grep react-markdown /Users/enicul/Documents/NUS/AI-CompanyOps/frontend/package.json
```

Expected: `"react-markdown": "^<version>"`

- [ ] **Step 3: Commit**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps
git add frontend/package.json frontend/package-lock.json
git commit -m "feat: add react-markdown for presentation page"
```

---

## Task 2: Add coordinator:complete to protocol types

**Files:**
- Modify: `backend/src/protocol.ts` (line 124, after `scratchpad:message`)
- Modify: `frontend/src/types.ts` (same location in ServerMessage union)

- [ ] **Step 1: Add the type to backend/src/protocol.ts**

In `backend/src/protocol.ts`, find the line:
```typescript
  | { type: "scratchpad:message"; pathId: string; entry: ScratchpadEntry };
```

Replace it with:
```typescript
  | { type: "scratchpad:message"; pathId: string; entry: ScratchpadEntry }
  | { type: "coordinator:complete"; terminalId: string; sessionName: string; folderPath: string };
```

- [ ] **Step 2: Add the type to frontend/src/types.ts**

In `frontend/src/types.ts`, find the line:
```typescript
  | { type: "scratchpad:message"; pathId: string; entry: ScratchpadEntry };
```

Replace it with:
```typescript
  | { type: "scratchpad:message"; pathId: string; entry: ScratchpadEntry }
  | { type: "coordinator:complete"; terminalId: string; sessionName: string; folderPath: string };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps
git add backend/src/protocol.ts frontend/src/types.ts
git commit -m "feat: add coordinator:complete WebSocket event type"
```

---

## Task 3: Emit coordinator:complete from backend on CEO exit

**Files:**
- Modify: `backend/src/index.ts` (~line 640–665, the terminal:create exit handler)

- [ ] **Step 1: Locate the exit handler for spawned terminals**

In `backend/src/index.ts`, find this block (around line 640):
```typescript
            (terminalId, exitCode) => {
              // Finalize session
              const meta = sessionMeta.get(terminalId);
              if (meta) {
                finalizeSession(meta.sessionDir, exitCode);
                refreshCostSummary(meta.folderPath);
                updateActiveSession(meta.folderPath, meta.sessionName, "remove");
                // Mark exited in terminal registry
                terminalRegistry.markExited(meta.folderPath, terminalId, exitCode);
                // Stop watching artifacts
                artifactWatcher.unwatch(path.join(meta.sessionDir, "artifacts"));
                // Decrement watcher ref count
                const sd = path.join(meta.folderPath, "CoAgent_workspace", "_shared");
                const remaining = (watchedDirCounts.get(sd) ?? 1) - 1;
                if (remaining <= 0) {
                  scratchpadWatcher.unwatch(sd);
                  watchedDirCounts.delete(sd);
                } else {
                  watchedDirCounts.set(sd, remaining);
                }
                // Record exit event to Honcho
                recordExitEvent(meta.sessionName, meta.folderPath, exitCode);

                sessionMeta.delete(terminalId);
              }
              send(ws, { type: "terminal:exit", terminalId, exitCode });
            },
```

- [ ] **Step 2: Add coordinator:complete broadcast after terminal:exit**

Replace the closing two lines of that handler:
```typescript
                sessionMeta.delete(terminalId);
              }
              send(ws, { type: "terminal:exit", terminalId, exitCode });
```

With:
```typescript
                sessionMeta.delete(terminalId);
              }
              send(ws, { type: "terminal:exit", terminalId, exitCode });
              if (sessionType === "coordinator" && exitCode === 0 && meta) {
                broadcast({ type: "coordinator:complete", terminalId, sessionName: meta.sessionName, folderPath: meta.folderPath });
              }
```

Note: `meta` is captured before `sessionMeta.delete(terminalId)` — add `const meta = sessionMeta.get(terminalId);` at the top of the handler if it's not already there. In this handler it is already declared as `const meta = sessionMeta.get(terminalId);`.

Since `meta` is deleted before `send`, capture what we need before deletion. Update the handler so the broadcast uses captured values:

Find:
```typescript
                sessionMeta.delete(terminalId);
              }
              send(ws, { type: "terminal:exit", terminalId, exitCode });
```

Replace with:
```typescript
                sessionMeta.delete(terminalId);
              }
              send(ws, { type: "terminal:exit", terminalId, exitCode });
              if (sessionType === "coordinator" && exitCode === 0) {
                broadcast({ type: "coordinator:complete", terminalId, sessionName, folderPath: folder.path });
              }
```

(`sessionName` and `folder.path` are in scope from the outer `terminal:create` handler closure.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps/backend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps
git add backend/src/index.ts
git commit -m "feat: broadcast coordinator:complete when CEO exits successfully"
```

---

## Task 4: Update Engineering agent prompt to generate app-preview.html

**Files:**
- Modify: `backend/src/sessionLifecycle.ts` (~line 151–165, the Engineering fallback prompt)

- [ ] **Step 1: Find the Engineering fallback prompt**

In `backend/src/sessionLifecycle.ts`, find (around line 152):
```typescript
      fs.writeFileSync(deptClaudeMd, `# ${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)} Department Agent
You are the ${sessionType} department head.

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`

## Workflow
1. Check inbox for task assignments from CEO
2. Do the work. Save outputs to \`$COAGENT_SESSION_DIR/artifacts/\`
3. Report back: \`coagent send --to "role:coordinator" --type handoff --msg "Done: [summary]"\`
4. Enter listen loop: \`while true; do sleep 15 && coagent inbox; done\`
`);
```

This is the fallback used for ALL department agents. It's inside an `if (fs.existsSync(deptPromptSrc))` / `else` block. We only need to add the extra instruction for engineering specifically.

- [ ] **Step 2: Add engineering-specific app-preview.html instruction**

Replace the entire `else` block (line ~151 to ~166) with:

```typescript
    } else {
      // Fallback if template not seeded yet
      let prompt = `# ${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)} Department Agent
You are the ${sessionType} department head.

## On startup — enter listen loop immediately
\`\`\`bash
while true; do coagent inbox; sleep 15; done
\`\`\`

## Workflow
1. Check inbox for task assignments from CEO
2. Do the work. Save outputs to \`$COAGENT_SESSION_DIR/artifacts/\`
3. Report back: \`coagent send --to "role:coordinator" --type handoff --msg "Done: [summary]"\`
4. Enter listen loop: \`while true; do sleep 15 && coagent inbox; done\`
`;
      if (sessionType === "engineering") {
        prompt += `
## App UI Preview (required)
After writing your architecture document, also create a self-contained HTML mockup of the app's main screen:
\`\`\`bash
cat > "$COAGENT_SESSION_DIR/artifacts/app-preview.html" << 'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>App Preview</title>
<style>
  /* Write realistic app UI styles inline here */
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; }
</style>
</head>
<body>
  <!-- Write the app's main screen UI here, showing key features -->
</body>
</html>
HTMLEOF
coagent artifact --type preview --path "$COAGENT_SESSION_DIR/artifacts/app-preview.html" --desc "App UI Preview"
\`\`\`
Make the mockup realistic — use the actual app name and feature set from the PRD. Style it properly with inline CSS. Show at least the main dashboard or home screen.
`;
      }
      fs.writeFileSync(deptClaudeMd, prompt);
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps/backend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps
git add backend/src/sessionLifecycle.ts
git commit -m "feat: engineering agent generates app-preview.html UI mockup"
```

---

## Task 5: Create usePresentationArtifacts hook

**Files:**
- Create: `frontend/src/hooks/usePresentationArtifacts.ts`

- [ ] **Step 1: Create the hook file**

Create `frontend/src/hooks/usePresentationArtifacts.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";
import type { ArtifactFileInfo, ServerMessage } from "../types";

export type ArtifactContents = Record<string, string>;

export function usePresentationArtifacts(
  terminalId: string | null,
  send: (msg: object) => void,
  addHandler: (handler: (msg: ServerMessage) => void) => () => void
): { files: ArtifactFileInfo[]; contents: ArtifactContents; loading: boolean } {
  const [files, setFiles] = useState<ArtifactFileInfo[]>([]);
  const [contents, setContents] = useState<ArtifactContents>({});
  const [loading, setLoading] = useState(false);

  const fetchContent = useCallback(
    (fileName: string) => {
      if (!terminalId) return;
      send({ type: "artifact:read", terminalId, fileName });
    },
    [terminalId, send]
  );

  useEffect(() => {
    if (!terminalId) return;
    setFiles([]);
    setContents({});
    setLoading(true);
    send({ type: "artifact:list", terminalId });
  }, [terminalId, send]);

  useEffect(() => {
    if (!terminalId) return;
    return addHandler((msg: ServerMessage) => {
      if (msg.type === "artifact:update" && msg.terminalId === terminalId) {
        setFiles(msg.files);
        for (const f of msg.files) {
          fetchContent(f.name);
        }
      }
      if (msg.type === "artifact:content" && msg.terminalId === terminalId) {
        setContents((prev) => {
          const updated = { ...prev, [msg.fileName]: msg.content };
          const allFiles = Object.keys(updated);
          // loading done when we have content for every file
          return updated;
        });
      }
    });
  }, [terminalId, addHandler, fetchContent]);

  useEffect(() => {
    if (files.length === 0) return;
    const allLoaded = files.every((f) => contents[f.name] !== undefined);
    if (allLoaded) setLoading(false);
  }, [files, contents]);

  return { files, contents, loading };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps
git add frontend/src/hooks/usePresentationArtifacts.ts
git commit -m "feat: add usePresentationArtifacts hook"
```

---

## Task 6: Create PresentationPage component

**Files:**
- Create: `frontend/src/components/PresentationPage.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/PresentationPage.tsx`:

```typescript
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { usePresentationArtifacts } from "../hooks/usePresentationArtifacts";
import type { ServerMessage } from "../types";

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
  send: (msg: object) => void;
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps
git add frontend/src/components/PresentationPage.tsx
git commit -m "feat: add PresentationPage component with cinematic intro and split view"
```

---

## Task 7: Wire PresentationPage into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add presentation state and import**

At the top of `frontend/src/App.tsx`, add the import after existing component imports:

```typescript
import { PresentationPage } from "./components/PresentationPage";
```

Inside the `App()` function, after the `artifactViewer` state (around line 60), add:

```typescript
  const [presentation, setPresentation] = useState<{
    terminalId: string; sessionName: string;
  } | null>(null);
```

- [ ] **Step 2: Handle coordinator:complete in the WebSocket message handler**

Inside the `useEffect` that calls `addHandler` (around line 105), add a new case to the switch statement. Find a suitable location (e.g. after `case "terminal:exit":`) and add:

```typescript
        case "coordinator:complete":
          setPresentation({ terminalId: msg.terminalId, sessionName: msg.sessionName });
          break;
```

- [ ] **Step 3: Render the overlay**

Find where the artifact viewer overlay is rendered (around line 668). It looks like:

```typescript
      {artifactViewer && (
```

After that block (still inside the return), add the presentation overlay:

```typescript
      {presentation && (
        <PresentationPage
          terminalId={presentation.terminalId}
          sessionName={presentation.sessionName}
          onClose={() => setPresentation(null)}
          send={send}
          addHandler={addHandler}
        />
      )}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Start the dev server and verify the UI loads without errors**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps/frontend
npm run dev 2>&1 &
sleep 4
curl -s http://localhost:5173 | head -5
```

Expected: HTML response with no build errors in the terminal.

- [ ] **Step 6: Commit**

```bash
cd /Users/enicul/Documents/NUS/AI-CompanyOps
git add frontend/src/App.tsx
git commit -m "feat: show PresentationPage overlay when coordinator completes"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Auto-popup on completion — Task 3 (backend emit) + Task 7 (frontend listen)
- ✅ Full-screen overlay — Task 6 (`position: fixed; inset: 0`)
- ✅ Cinematic intro with agent avatars — Task 6 (phase intro, staggered animation)
- ✅ App preview iframe — Task 6 (left panel, `srcDoc`)
- ✅ Tabbed proposal docs — Task 6 (right panel, tab bar)
- ✅ Proper markdown rendering (no # symbols) — Task 6 (ReactMarkdown + md-content styles)
- ✅ Purple/dark theme — Task 6 (all inline styles)
- ✅ Export PDF + Share buttons — Task 6 (footer buttons)
- ✅ Engineering generates app-preview.html — Task 4
- ✅ Dismiss overlay (×) — Task 6 (close button)

**Placeholder scan:** No TBDs, no "implement later", all code blocks complete.

**Type consistency:** `coordinator:complete` defined in Task 2, used in Task 3 (broadcast), consumed in Task 7 (handler). Field names match: `terminalId`, `sessionName`, `folderPath`. `usePresentationArtifacts` returns `{ files, contents, loading }` — consumed correctly in `PresentationPage`.
