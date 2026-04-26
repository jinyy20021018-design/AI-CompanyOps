import fs from "node:fs";
import path from "node:path";
import type { ScratchpadMessage } from "./scratchpadWatcher.js";
import type { ScratchpadEntry } from "./protocol.js";
import type { ServerContext } from "./serverContext.js";
import { getHoncho, getAgentPeerId, getProjectSessionId, isHonchoAvailable } from "./honchoClient.js";
import { validateMessage, sanitizeForPty } from "./guardrail.js";
import { isMessageAllowedByAcl, resolveSenderAuthority } from "./routingAcl.js";

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
      console.log("[watcher] entry:", entry.sessionName, "title:", entry.title, "tag:", entry.tag, "role:", entry.role, "shouldDeliver:", shouldDeliver, "hasPTY:", ctx.ptyManager.has(tid));

      if (!shouldDeliver) continue;
      const acl = isMessageAllowedByAcl(scratchMsg, senderAuthority, entry);
      if (!acl.allowed) {
        console.warn("[acl] blocked message:", scratchMsg.msgType, "from", scratchMsg.from, "to", entry.sessionName, "-", acl.reason ?? "not allowed");
        continue;
      }

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
      if (ctx.ptyManager.has(tid)) {
        const isCoordinator = entry.role === "coordinator";
        const shouldPush = isCoordinator
          ? scratchMsg.msgType !== "status_update" || scratchMsg.from !== "system"
          : !!(scratchMsg.msgType && workerPushTypes.includes(scratchMsg.msgType));
        if (shouldPush) {
          if (Date.now() - ctx.ptyManager.getLastOutputTime(tid) > 1000) {
            ctx.ptyManager.write(tid, `You received a [${scratchMsg.msgType}] message from ${sanitizeForPty(scratchMsg.from, 40)}: "${sanitizeForPty(scratchMsg.msg)}". Run coagent inbox, read it, and act on it.\r`);
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
