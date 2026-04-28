import type { ScratchpadMessage } from "./scratchpadWatcher.js";
import type { TerminalRegistryEntry } from "./protocol.js";

export type RoutingPrincipal = Pick<TerminalRegistryEntry, "sessionName" | "tag" | "role" | "title">;

export type SenderAuthority = {
  kind: "user" | "system" | "agent" | "unknown";
  isCoordinator: boolean;
};

const DEPARTMENT_NAMES = new Set(["product", "engineering", "marketing", "qa", "finance"]);
const TRUSTED_SENDER_TYPES = new Set(["task_assign", "handoff", "question", "blocker"]);

function normalizeToken(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function isCoordinatorPrincipal(entry: RoutingPrincipal): boolean {
  return normalizeToken(entry.sessionName) === "coordinator" || normalizeToken(entry.tag) === "coordinator";
}

function isDepartmentPrincipal(entry: RoutingPrincipal): boolean {
  const session = normalizeToken(entry.sessionName);
  const tag = normalizeToken(entry.tag);
  return DEPARTMENT_NAMES.has(session) || DEPARTMENT_NAMES.has(tag);
}

function isWorkerPrincipal(entry: RoutingPrincipal): boolean {
  return entry.role === "worker";
}

/**
 * Resolve sender privileges from the registry snapshot.
 * Unknown sender IDs are treated as untrusted for privileged message types.
 */
export function resolveSenderAuthority(
  scratchMsg: Pick<ScratchpadMessage, "from">,
  entries: RoutingPrincipal[],
): SenderAuthority {
  const from = normalizeToken(scratchMsg.from);
  if (from === "user") return { kind: "user", isCoordinator: false };
  if (from === "system") return { kind: "system", isCoordinator: false };

  // Runtime identity check: only treat a sender as an agent if there is an
  // active registry entry for that exact sessionName.
  const senderEntry = entries.find((entry) => normalizeToken(entry.sessionName) === from);
  if (senderEntry) {
    return { kind: "agent", isCoordinator: isCoordinatorPrincipal(senderEntry) };
  }

  return { kind: "unknown", isCoordinator: false };
}

/**
 * Runtime ACL for message delivery.
 * This complements prompt-level policy by enforcing high-risk routing rules.
 */
export function isMessageAllowedByAcl(
  scratchMsg: Pick<ScratchpadMessage, "msgType">,
  sender: SenderAuthority,
  recipient: RoutingPrincipal,
): { allowed: boolean; reason?: string } {
  const msgType = normalizeToken(scratchMsg.msgType);

  if (sender.kind === "unknown" && TRUSTED_SENDER_TYPES.has(msgType)) {
    return { allowed: false, reason: `untrusted sender for ${msgType}` };
  }

  if (msgType === "task_assign") {
    if (sender.kind === "user" || sender.kind === "system") {
      return { allowed: true };
    }
    if (!sender.isCoordinator) {
      return { allowed: false, reason: "task_assign is coordinator-only" };
    }
    // Coordinator can assign fixed departments and spawned workers, but not itself.
    if (!isDepartmentPrincipal(recipient) && !isWorkerPrincipal(recipient)) {
      return { allowed: false, reason: "task_assign target must be a worker or department" };
    }
    return { allowed: true };
  }

  if (msgType === "blocker") {
    if (!isCoordinatorPrincipal(recipient)) {
      return { allowed: false, reason: "blocker target must be coordinator" };
    }
    if (sender.kind === "unknown") {
      return { allowed: false, reason: "untrusted sender cannot raise blocker" };
    }
    if (sender.kind === "agent" && sender.isCoordinator) {
      return { allowed: false, reason: "coordinator cannot send blocker to itself" };
    }
    return { allowed: true };
  }

  return { allowed: true };
}
