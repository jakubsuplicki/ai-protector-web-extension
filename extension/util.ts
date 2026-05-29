export const log = (...args: unknown[]): void => {
  console.log("[AIProtector]", ...args);
};

export const warn = (...args: unknown[]): void => {
  console.warn("[AIProtector]", ...args);
};

/**
 * True when the extension context backing this content script is still alive.
 *
 * After the extension is reloaded/updated/disabled, content scripts already
 * injected into open tabs keep running but are orphaned — any `chrome.*` call
 * then throws "Extension context invalidated". `runtime.id` flips to
 * `undefined` in exactly that state, so we use it as a cheap pre-flight check
 * to bail out quietly instead of throwing into the page console.
 */
export function isExtensionContextValid(): boolean {
  try {
    const runtime = (globalThis as { chrome?: { runtime?: { id?: string } } })
      .chrome?.runtime;
    return Boolean(runtime?.id);
  } catch {
    // Touching chrome.runtime itself can throw once the context is gone.
    return false;
  }
}

/**
 * Recognize the "Extension context invalidated" error so callers can swallow
 * it (it's expected after a reload) rather than surfacing an uncaught rejection.
 */
export function isContextInvalidatedError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /Extension context invalidated|context invalidated|message port closed/i.test(
    message,
  );
}
