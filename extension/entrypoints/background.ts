import { SCAN_ENDPOINT, SCAN_TIMEOUT_MS, type Verdict } from "../config";
import { healthEndpointFor, readSettings, scanEndpointFor } from "../settings";
import { log, warn } from "../util";

type ScanRequest = {
  type: "AIPROT_SCAN";
  prompt: string;
  site: string;
};

// Minimal structural types for the slices of the chrome API we touch. WXT
// provides full types in some contexts, but the SW reaches for `chrome.action`
// and `chrome.alarms` which we narrow here to keep this file self-contained.
type ChromeApi = {
  runtime: {
    getURL(path: string): string;
    onMessage: {
      addListener(
        listener: (
          msg: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  action: {
    setIcon(details: { path: Record<number, string> }): void;
    setTitle(details: { title: string }): void;
  };
  alarms: {
    create(name: string, info: { periodInMinutes: number }): void;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
};

// Fail-open policy: if the engine is unreachable or times out we ALLOW.
// For a PoC, a hung engine shouldn't brick all ChatGPT usage on the user's
// machine. Enterprise/MDM deployment (Stage 4+) should flip this to fail-closed.
const FAIL_OPEN_VERDICT: Verdict = { decision: "ALLOW", error: "fail-open" };

// Toolbar status icon: the SW swaps the action icon between a full-color
// "online" shield and a grayed "offline" shield (with a disconnect X) so engine
// reachability reads at a glance without opening the popup. Icon assets live in
// public/icons and are addressed by their output-relative path.
const HEALTH_ALARM = "aiprot-health";
const HEALTH_PERIOD_MINUTES = 1; // re-ping while idle so the icon stays fresh

const ONLINE_ICONS = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};
const OFFLINE_ICONS = {
  16: "icons/icon-offline-16.png",
  32: "icons/icon-offline-32.png",
  48: "icons/icon-offline-48.png",
  128: "icons/icon-offline-128.png",
};

let lastStatusOnline: boolean | null = null;

function chromeApi(): ChromeApi {
  return (globalThis as unknown as { chrome: ChromeApi }).chrome;
}

// Resolve manifest-relative icon paths to fully-qualified extension URLs.
function resolveIcons(icons: Record<number, string>): Record<number, string> {
  const api = chromeApi();
  const out: Record<number, string> = {};
  for (const [size, path] of Object.entries(icons)) {
    out[Number(size)] = api.runtime.getURL(path);
  }
  return out;
}

/**
 * Reflect engine status on the toolbar icon. Idempotent and cheap: skips the
 * chrome.action calls when the status hasn't changed so we don't thrash the UI
 * on every scan.
 */
function setStatus(online: boolean): void {
  if (online === lastStatusOnline) return;
  lastStatusOnline = online;
  const api = chromeApi();
  try {
    api.action.setIcon({ path: resolveIcons(online ? ONLINE_ICONS : OFFLINE_ICONS) });
    api.action.setTitle({
      title: online ? "AI Protector — engine online" : "AI Protector — engine offline",
    });
  } catch (err) {
    // Older/edge runtimes may not expose chrome.action; status is best-effort.
    warn("setStatus failed", err);
  }
}

/**
 * Lightweight reachability probe used by the periodic alarm. Distinct from a
 * scan: GET /health is cheap and side-effect-free, so we can poll it while idle
 * without burdening the engine.
 */
async function pingHealth(): Promise<void> {
  const settings = await readSettings();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch(healthEndpointFor(settings), { signal: ctrl.signal });
    setStatus(res.ok);
  } catch {
    setStatus(false);
  } finally {
    clearTimeout(timer);
  }
}

export default defineBackground(() => {
  const api = chromeApi();

  log("service worker started");

  // Seed the badge immediately on startup, then keep it fresh with a periodic
  // health ping so the user sees the engine recover even while idle.
  void pingHealth();
  api.alarms.create(HEALTH_ALARM, { periodInMinutes: HEALTH_PERIOD_MINUTES });
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEALTH_ALARM) void pingHealth();
  });

  // IMPORTANT: service workers terminate after ~30s idle. Never stash state
  // on module scope — use chrome.storage.session / .local when we add caching.
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isScanRequest(msg)) return false;
    log("SW received scan request", msg.prompt.slice(0, 50));
    scan(msg.prompt)
      .then((verdict) => {
        log("SW scan complete", verdict.decision);
        sendResponse(verdict);
      })
      .catch((err: unknown) => {
        warn("scan failed — failing open", err);
        sendResponse({ ...FAIL_OPEN_VERDICT, error: String(err) } satisfies Verdict);
      });
    return true; // keep sendResponse channel open for async
  });
});

async function scan(prompt: string): Promise<Verdict> {
  const settings = await readSettings();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCAN_TIMEOUT_MS);
  try {
    const endpoint = scanEndpointFor(settings) || SCAN_ENDPOINT;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-policy": settings.policyName,
      },
      body: JSON.stringify({
        model: "llama3.1:8b",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as Verdict;
    log("verdict", { status: res.status, ...data });
    // A completed scan is the strongest possible signal the engine is up.
    setStatus(true);
    return data;
  } catch (err) {
    // Abort/network failure means we couldn't reach the engine — reflect it.
    setStatus(false);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isScanRequest(v: unknown): v is ScanRequest {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "AIPROT_SCAN" &&
    typeof (v as { prompt?: unknown }).prompt === "string"
  );
}
