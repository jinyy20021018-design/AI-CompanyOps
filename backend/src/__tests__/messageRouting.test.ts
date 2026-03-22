import { describe, it, expect } from "vitest";

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
