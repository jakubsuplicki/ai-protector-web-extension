import {
  ISOLATED_SOURCE,
  MAIN_SOURCE,
  type ScanAction,
  type ScanReply,
  type Verdict,
} from "../config";
import { hasSensitiveFindings, isProtectiveDecision } from "../risk";
import {
  readSettings,
  writeLastScan,
  type ExtensionSettings,
  type SiteId,
} from "../settings";
import { renderWarning } from "./warning";
import {
  isContextInvalidatedError,
  isExtensionContextValid,
  log,
  warn,
} from "../util";

type MainRequest = {
  source: typeof MAIN_SOURCE;
  id: string;
  prompt: string;
};

// Explicit fail-open verdict. Sent to MAIN whenever the relay can't reach the
// service worker (e.g., SW crashed, extension reloaded mid-request). Matches
// the fail-open policy in background.ts so both failure paths look the same.
const RELAY_FAIL_OPEN: Verdict = {
  decision: "ALLOW",
  error: "relay-error",
};

/**
 * Wire up the ISOLATED-world message listener for a given site. This is the
 * shared relay that:
 *   1. Receives prompts from MAIN world via postMessage
 *   2. Sends them to the service worker for scanning
 *   3. Relays the verdict back to MAIN (explicit fail-open on error)
 *   4. Renders the warning UI on BLOCK / MODIFY
 *
 * Both chatgpt.content.ts and claude.content.ts use this — the only
 * difference is the `site` tag passed to the scanner.
 */
export function installRelay(site: SiteId): void {
  const pageOrigin = window.location.origin;
  log(`ISOLATED content script loaded (${site})`);

  window.addEventListener("message", async (ev: MessageEvent) => {
    if (ev.source !== window || ev.origin !== pageOrigin) return;
    const data = ev.data as Partial<MainRequest> | null;
    if (
      !data ||
      data.source !== MAIN_SOURCE ||
      typeof data.id !== "string" ||
      typeof data.prompt !== "string"
    ) {
      return;
    }
    const { id, prompt } = data;

    // The extension may have been reloaded/updated while this content script
    // stayed alive in an open tab. Any chrome.* call would then throw "Extension
    // context invalidated". Bail quietly and let MAIN fail open — the page keeps
    // working; the user just needs to reload the tab to restore protection.
    if (!isExtensionContextValid()) {
      window.postMessage(
        { source: ISOLATED_SOURCE, id, verdict: RELAY_FAIL_OPEN, action: "allow" },
        pageOrigin,
      );
      return;
    }

    try {
      await handleScan(id, prompt, site, pageOrigin);
    } catch (err) {
      if (isContextInvalidatedError(err)) {
        // Expected after a reload — swallow so it doesn't surface as an
        // uncaught rejection in the page console.
        return;
      }
      throw err;
    }
  });
}

async function handleScan(
  id: string,
  prompt: string,
  site: SiteId,
  pageOrigin: string,
): Promise<void> {
  log("ISOLATED received prompt, relaying to SW", id);

  const settings = await readSettings();
  if (!settings.enabledSites[site]) {
    const reply: ScanReply = {
      verdict: { decision: "ALLOW", error: "site-disabled" },
      action: "allow",
    };
    await recordScan(reply, site, settings, false);
    window.postMessage({ source: ISOLATED_SOURCE, id, ...reply }, pageOrigin);
    return;
  }

  let verdict: Verdict | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cr = (globalThis as any).chrome as typeof browser;
    verdict = await new Promise<Verdict | undefined>((resolve) => {
      cr.runtime.sendMessage(
        { type: "AIPROT_SCAN", prompt, site },
        (response: unknown) => {
          if (cr.runtime.lastError) {
            warn("relay error", cr.runtime.lastError.message);
            resolve(undefined);
          } else {
            resolve(response as Verdict | undefined);
          }
        },
      );
    });
    log("ISOLATED got verdict from SW", verdict?.decision);
  } catch (err) {
    warn("relay error", err);
  }

  // Always reply — MAIN is awaiting this verdict. On relay failure, send an
  // explicit fail-open ALLOW instead of `undefined` so both sides share one
  // well-typed contract (and regressions are harder to introduce).
  const finalVerdict = verdict ?? RELAY_FAIL_OPEN;
  const sensitive = hasSensitiveFindings(finalVerdict);
  const action = await resolveAction(finalVerdict, prompt, settings, sensitive);
  const reply: ScanReply = { verdict: finalVerdict, action };

  await recordScan(reply, site, settings, sensitive);
  log("ISOLATED posting verdict back to MAIN", id, finalVerdict.decision, action);
  window.postMessage({ source: ISOLATED_SOURCE, id, ...reply }, pageOrigin);
}

async function resolveAction(
  verdict: Verdict,
  prompt: string,
  settings: ExtensionSettings,
  sensitive: boolean,
): Promise<ScanAction> {
  if (!isProtectiveDecision(verdict)) return "allow";

  if (settings.protectionMode === "observe") {
    void renderWarning(verdict, prompt, { mode: "observe", sensitive });
    return "allow";
  }

  if (
    settings.protectionMode === "ask" &&
    (!sensitive || settings.allowSensitiveOverride)
  ) {
    const choice = await renderWarning(verdict, prompt, {
      mode: "ask",
      sensitive,
    });
    return choice === "allow" ? "allow" : "block";
  }

  // In strict mode every protective decision blocks. MODIFY blocks too: the
  // extension can't apply the engine's server-side mask (it scans, it doesn't
  // proxy), so the only way to honor a "mask this PII" verdict is to stop the
  // prompt. Letting MODIFY through would leak the very data it flagged.
  void renderWarning(verdict, prompt, { mode: "strict", sensitive });
  return "block";
}

async function recordScan(
  reply: ScanReply,
  site: SiteId,
  settings: ExtensionSettings,
  sensitive: boolean,
): Promise<void> {
  // Best-effort: recording the last scan for the popup must never block or
  // break the actual verdict reply. A dead context or storage hiccup here is
  // swallowed (the protection decision already happened).
  try {
    await writeLastScan({
      at: new Date().toISOString(),
      site,
      decision: String(reply.verdict.decision),
      action: reply.action,
      mode: settings.protectionMode,
      policyName: settings.policyName,
      riskScore: reply.verdict.risk_score,
      reason: reply.verdict.blocked_reason,
      sensitive,
      error: reply.verdict.error,
    });
  } catch (err) {
    if (!isContextInvalidatedError(err)) warn("recordScan failed", err);
  }
}
