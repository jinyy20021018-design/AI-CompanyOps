import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { PtyManager } from "../ptyManager.js";
import type { AgentChannel } from "../agentChannel.js";

/**
 * Contract tests for AgentChannel implementations.
 *
 * Today only `PtyManager` is exercised. When `ContainerManager` lands (Phase C)
 * it should be added to the `implementations` array and pass the same suite.
 *
 * PTY tests need a real TTY, so this suite is skipped on Windows.
 *
 * Why one shared tmpDir: PtyManager opens an output.jsonl write stream that
 * outlives the kill signal — deleting per-test tmpDirs causes EBUSY/ENOENT in
 * the trailing data callback. We use one tmpDir for the whole file and unique
 * sessionDir subdirs per session.
 */
const isUnix = process.platform !== "win32";

const implementations: Array<{ name: string; build: () => AgentChannel }> = [
  { name: "PtyManager", build: () => new PtyManager() },
];

for (const { name, build } of implementations) {
  describe.skipIf(!isUnix)(`AgentChannel contract — ${name}`, () => {
    let channel: AgentChannel;
    let rootDir: string;

    beforeAll(() => {
      rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-channel-${name}-`));
    });

    afterAll(async () => {
      // Allow any trailing PTY callbacks to flush before deleting the tree.
      await new Promise((r) => setTimeout(r, 300));
      fs.rmSync(rootDir, { recursive: true, force: true });
    });

    beforeEach(() => {
      channel = build();
    });

    afterEach(async () => {
      await channel.killAll();
      // Yield to event loop so PTY exit callbacks complete before the next test.
      await new Promise((r) => setTimeout(r, 150));
    });

    function sessionDirFor(label: string): string {
      const dir = path.join(rootDir, `${label}-${crypto.randomBytes(4).toString("hex")}`);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }

    it("[1] create returns a session with id, pid, and sessionDir", async () => {
      const sd = sessionDirFor("c1");
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      expect(s.id).toBeTruthy();
      expect(s.pid).toBeGreaterThan(0);
      expect(s.sessionDir).toBe(sd);
    });

    it("[2] createWithId honors the provided id", async () => {
      const sd = sessionDirFor("c2");
      const id = "fixed-test-id-123";
      const s = await channel.createWithId(id, "p", sd, "lbl", sd, () => {}, () => {});
      expect(s.id).toBe(id);
    });

    it("[3] has returns true after create", async () => {
      const sd = sessionDirFor("c3");
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      expect(channel.has(s.id)).toBe(true);
    });

    it("[4] getPid returns the session pid; undefined for unknown id", async () => {
      const sd = sessionDirFor("c4");
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      expect(channel.getPid(s.id)).toBe(s.pid);
      expect(channel.getPid("never-existed")).toBeUndefined();
    });

    it("[5] getBufferedOutput returns a string (possibly empty)", async () => {
      const sd = sessionDirFor("c5");
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      expect(typeof channel.getBufferedOutput(s.id)).toBe("string");
    });

    it("[6] getLastOutputTime is a recent timestamp", async () => {
      const sd = sessionDirFor("c6");
      const before = Date.now();
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      const t = channel.getLastOutputTime(s.id);
      expect(t).toBeGreaterThanOrEqual(before - 10);
    });

    it("[7] subscribeData on unknown id returns a no-op disposer (does not throw)", () => {
      const dispose = channel.subscribeData("never-existed", () => {});
      expect(typeof dispose).toBe("function");
      expect(() => dispose()).not.toThrow();
    });

    it("[8] subscribeData receives data after writes", async () => {
      const sd = sessionDirFor("c8");
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      // Replace the shell with `cat` so subsequent writes echo back.
      channel.write(s.id, "exec cat\r");
      await new Promise((r) => setTimeout(r, 200));

      let received = "";
      const dispose = channel.subscribeData(s.id, (data) => { received += data; });
      channel.write(s.id, "hello-world-marker\r");
      await new Promise((r) => setTimeout(r, 300));
      dispose();
      expect(received).toContain("hello-world-marker");
    });

    it("[9] subscribeData disposer stops further callbacks", async () => {
      const sd = sessionDirFor("c9");
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      channel.write(s.id, "exec cat\r");
      await new Promise((r) => setTimeout(r, 200));

      let count = 0;
      const dispose = channel.subscribeData(s.id, () => { count += 1; });
      channel.write(s.id, "first\r");
      await new Promise((r) => setTimeout(r, 200));
      const before = count;
      dispose();
      channel.write(s.id, "second\r");
      await new Promise((r) => setTimeout(r, 200));
      expect(count).toBe(before);
    });

    it("[10] resize does not throw for live or unknown ids", async () => {
      const sd = sessionDirFor("c10");
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      expect(() => channel.resize(s.id, 100, 30)).not.toThrow();
      expect(() => channel.resize("never-existed", 80, 24)).not.toThrow();
    });

    it("[11] kill removes the session from the registry", async () => {
      // NB: PtyManager intentionally does NOT fire onExit on explicit kill
      // (the onExit listener is disposed before signalling). ContainerManager
      // should match this convention — onExit fires for natural process death only.
      const sd = sessionDirFor("c11");
      const s = await channel.create("p", sd, "lbl", sd, () => {}, () => {});
      channel.kill(s.id);
      await new Promise((r) => setTimeout(r, 100));
      expect(channel.has(s.id)).toBe(false);
    });

    it("[12] killAll clears all sessions", async () => {
      const sa = sessionDirFor("c12a");
      const sb = sessionDirFor("c12b");
      const s1 = await channel.create("p", sa, "a", sa, () => {}, () => {});
      const s2 = await channel.create("p", sb, "b", sb, () => {}, () => {});
      await channel.killAll();
      await new Promise((r) => setTimeout(r, 100));
      expect(channel.has(s1.id)).toBe(false);
      expect(channel.has(s2.id)).toBe(false);
    });
  });
}
