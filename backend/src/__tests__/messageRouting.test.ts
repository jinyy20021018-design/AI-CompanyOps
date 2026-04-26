import { describe, it, expect } from "vitest";
import { isMessageAllowedByAcl, resolveSenderAuthority } from "../routingAcl.js";

// Test the routing rules extracted from messageRouting.ts
// We test the pure routing logic without the full ServerContext

type RoutingEntry = {
  sessionName: string;
  title: string;
  tag: string;
  role: "coordinator" | "worker";
};

function shouldDeliver(
  msg: { from: string; to: string },
  entry: RoutingEntry
): boolean {
  // Don't deliver to sender
  if (msg.from === entry.sessionName) return false;

  if (msg.to === "*") return true;
  if (msg.to === entry.sessionName) return true;
  if (msg.to.startsWith("role:")) {
    return entry.role === msg.to.slice(5);
  }
  const target = (msg.to.startsWith("name:") ? msg.to.slice(5) : msg.to).toLowerCase();
  return (entry.title || "").toLowerCase() === target || (entry.tag || "").toLowerCase() === target;
}

const coordinator: RoutingEntry = {
  sessionName: "coordinator",
  title: "Coordinator",
  tag: "coordinator",
  role: "coordinator",
};

const workerA: RoutingEntry = {
  sessionName: "2026-03-20_14-30_claude_a1b2",
  title: "Auth Worker",
  tag: "worker",
  role: "worker",
};

const workerB: RoutingEntry = {
  sessionName: "2026-03-20_15-00_claude_c3d4",
  title: "DB Worker",
  tag: "worker",
  role: "worker",
};

const engineering: RoutingEntry = {
  sessionName: "engineering",
  title: "Engineering",
  tag: "engineering",
  role: "worker",
};

const qa: RoutingEntry = {
  sessionName: "qa",
  title: "QA",
  tag: "qa",
  role: "worker",
};

describe("scratchpad message routing", () => {
  it("broadcast (*) delivers to all except sender", () => {
    const msg = { from: "coordinator", to: "*" };
    expect(shouldDeliver(msg, coordinator)).toBe(false); // sender
    expect(shouldDeliver(msg, workerA)).toBe(true);
    expect(shouldDeliver(msg, workerB)).toBe(true);
  });

  it("direct sessionName delivers to exact match only", () => {
    const msg = { from: "coordinator", to: "2026-03-20_14-30_claude_a1b2" };
    expect(shouldDeliver(msg, workerA)).toBe(true);
    expect(shouldDeliver(msg, workerB)).toBe(false);
    expect(shouldDeliver(msg, coordinator)).toBe(false); // sender
  });

  it("role: routing delivers to matching role", () => {
    const msg = { from: workerA.sessionName, to: "role:coordinator" };
    expect(shouldDeliver(msg, coordinator)).toBe(true);
    expect(shouldDeliver(msg, workerB)).toBe(false);
  });

  it("role:worker delivers to all workers except sender", () => {
    const msg = { from: workerA.sessionName, to: "role:worker" };
    expect(shouldDeliver(msg, workerA)).toBe(false); // sender
    expect(shouldDeliver(msg, workerB)).toBe(true);
    expect(shouldDeliver(msg, coordinator)).toBe(false);
  });

  it("name: routing matches title (case-insensitive)", () => {
    const msg = { from: "coordinator", to: "name:auth worker" };
    expect(shouldDeliver(msg, workerA)).toBe(true);
    expect(shouldDeliver(msg, workerB)).toBe(false);
  });

  it("name: routing matches tag", () => {
    const msg = { from: "coordinator", to: "name:coordinator" };
    // coordinator is the sender, so false
    expect(shouldDeliver(msg, coordinator)).toBe(false);
  });

  it("bare string matches title (case-insensitive)", () => {
    const msg = { from: "coordinator", to: "DB Worker" };
    expect(shouldDeliver(msg, workerB)).toBe(true);
    expect(shouldDeliver(msg, workerA)).toBe(false);
  });

  it("no match delivers to nobody", () => {
    const msg = { from: "coordinator", to: "nonexistent-session" };
    expect(shouldDeliver(msg, workerA)).toBe(false);
    expect(shouldDeliver(msg, workerB)).toBe(false);
    expect(shouldDeliver(msg, coordinator)).toBe(false);
  });
});

describe("scratchpad ACL rules", () => {
  const entries = [coordinator, engineering, qa, workerA];

  it("allows coordinator task_assign to departments", () => {
    const msg = { from: "coordinator", to: "name:Engineering", msgType: "task_assign" };
    const sender = resolveSenderAuthority(msg, entries);
    expect(isMessageAllowedByAcl(msg, sender, engineering).allowed).toBe(true);
  });

  it("blocks non-coordinator task_assign", () => {
    const msg = { from: "engineering", to: "name:QA", msgType: "task_assign" };
    const sender = resolveSenderAuthority(msg, entries);
    expect(isMessageAllowedByAcl(msg, sender, qa).allowed).toBe(false);
  });

  it("allows coordinator task_assign to spawned workers", () => {
    const msg = { from: "coordinator", to: "role:worker", msgType: "task_assign" };
    const sender = resolveSenderAuthority(msg, entries);
    expect(isMessageAllowedByAcl(msg, sender, workerA).allowed).toBe(true);
  });

  it("allows blockers only when recipient is coordinator", () => {
    const msg = { from: "qa", to: "role:coordinator", msgType: "blocker" };
    const sender = resolveSenderAuthority(msg, entries);
    expect(isMessageAllowedByAcl(msg, sender, coordinator).allowed).toBe(true);
    expect(isMessageAllowedByAcl(msg, sender, engineering).allowed).toBe(false);
  });

  it("blocks blocker sent by coordinator", () => {
    const msg = { from: "coordinator", to: "role:coordinator", msgType: "blocker" };
    const sender = resolveSenderAuthority(msg, entries);
    expect(isMessageAllowedByAcl(msg, sender, coordinator).allowed).toBe(false);
  });

  it("blocks privileged messages from unknown senders", () => {
    const msg = { from: "spoofed-agent", to: "name:QA", msgType: "task_assign" };
    const sender = resolveSenderAuthority(msg, entries);
    expect(sender.kind).toBe("unknown");
    expect(isMessageAllowedByAcl(msg, sender, qa).allowed).toBe(false);
  });

  it("treats department-name spoofing as unknown without registry entry", () => {
    const msg = { from: "engineering", to: "name:QA", msgType: "task_assign" };
    const sender = resolveSenderAuthority(msg, [coordinator, qa, workerA]); // no engineering entry
    expect(sender.kind).toBe("unknown");
    expect(isMessageAllowedByAcl(msg, sender, qa).allowed).toBe(false);
  });

  it("blocks unknown sender task_assign to spawned workers", () => {
    const msg = { from: "spoofed-agent", to: "role:worker", msgType: "task_assign" };
    const sender = resolveSenderAuthority(msg, [coordinator, qa, workerA]);
    expect(sender.kind).toBe("unknown");
    expect(isMessageAllowedByAcl(msg, sender, workerA).allowed).toBe(false);
  });
});
