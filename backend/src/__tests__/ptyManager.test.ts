import { describe, it, expect } from "vitest";

// Mirror the normalization logic from PtyManager.write
function normalizePtyWrite(data: string): string {
  if (data.length > 1 && !data.includes("\x1b")) {
    data = data.replace(/\n/g, "\r");
    if (!data.endsWith("\r")) {
      data += "\r";
    }
    data = data.replace(/\r+$/, "\r");
  }
  return data;
}

describe("PTY write normalization", () => {
  it("converts trailing \\n to \\r", () => {
    expect(normalizePtyWrite("hello\n")).toBe("hello\r");
  });

  it("leaves trailing \\r unchanged", () => {
    expect(normalizePtyWrite("hello\r")).toBe("hello\r");
  });

  it("appends \\r if missing", () => {
    expect(normalizePtyWrite("hello")).toBe("hello\r");
  });

  it("converts ALL internal \\n to \\r", () => {
    expect(normalizePtyWrite("line1\nline2\n")).toBe("line1\rline2\r");
  });

  it("does not modify single-char input (raw user keystroke)", () => {
    expect(normalizePtyWrite("a")).toBe("a");
  });

  it("does not modify ANSI escape sequences", () => {
    expect(normalizePtyWrite("\x1b[A")).toBe("\x1b[A");
  });

  it("does not modify Ctrl+C", () => {
    expect(normalizePtyWrite("\x03")).toBe("\x03");
  });

  it("handles empty string", () => {
    expect(normalizePtyWrite("")).toBe("");
  });

  it("collapses multiple trailing \\r into one", () => {
    expect(normalizePtyWrite("hello\r\r\r")).toBe("hello\r");
  });

  it("handles the session context injection pattern", () => {
    const contextLine = "# Previous session context (last 5 lines):\n# line1\n# line2\n";
    const result = normalizePtyWrite(contextLine);
    expect(result).toBe("# Previous session context (last 5 lines):\r# line1\r# line2\r");
    expect(result.endsWith("\r")).toBe(true);
    expect(result.includes("\n")).toBe(false);
  });

  it("handles task injection with trailing \\r already present", () => {
    const task = "Research US-Iran conflict status\r";
    expect(normalizePtyWrite(task)).toBe("Research US-Iran conflict status\r");
  });

  it("handles multi-line task that ends without \\r", () => {
    const task = "Step 1: do this\nStep 2: do that";
    expect(normalizePtyWrite(task)).toBe("Step 1: do this\rStep 2: do that\r");
  });

  it("handles scratchpad notification prompt", () => {
    const prompt = 'You received a [task_assign] message from coordinator: "Do the work". Run coagent inbox.\r';
    expect(normalizePtyWrite(prompt)).toBe(prompt);
  });
});
