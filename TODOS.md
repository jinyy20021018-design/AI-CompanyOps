# TODOS

## Completed

- ~~Shell injection fix in coagent CLI template~~ (v0.3.0)
- ~~Extract index.ts monolith into modules~~ (v0.3.0)
- ~~Write tests for 5 critical paths~~ (v0.3.0)
- ~~Build own Honcho-compatible API~~ (local server at localhost:8000)
- ~~Fix coordinator Honcho context injection race~~ (v0.3.0)
- ~~Add VERSION file and CHANGELOG.md~~ (v0.3.0)

## P1 — Important

### OAuth token auto-refresh for local Honcho
- **What:** Auto-extract Claude Code's OAuth token from macOS Keychain and refresh the Honcho .env when it expires
- **Why:** The OAuth token has an expiry. Currently requires manual re-extraction.
- **Context:** Token stored in macOS Keychain under "Claude Code-credentials". Has refreshToken for renewal.
- **Depends on:** Nothing

### terminal:close cleanup gap (Codex finding)
- **What:** `terminal:close` calls `ptyManager.kill()` which disposes the exit listener instead of firing it, skipping registry cleanup, watcher decrement, and session finalization
- **Why:** Closed terminals stay "running" in registry, watchers leak
- **Context:** Codex review finding #2. Fix: run the same cleanup as the exit handler before calling kill()
- **Depends on:** Nothing

### PTY input injection sanitization (Codex finding)
- **What:** Scratchpad message content is written directly into PTY input unescaped via ptyManager.write()
- **Why:** If a terminal is at a shell prompt (not inside Claude), a crafted message could execute commands
- **Context:** Codex review finding #1. Fix: escape or quote the message content before PTY injection
- **Depends on:** Nothing

## P2 — Nice to have

### Frontend CSS design system (DESIGN.md)
- **What:** Run `/design-consultation` to create systematic color tokens, spacing scale, typography
- **Why:** index.css is 2,900+ lines growing organically with ad-hoc styles per component
- **Context:** Has CSS variables for colors but no spacing system. Light/dark theme exists but is ad-hoc.
- **Depends on:** Nothing
