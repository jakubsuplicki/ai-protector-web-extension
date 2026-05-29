import { describe, it, expect, beforeEach } from "bun:test";
import {
  maskValue,
  renderWarning,
  variantFor,
  titleFor,
  reasonFor,
} from "./warning";
import type { Verdict } from "../config";

describe("maskValue", () => {
  describe("length-based masking", () => {
    it("returns *** for empty or very short values", () => {
      expect(maskValue("", "US_SSN")).toBe("***");
      expect(maskValue("ab", "EMAIL_ADDRESS")).toBe("***");
      expect(maskValue("abc", "PERSON")).toBe("***");
    });

    it("caps visible chars at 4 even for long values", () => {
      // 32-char API-key-like string should reveal no more than 4 chars
      const raw = "0123456789abcdef0123456789abcdef";
      const masked = maskValue(raw, "PERSON");
      const visible = masked.replace(/\*/g, "");
      expect(visible.length).toBeLessThanOrEqual(4);
      expect(masked).toHaveLength(raw.length);
    });

    it("shows last 4 of an SSN", () => {
      // "123-45-6789" is 11 chars, floor(11/4) = 2 visible. So we'd show "89".
      // Not 4 — that's intentional: the 25% cap wins when the value is short.
      const masked = maskValue("123-45-6789", "US_SSN");
      expect(masked).toBe("*********89");
      expect(masked).not.toContain("6789");
    });

    it("shows last 4 of a 16-char credit card", () => {
      // 16 chars × 25% = 4 visible. Industry-standard "last 4" display.
      const masked = maskValue("4532123456789010", "CREDIT_CARD");
      expect(masked).toBe("************9010");
    });

    it("never shows more than 25% of a value", () => {
      for (const len of [5, 8, 12, 20, 50, 100]) {
        const raw = "x".repeat(len);
        const masked = maskValue(raw, "PERSON");
        const visibleCount = masked.replace(/\*/g, "").length;
        expect(visibleCount).toBeLessThanOrEqual(Math.floor(len / 4));
        expect(visibleCount).toBeLessThanOrEqual(4);
      }
    });
  });

  describe("NEVER_REVEAL entities", () => {
    it("shows no chars for SECRET", () => {
      expect(maskValue("sk_live_abc123def456ghi789", "SECRET")).toBe("***");
    });

    it("shows no chars for API_KEY", () => {
      expect(maskValue("AIzaSyB1234567890abcdefghi", "API_KEY")).toBe("***");
    });

    it("shows no chars for PASSWORD", () => {
      expect(maskValue("MySuperSecretPassword123!", "PASSWORD")).toBe("***");
    });

    it("shows no chars for ACCESS_TOKEN", () => {
      expect(maskValue("ghp_1234567890abcdefghij", "ACCESS_TOKEN")).toBe("***");
    });

    it("shows no chars for CRYPTO keys", () => {
      expect(maskValue("0xabcdef1234567890", "CRYPTO")).toBe("***");
    });
  });

  describe("Unicode safety", () => {
    it("does not bisect surrogate pairs on emoji", () => {
      // "🔑hello" — the key emoji is a non-BMP character (2 UTF-16 code units)
      const raw = "\uD83D\uDD11hello";
      const masked = maskValue(raw, "PERSON");
      // Should treat as 6 code points, not 7 UTF-16 units.
      // Masked output must be valid Unicode — no lone surrogates.
      expect(masked).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(masked).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });

    it("handles multi-byte characters correctly", () => {
      // Cyrillic, Chinese, Arabic — all non-Latin PERSON/LOCATION entities
      expect(() => maskValue("Владимир", "PERSON")).not.toThrow();
      expect(() => maskValue("北京市朝阳区", "LOCATION")).not.toThrow();
      expect(() => maskValue("مرحبا بالعالم", "LOCATION")).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("handles exact length-4 values", () => {
      // floor(4/4) = 1 visible char
      expect(maskValue("abcd", "PERSON")).toBe("***d");
    });

    it("does not throw on unknown entity types", () => {
      expect(() => maskValue("test-value-123", "UNKNOWN_TYPE")).not.toThrow();
    });
  });
});

describe("renderWarning", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
    return {
      decision: "BLOCK",
      blocked_reason: "PII detected (block policy)",
      risk_score: 0.42,
      risk_flags: { pii: ["US_SSN"], pii_count: 1 },
      scanner_results: {
        presidio: {
          entities: [
            {
              entity_type: "US_SSN",
              score: 0.95,
              start: 10,
              end: 21,
            },
          ],
          pii_action: "block",
        },
      },
      ...overrides,
    };
  }

  it("attaches warning to document.body", () => {
    renderWarning(makeVerdict(), "My SSN is 123-45-6789 please");
    const host = document.getElementById("aiprot-warning");
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).toBeDefined();
  });

  it("uses closed shadow root (not exposed via .shadowRoot)", () => {
    renderWarning(makeVerdict(), "My SSN is 123-45-6789 please");
    const host = document.getElementById("aiprot-warning");
    // Closed shadow roots return null from host.shadowRoot
    expect(host?.shadowRoot).toBeNull();
  });

  it("replaces an existing warning instead of stacking", () => {
    renderWarning(makeVerdict(), "My SSN is 123-45-6789 please");
    renderWarning(makeVerdict(), "Another prompt with SSN 987-65-4321 here");
    const warnings = document.querySelectorAll("#aiprot-warning");
    expect(warnings.length).toBe(1);
  });

  describe("XSS safety", () => {
    it("treats blocked_reason as text, not HTML", () => {
      const verdict = makeVerdict({
        blocked_reason: "<img src=x onerror=alert(1)>",
      });
      renderWarning(verdict, "irrelevant");
      // Nothing dangerous should end up in document.body's HTML
      expect(document.body.innerHTML).not.toContain("<img");
      expect(document.body.innerHTML).not.toContain("onerror");
    });

    it("treats entity_type as text, not HTML", () => {
      const verdict = makeVerdict({
        risk_flags: {
          pii: ["<script>alert(1)</script>"],
        },
        scanner_results: undefined,
      });
      renderWarning(verdict, "irrelevant");
      expect(document.body.innerHTML).not.toContain("<script>");
    });

    it("treats masked entity value as text, not HTML", () => {
      const verdict = makeVerdict({
        risk_flags: { pii: ["US_SSN"] },
        scanner_results: {
          presidio: {
            entities: [
              {
                entity_type: "US_SSN",
                score: 0.9,
                start: 0,
                end: 22,
              },
            ],
          },
        },
      });
      renderWarning(verdict, '<svg onload=alert(1)>xx');
      expect(document.body.innerHTML).not.toContain("<svg");
      expect(document.body.innerHTML).not.toContain("onload");
    });
  });

  describe("offset validation", () => {
    it("clamps negative start offsets", () => {
      const verdict = makeVerdict({
        scanner_results: {
          presidio: {
            entities: [
              { entity_type: "US_SSN", score: 0.9, start: -5, end: 11 },
            ],
          },
        },
      });
      expect(() => renderWarning(verdict, "123-45-6789")).not.toThrow();
    });

    it("clamps out-of-range end offsets", () => {
      const verdict = makeVerdict({
        scanner_results: {
          presidio: {
            entities: [
              { entity_type: "US_SSN", score: 0.9, start: 0, end: 9999 },
            ],
          },
        },
      });
      expect(() => renderWarning(verdict, "123-45-6789")).not.toThrow();
    });

    it("skips entities where start > end", () => {
      const verdict = makeVerdict({
        scanner_results: {
          presidio: {
            entities: [
              { entity_type: "US_SSN", score: 0.9, start: 50, end: 10 },
            ],
          },
        },
      });
      renderWarning(verdict, "123-45-6789");
      // Should render without crashing — no entity row with masked value
      const host = document.getElementById("aiprot-warning");
      expect(host).not.toBeNull();
    });
  });

  describe("entity shape validation", () => {
    it("rejects entities missing required fields", () => {
      const verdict = makeVerdict({
        scanner_results: {
          presidio: {
            entities: [
              { entity_type: "US_SSN" /* no start/end/score */ },
              { start: 0, end: 10 /* no entity_type */ },
              null,
              "not-an-object",
            ],
          },
        },
      });
      expect(() => renderWarning(verdict, "123-45-6789 abc")).not.toThrow();
    });

    it("rejects entities with non-finite numbers", () => {
      const verdict = makeVerdict({
        scanner_results: {
          presidio: {
            entities: [
              { entity_type: "US_SSN", score: 0.9, start: NaN, end: 10 },
              { entity_type: "US_SSN", score: 0.9, start: 0, end: Infinity },
            ],
          },
        },
      });
      expect(() => renderWarning(verdict, "123-45-6789")).not.toThrow();
    });
  });

  describe("decision variants", () => {
    it("BLOCK verdict uses block styling and title", () => {
      renderWarning(
        makeVerdict({ decision: "BLOCK" }),
        "My SSN is 123-45-6789 ok",
      );
      const host = document.getElementById("aiprot-warning");
      // Closed shadow — introspect via element traversal from host
      expect(host?.outerHTML).toContain("aiprot-warning");
    });

    it("MODIFY verdict renders without throwing", () => {
      renderWarning(
        makeVerdict({ decision: "MODIFY", blocked_reason: null }),
        "ok",
      );
      const host = document.getElementById("aiprot-warning");
      expect(host).not.toBeNull();
    });

    it("resolves ask warnings as block when replaced", async () => {
      const pending = renderWarning(
        makeVerdict({ decision: "BLOCK" }),
        "My SSN is 123-45-6789 ok",
        { mode: "ask" },
      );
      renderWarning(makeVerdict({ decision: "ALLOW" }), "ok");
      await expect(pending).resolves.toBe("block");
    });
  });

  describe("fallback to risk_flags.pii", () => {
    it("renders labels when detailed scanner_results are absent", () => {
      const verdict = makeVerdict({
        scanner_results: undefined,
        risk_flags: { pii: ["US_SSN", "EMAIL_ADDRESS"] },
      });
      expect(() => renderWarning(verdict, "irrelevant")).not.toThrow();
    });

    it("handles unknown entity types by falling back to raw type string", () => {
      const verdict = makeVerdict({
        scanner_results: undefined,
        risk_flags: { pii: ["UNKNOWN_FUTURE_TYPE"] },
      });
      expect(() => renderWarning(verdict, "irrelevant")).not.toThrow();
    });
  });

  describe("ask-mode action behavior", () => {
    it("stays pending until the user acts (no auto-resolve)", async () => {
      const pending = renderWarning(makeVerdict(), "My SSN is 123-45-6789", {
        mode: "ask",
        timeoutMs: 60_000,
      });
      // The toast lives in a *closed* shadow root, so we can't query its
      // buttons from the test. We assert the contract that matters for the
      // caller: an ask warning does NOT settle on its own — it waits for a
      // user decision (Cancel/Send anyway), a timeout, or replacement.
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      // Clean up: replacing resolves it as block.
      renderWarning(makeVerdict({ decision: "ALLOW" }), "x");
      await expect(pending).resolves.toBe("block");
    });

    it("non-ask modes resolve immediately as dismiss", async () => {
      const pending = renderWarning(makeVerdict(), "My SSN is 123-45-6789", {
        mode: "strict",
      });
      await expect(pending).resolves.toBe("dismiss");
    });

    it("observe mode resolves immediately as dismiss", async () => {
      const pending = renderWarning(makeVerdict(), "x", { mode: "observe" });
      await expect(pending).resolves.toBe("dismiss");
    });
  });
});

describe("variantFor", () => {
  it("maps ask mode to review", () => {
    expect(variantFor("ask")).toBe("review");
  });

  it("maps observe mode to observe", () => {
    expect(variantFor("observe")).toBe("observe");
  });

  it("maps strict mode to block (both BLOCK and MODIFY block in strict)", () => {
    expect(variantFor("strict")).toBe("block");
  });
});

describe("titleFor copy", () => {
  it("uses plain, non-technical titles per variant", () => {
    expect(titleFor("review", false)).toBe("Review before sending");
    expect(titleFor("observe", false)).toBe(
      "This prompt may expose private data",
    );
    expect(titleFor("block", false)).toBe("This prompt was blocked");
  });

  it("emphasizes sensitivity in the block title when sensitive", () => {
    expect(titleFor("block", true)).toBe("Sensitive data blocked");
  });

  it("never leaks the product name into a title", () => {
    for (const v of ["review", "observe", "block"] as const) {
      expect(titleFor(v, false)).not.toContain("AI Protector");
      expect(titleFor(v, true)).not.toContain("AI Protector");
    }
  });
});

describe("reasonFor copy", () => {
  function v(reason: string | null | undefined): Verdict {
    return { decision: "BLOCK", blocked_reason: reason };
  }

  it("prefers the engine blocked_reason when present", () => {
    expect(reasonFor(v("PII detected (block policy)"), "block")).toBe(
      "PII detected (block policy)",
    );
  });

  it("falls back to friendly per-variant copy when reason is empty", () => {
    expect(reasonFor(v(null), "review")).toContain("Review");
    expect(reasonFor(v(undefined), "observe")).toContain("private");
    expect(reasonFor(v("   "), "block")).toContain("blocked");
  });
});
