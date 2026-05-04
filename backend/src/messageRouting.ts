import fs from "node:fs";
import path from "node:path";
import type { ScratchpadMessage } from "./scratchpadWatcher.js";
import type { ScratchpadEntry } from "./protocol.js";
import type { ServerContext } from "./serverContext.js";
import { getHoncho, getAgentPeerId, getProjectSessionId, isHonchoAvailable } from "./honchoClient.js";
import { validateMessage, sanitizeForPty } from "./guardrail.js";
import { isMessageAllowedByAcl, resolveSenderAuthority } from "./routingAcl.js";
import { runToolInjection } from "./tools/toolInjectionRunner.js";

/**
 * Create a reusable scratchpad message routing callback.
 *
 * This routes incoming scratchpad messages to the correct terminals based on
 * addressing rules (*, sessionName, role:, name:), writes to inboxes, broadcasts
 * UI events, injects PTY notifications, and records to Honcho for semantic memory.
 */
export function createScratchpadRouter(
  ctx: ServerContext,
  sharedDir: string,
  folder: { path: string; id: string },
): (scratchMsg: ScratchpadMessage) => void {
  const collectArtifactContext = (msgText: string): string => {
    const root = path.resolve(folder.path);
    const candidates = msgText.match(/(?:\/[^\s"'<>]+?\.(?:md|json|yaml|yml|csv|txt))/gi) ?? [];
    const chunks: string[] = [];
    for (const candidate of [...new Set(candidates)].slice(0, 8)) {
      const cleaned = candidate.replace(/[),.;:]+$/, "");
      const resolved = path.resolve(cleaned);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) continue;
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile() || stat.size > 512 * 1024) continue;
        chunks.push(`\n\n# Artifact: ${resolved}\n${fs.readFileSync(resolved, "utf-8").slice(0, 12000)}`);
      } catch {}
    }
    return chunks.join("");
  };

  const maybeRunDomainToolInjection = (entry: { sessionName: string; sessionDir?: string }, msg: ScratchpadMessage) => {
    if (msg.msgType !== "task_assign") return;
    const sessionName = entry.sessionName.toLowerCase();
    const target = sessionName === "marketing" ? "market" : sessionName === "finance" ? "finance" : null;
    if (!target) return;

    console.log(
      "[tool-injection] scheduling",
      "target=", target,
      "session=", entry.sessionName,
      "mode=", process.env.COAGENT_DOMAIN_AGENTS ?? "legacy",
      "enabled=", process.env.COAGENT_TOOL_INJECTION_ENABLED ?? "1",
      "taskId=", msg.taskId ?? "none",
    );

    const workspaceDir = path.join(folder.path, "CoAgent_workspace");
    let projectContext = "";
    try {
      projectContext = fs.readFileSync(path.join(workspaceDir, "_shared", "context.md"), "utf-8").slice(0, 8000);
    } catch {}
    projectContext += collectArtifactContext(msg.msg);

    void runToolInjection({
      folderPath: folder.path,
      target,
      projectContext,
      taskText: msg.msg,
      sessionDir: entry.sessionDir,
    }).catch((err) => {
      console.warn("[tool-injection] failed:", err instanceof Error ? err.message : String(err));
    });
  };

  return (scratchMsg: ScratchpadMessage) => {
    // ── Guardrail check ──────────────────────────────────────────────────────
    const guardrail = validateMessage(scratchMsg);
    if (guardrail.flags.length > 0) {
      console.warn("[guardrail] flags on message from", scratchMsg.from, ":", guardrail.flags.map(f => `${f.type}:${f.detail}`).join(", "));
    }
    if (!guardrail.allowed) {
      console.warn("[guardrail] BLOCKED message from", scratchMsg.from, "— prompt injection detected");
      return;
    }
    // Use sanitized copy (PII redacted, control chars stripped) for all downstream operations
    scratchMsg = guardrail.sanitized;

    // Route using registry as source of truth — covers ALL workers,
    // including ephemeral ones not currently in sessionMeta.
    const folderEntries = ctx.terminalRegistry.load(folder.path);
    const workerPushTypes = ["blocker", "question", "task_assign", "handoff"];
    const senderAuthority = resolveSenderAuthority(scratchMsg, folderEntries);

    console.log("[watcher] new msg from:", scratchMsg.from, "to:", scratchMsg.to, "entries:", folderEntries.length);

    // Broadcast to group chat feed
    ctx.broadcast({ type: "scratchpad:message", pathId: folder.id, entry: scratchMsg as ScratchpadEntry });

    for (const entry of folderEntries) {
      const tid = entry.terminalId;
      if (scratchMsg.from === entry.sessionName) continue; // don't deliver to sender

      let shouldDeliver = false;
      if (scratchMsg.to === "*") {
        shouldDeliver = true;
      } else if (scratchMsg.to === entry.sessionName) {
        shouldDeliver = true;
      } else if (scratchMsg.to.startsWith("role:")) {
        if (entry.role === scratchMsg.to.slice(5)) shouldDeliver = true;
      } else {
        const target = (scratchMsg.to.startsWith("name:") ? scratchMsg.to.slice(5) : scratchMsg.to).toLowerCase();
        if ((entry.title || "").toLowerCase() === target || (entry.tag || "").toLowerCase() === target) shouldDeliver = true;
      }
      console.log("[watcher] entry:", entry.sessionName, "title:", entry.title, "tag:", entry.tag, "role:", entry.role, "shouldDeliver:", shouldDeliver, "isAlive:", ctx.agentChannel.has(tid));

      if (!shouldDeliver) continue;
      const acl = isMessageAllowedByAcl(scratchMsg, senderAuthority, entry);
      if (!acl.allowed) {
        console.warn("[acl] blocked message:", scratchMsg.msgType, "from", scratchMsg.from, "to", entry.sessionName, "-", acl.reason ?? "not allowed");
        continue;
      }

      maybeRunDomainToolInjection(entry, scratchMsg);

      // Inbox write — works even without an active PTY
      try {
        fs.appendFileSync(path.join(entry.sessionDir, "inbox.jsonl"), JSON.stringify(scratchMsg) + "\n");
      } catch {}

      ctx.broadcast({
        type: "message:new",
        terminalId: tid,
        from: scratchMsg.from,
        tag: scratchMsg.tag,
        preview: scratchMsg.msg.slice(0, 80),
        msgType: scratchMsg.msgType,
        messageId: scratchMsg.id,
        taskId: scratchMsg.taskId,
        artifactPath: scratchMsg.artifactPath,
      });

      const urgentTypes = ["blocker", "handoff", "question", "task_assign"];
      if (scratchMsg.msgType && urgentTypes.includes(scratchMsg.msgType)) {
        ctx.broadcast({
          type: "message:urgent",
          terminalId: tid,
          from: scratchMsg.from,
          msgType: scratchMsg.msgType,
          preview: scratchMsg.msg.slice(0, 80),
          messageId: scratchMsg.id,
        });
      }

      // PTY injection — only if PTY is alive
      if (ctx.agentChannel.has(tid)) {
        const isCoordinator = entry.role === "coordinator";
        const shouldPush = isCoordinator
          ? scratchMsg.msgType !== "status_update" || scratchMsg.from !== "system"
          : !!(scratchMsg.msgType && workerPushTypes.includes(scratchMsg.msgType));
        if (shouldPush) {
          // For coordinator: every incoming message is urgent (they must react to everything)
          // For workers: only task_assign/question/blocker/handoff interrupt
          const urgentInterrupt = isCoordinator
            ? true
            : ["question", "blocker", "handoff", "task_assign"].includes(scratchMsg.msgType ?? "");
          const idle = Date.now() - ctx.agentChannel.getLastOutputTime(tid) > 3000;
          const notifText = `You received a [${scratchMsg.msgType}] message from ${sanitizeForPty(scratchMsg.from, 40)}: "${sanitizeForPty(scratchMsg.msg)}". Run coagent inbox, read it, and act on it.`;
          if (idle || urgentInterrupt) {
            if (urgentInterrupt && !idle) {
              // Break out of any running sleep/loop so Claude can react immediately
              ctx.agentChannel.write(tid, "\x03");
              setTimeout(() => {
                ctx.agentChannel.write(tid, notifText);
                setTimeout(() => ctx.agentChannel.write(tid, "\r"), 150);
              }, 300);
            } else {
              ctx.agentChannel.write(tid, notifText);
              setTimeout(() => ctx.agentChannel.write(tid, "\r"), 150);
            }
          } else {
            if (!ctx.pendingNotifications.has(tid)) ctx.pendingNotifications.set(tid, []);
            ctx.pendingNotifications.get(tid)!.push(scratchMsg);
          }
        }
      }
    }

    // Record message to Honcho for semantic memory
    if (isHonchoAvailable()) {
      (async () => {
        try {
          const honcho = getHoncho();
          const peer = await honcho.peer(getAgentPeerId(scratchMsg.from));
          const session = await honcho.session(getProjectSessionId(folder.path), {
            metadata: { type: "project", folderPath: folder.path },
          });
          await session.addPeers(peer);
          await session.addMessages([
            peer.message(
              `[${scratchMsg.tag}] ${scratchMsg.from} → ${scratchMsg.to}: ${scratchMsg.msg}`,
              { metadata: { tag: scratchMsg.tag, from: scratchMsg.from, to: scratchMsg.to, msgType: scratchMsg.msgType } }
            ),
          ]);
        } catch (e) {
          console.warn("[honcho] Failed to record message:", e);
        }
      })();
    }
  };
}
