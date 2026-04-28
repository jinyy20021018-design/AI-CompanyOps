import type { ScratchpadMessage } from "./scratchpadWatcher.js";

export type GuardrailFlag = {
  type: "prompt_injection" | "pii_detected" | "identity_spoofing" | "control_chars";
  detail: string;
};

export type GuardrailResult = {
  /** Whether the message should be delivered (false = block entirely) */
  allowed: boolean;
  /** Always present — may have PII redacted or control chars stripped */
  sanitized: ScratchpadMessage;
  flags: GuardrailFlag[];
};

// Stable agent identities that are always legitimate senders
const KNOWN_SENDERS = new Set([
  "coordinator", "product", "engineering", "marketing", "qa", "finance",
  "user", "system",
]);

/**
 * Prompt injection / jailbreaking detection patterns.
 *
 * These catch the most common textual attack vectors:
 *  - Instruction override phrases ("ignore previous instructions")
 *  - Persona hijacking ("you are now", "act as")
 *  - Explicit jailbreak keywords ("DAN mode", "developer mode")
 *  - Prompt template injection (raw delimiters from other LLM formats)
 *
 * Limitation: purely lexical — an attacker can bypass via Base64 encoding,
 * synonyms, or subtle paraphrasing. A production system should layer an
 * LLM-based classifier (e.g. LlamaGuard, or a Claude meta-prompt) on top.
 */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|directives?)/i, label: "ignore_instructions" },
  { pattern: /forget\s+(your|all|everything|previous|prior)/i,                                   label: "forget_instructions" },
  { pattern: /disregard\s+(your|all|the\s+above|previous|prior)/i,                               label: "disregard_instructions" },
  { pattern: /you\s+are\s+now\s+(a|an)\s+/i,                                                     label: "persona_override" },
  { pattern: /act\s+as\s+(if\s+you\s+(are|were)\s+|an?\s+)/i,                                    label: "persona_override" },
  { pattern: /\bnew\s+role\b|\bnew\s+instructions?\b|\bnew\s+task\s+override\b/i,                label: "instruction_override" },
  { pattern: /override\s+(your\s+)?(system|safety|guardrail|constraints?|alignment)/i,            label: "override_safety" },
  { pattern: /\bdeveloper\s+mode\b|\bdan\s+mode\b|\bjailbreak\b/i,                               label: "jailbreak_keyword" },
  { pattern: /\bdo\s+anything\s+now\b/i,                                                          label: "jailbreak_keyword" },
  // Raw prompt delimiters from other LLM formats injected into message content
  { pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>|<\|system\|>/,                    label: "template_injection" },
  // Classic indirect injection via hidden instructions in what looks like data
  { pattern: /###\s*instruction|##\s*system\s*message/i,                                          label: "markdown_injection" },
];

/**
 * PII (Personally Identifiable Information) detection patterns.
 *
 * These use structural regex for well-formatted PII. Unlike semantic PII
 * (names, addresses) that requires an NER model, structured PII like emails
 * and card numbers have reliable syntactic patterns.
 *
 * On match: redact the value rather than blocking — the message intent is
 * preserved, but the sensitive data is not forwarded to agent contexts or
 * written to shared storage.
 */
const PII_PATTERNS: Array<{ pattern: RegExp; label: string; replacement: string }> = [
  { pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,     label: "email",       replacement: "[EMAIL REDACTED]" },
  { pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,     label: "phone",       replacement: "[PHONE REDACTED]" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                   label: "ssn",         replacement: "[SSN REDACTED]" },
  // Visa, Mastercard, Amex card number patterns
  { pattern: /\b4[0-9]{12}(?:[0-9]{3})?\b|\b5[1-5][0-9]{14}\b|\b3[47][0-9]{13}\b/g, label: "credit_card", replacement: "[CARD REDACTED]" },
];

// Control characters that, if injected into a PTY notification string, could
// simulate keystrokes or execute commands (e.g. \r = Enter, \x03 = Ctrl-C).
const CONTROL_CHAR_RE = /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Validate and sanitize a scratchpad message before it is written to shared
 * storage or injected into an agent PTY.
 *
 * Returns:
 *  - allowed=false  → block; do not write or deliver the message
 *  - allowed=true   → deliver `sanitized` (PII redacted, control chars stripped)
 *  - flags          → audit log of what was detected
 */
export function validateMessage(msg: ScratchpadMessage): GuardrailResult {
  const flags: GuardrailFlag[] = [];
  let sanitized = { ...msg };

  // ── 1. Identity verification ─────────────────────────────────────────────
  // Soft check: unknown senders are flagged but not blocked, because dynamic
  // session names are valid in multi-project setups. The flag is audit-only.
  if (!KNOWN_SENDERS.has(msg.from)) {
    flags.push({ type: "identity_spoofing", detail: `Unrecognized sender: "${msg.from}"` });
  }

  // ── 2. Prompt injection / jailbreak detection ────────────────────────────
  // Hard block: any injection pattern in the message body causes rejection.
  for (const { pattern, label } of INJECTION_PATTERNS) {
    // Reset lastIndex for global-flagged patterns used in test() calls
    pattern.lastIndex = 0;
    if (pattern.test(msg.msg)) {
      flags.push({ type: "prompt_injection", detail: label });
    }
  }
  const blocked = flags.some(f => f.type === "prompt_injection");

  // ── 3. PII detection and redaction ───────────────────────────────────────
  // Sanitize: replace PII in-place so message intent is preserved without
  // leaking sensitive data into agent contexts or shared storage.
  let redactedContent = msg.msg;
  for (const { pattern, label, replacement } of PII_PATTERNS) {
    const matches = redactedContent.match(pattern);
    if (matches) {
      flags.push({ type: "pii_detected", detail: `${label} ×${matches.length}` });
      redactedContent = redactedContent.replace(pattern, replacement);
    }
  }
  sanitized = { ...sanitized, msg: redactedContent };

  // ── 4. Control character stripping ───────────────────────────────────────
  // Newlines / carriage returns inside message content, when embedded into the
  // PTY notification string, can simulate pressing Enter and execute arbitrary
  // shell commands. Strip them unconditionally.
  if (CONTROL_CHAR_RE.test(sanitized.msg)) {
    flags.push({ type: "control_chars", detail: "control characters stripped" });
    sanitized = { ...sanitized, msg: sanitized.msg.replace(CONTROL_CHAR_RE, " ") };
  }

  return { allowed: !blocked, sanitized, flags };
}

/**
 * Sanitize a string specifically for embedding into a PTY write() call.
 *
 * This is a second line of defence at the injection site in messageRouting.ts:
 * even if a message passes guardrail checks, the preview text embedded in the
 * PTY notification must not contain characters that the terminal would
 * interpret as control sequences or line endings.
 */
export function sanitizeForPty(text: string, maxLen = 120): string {
  return text.replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, maxLen);
}
