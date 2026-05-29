import { describe, expect, it } from "bun:test";
import { hasSensitiveFindings, isProtectiveDecision } from "./risk";
import type { Verdict } from "./config";

describe("risk helpers", () => {
  it("treats BLOCK and MODIFY as protective decisions", () => {
    expect(isProtectiveDecision({ decision: "BLOCK" })).toBe(true);
    expect(isProtectiveDecision({ decision: "MODIFY" })).toBe(true);
    expect(isProtectiveDecision({ decision: "ALLOW" })).toBe(false);
  });

  it("detects PII flags as sensitive findings", () => {
    const verdict: Verdict = {
      decision: "BLOCK",
      risk_flags: { pii: ["EMAIL_ADDRESS"], pii_count: 1 },
    };
    expect(hasSensitiveFindings(verdict)).toBe(true);
  });

  it("detects Presidio entities as sensitive findings", () => {
    const verdict: Verdict = {
      decision: "BLOCK",
      scanner_results: {
        presidio: {
          entities: [{ entity_type: "CREDIT_CARD", score: 0.9, start: 0, end: 4 }],
        },
      },
    };
    expect(hasSensitiveFindings(verdict)).toBe(true);
  });

  it("does not treat generic prompt injection as a PII/secret finding", () => {
    const verdict: Verdict = {
      decision: "BLOCK",
      risk_flags: { prompt_injection: true },
      scanner_results: {
        promptInjection: { is_valid: false },
      },
    };
    expect(hasSensitiveFindings(verdict)).toBe(false);
  });
});
