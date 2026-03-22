import { describe, it, expect } from "vitest";

// Extract the detection logic from App.tsx for unit testing
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

const waitingPatterns = [
  /\(y\/n\)\s*$/,
  /\(Y\/n\)\s*$/,
  /\[Y\/n\]\s*$/,
  /\[yes\/no\]\s*$/i,
  /Do you want to proceed/i,
  /Allow\s+.*\?/i,
  /Press Enter to continue/i,
  /waiting for (?:your |user )?(?:input|response|confirmation)/i,
  /\?\s*$/,
];

function isWaitingForHuman(rawOutput: string): boolean {
  const clean = stripAnsi(rawOutput).trim();
  return waitingPatterns.some((p) => p.test(clean));
}

describe("waitingForHuman detection", () => {
  describe("should detect", () => {
    it("(y/n) prompt", () => {
      expect(isWaitingForHuman("Do you want to continue? (y/n)")).toBe(true);
    });

    it("(Y/n) prompt", () => {
      expect(isWaitingForHuman("Proceed with installation? (Y/n)")).toBe(true);
    });

    it("[yes/no] prompt", () => {
      expect(isWaitingForHuman("Overwrite existing file? [yes/no]")).toBe(true);
    });

    it("[Y/n] prompt", () => {
      expect(isWaitingForHuman("Continue? [Y/n]")).toBe(true);
    });

    it("Do you want to proceed", () => {
      expect(isWaitingForHuman("Do you want to proceed with these changes?")).toBe(true);
    });

    it("Allow tool prompt", () => {
      expect(isWaitingForHuman("Allow tool: Read file /src/index.ts?")).toBe(true);
    });

    it("Press Enter to continue", () => {
      expect(isWaitingForHuman("Press Enter to continue...")).toBe(true);
    });

    it("waiting for input", () => {
      expect(isWaitingForHuman("Waiting for your input")).toBe(true);
    });

    it("trailing question mark", () => {
      expect(isWaitingForHuman("What model should we use?")).toBe(true);
    });

    it("prompt with trailing whitespace", () => {
      expect(isWaitingForHuman("Continue? (y/n)   ")).toBe(true);
    });

    it("ANSI-wrapped (y/n) prompt", () => {
      expect(isWaitingForHuman("\x1b[1m\x1b[33mProceed?\x1b[0m (y/n)")).toBe(true);
    });

    it("ANSI-wrapped Allow prompt", () => {
      expect(isWaitingForHuman("\x1b[1mAllow\x1b[0m tool: \x1b[36mBash\x1b[0m?")).toBe(true);
    });
  });

  describe("should NOT detect", () => {
    it("agent reasoning with question in middle", () => {
      expect(isWaitingForHuman("Why did this fail?\n\nLet me check the logs.")).toBe(false);
    });

    it("normal output ending with period", () => {
      expect(isWaitingForHuman("File saved successfully.")).toBe(false);
    });

    it("empty string", () => {
      expect(isWaitingForHuman("")).toBe(false);
    });

    it("just whitespace", () => {
      expect(isWaitingForHuman("   \n\n  ")).toBe(false);
    });
  });

  describe("ANSI stripping", () => {
    it("strips SGR sequences (color, bold)", () => {
      expect(stripAnsi("\x1b[1m\x1b[31mbold red\x1b[0m")).toBe("bold red");
    });

    it("strips OSC sequences (title changes)", () => {
      expect(stripAnsi("\x1b]0;title\x07content")).toBe("content");
    });

    it("handles mixed ANSI and clean text", () => {
      expect(stripAnsi("normal \x1b[32mgreen\x1b[0m normal")).toBe("normal green normal");
    });
  });
});
