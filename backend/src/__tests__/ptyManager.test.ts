import { describe, it, expect } from "vitest";

// Test the \n → \r normalization logic directly (extracted from PtyManager.write)
function normalizeTrailingNewline(data: string): string {
  if (data.endsWith("\n") && !data.endsWith("\r\n")) {
    return data.slice(0, -1) + "\r";
  }
  return data;
}

describe("PTY write normalization", () => {
  it("converts trailing \\n to \\r", () => {
    expect(normalizeTrailingNewline("hello\n")).toBe("hello\r");
  });

  it("leaves trailing \\r unchanged", () => {
    expect(normalizeTrailingNewline("hello\r")).toBe("hello\r");
  });

  it("leaves \\r\\n unchanged (Windows-style)", () => {
    expect(normalizeTrailingNewline("hello\r\n")).toBe("hello\r\n");
  });

  it("does not modify data without trailing newline", () => {
    expect(normalizeTrailingNewline("hello")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(normalizeTrailingNewline("")).toBe("");
  });

  it("only converts the LAST \\n, not internal ones", () => {
    expect(normalizeTrailingNewline("line1\nline2\n")).toBe("line1\nline2\r");
  });

  it("handles the exact session context injection pattern", () => {
    const contextLine = "# Previous session context (last 5 lines):\n# line1\n# line2\n";
    const result = normalizeTrailingNewline(contextLine);
    expect(result.endsWith("\r")).toBe(true);
    expect(result.endsWith("\n")).toBe(false);
  });
});
