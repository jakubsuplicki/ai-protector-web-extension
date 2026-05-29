import { describe, it, expect, afterEach } from "bun:test";
import { isContextInvalidatedError, isExtensionContextValid } from "./util";

describe("isExtensionContextValid", () => {
  const original = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    // Restore as a plain writable value (a prior test may have installed a
    // throwing getter, which would otherwise make reassignment fail).
    Object.defineProperty(globalThis as object, "chrome", {
      configurable: true,
      writable: true,
      value: original,
    });
  });

  it("is true when chrome.runtime.id is present (live context)", () => {
    (globalThis as { chrome?: unknown }).chrome = { runtime: { id: "abc123" } };
    expect(isExtensionContextValid()).toBe(true);
  });

  it("is false when runtime.id is undefined (orphaned content script)", () => {
    (globalThis as { chrome?: unknown }).chrome = { runtime: {} };
    expect(isExtensionContextValid()).toBe(false);
  });

  it("is false when chrome is absent entirely", () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    expect(isExtensionContextValid()).toBe(false);
  });

  it("is false when touching chrome.runtime throws", () => {
    Object.defineProperty(globalThis as object, "chrome", {
      configurable: true,
      get() {
        throw new Error("Extension context invalidated.");
      },
    });
    expect(isExtensionContextValid()).toBe(false);
  });
});

describe("isContextInvalidatedError", () => {
  it("matches the canonical invalidated-context error", () => {
    expect(
      isContextInvalidatedError(new Error("Extension context invalidated.")),
    ).toBe(true);
  });

  it("matches a closed message port", () => {
    expect(
      isContextInvalidatedError(
        new Error("The message port closed before a response was received."),
      ),
    ).toBe(true);
  });

  it("matches plain string messages", () => {
    expect(isContextInvalidatedError("context invalidated")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isContextInvalidatedError(new Error("network timeout"))).toBe(false);
    expect(isContextInvalidatedError(null)).toBe(false);
    expect(isContextInvalidatedError(undefined)).toBe(false);
  });
});
