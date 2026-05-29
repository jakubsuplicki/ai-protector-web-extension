import { SCAN_TIMEOUT_MS } from "../../config";
import {
  POLICY_OPTIONS,
  healthEndpointFor,
  normalizeEngineUrl,
  readLastScan,
  readSettings,
  resetSettings,
  saveSettings,
  type ExtensionSettings,
  type LastScan,
  type PolicyName,
  type ProtectionMode,
} from "../../settings";

// ── Explanatory copy ──────────────────────────────────────────────────
// Plain-language descriptions surfaced as helper text under each control, so a
// non-technical user understands what they're choosing without reading docs.

const MODE_HELP: Record<ProtectionMode, string> = {
  strict:
    "Blocks risky prompts automatically before they reach the AI. You aren't asked — unsafe content just doesn't send.",
  ask: "Warns you when a prompt looks risky and lets you decide: cancel, or send it anyway.",
  observe:
    "Never blocks. Just flags risky prompts with a notice so you can watch what's detected — good for trying it out.",
};

// Friendly display name + a two-part description per engine policy: `detects`
// is a bold lead summarising what the policy catches (the key differentiator),
// `help` is the trade-off / contrast. Derived from the seeded policy
// definitions (engine db/seed.py) and how the extension acts on each verdict —
// note only BLOCK stops a prompt; a policy that detects PII only matters here
// if it blocks on it.
const POLICY_INFO: Record<
  PolicyName,
  { label: string; detects: string; help: string }
> = {
  dlp: {
    label: "DLP — data loss prevention",
    detects: "Blocks personal data, secrets & prompt injection.",
    help: "Stops prompts that contain names, emails, cards, SSNs or API keys before they reach the AI. The data-protection choice for this extension.",
  },
  balanced: {
    label: "Balanced — attack defense",
    detects: "Blocks prompt-injection & jailbreaks only.",
    help: "Does NOT scan for personal data or secrets — those pass through. Pick DLP or Paranoid if your goal is keeping private data out.",
  },
  strict: {
    label: "Strict — thorough",
    detects: "Blocks personal data, secrets, injection + an extra ML safety check.",
    help: "Everything Balanced does plus personal-data detection, with the tightest analysis. The most thorough; expect more false positives.",
  },
  fast: {
    label: "Fast — minimal",
    detects: "Denylist keyword rules only.",
    help: "No scanning for personal data, secrets or injection. Fastest and most permissive — the weakest protection, for trusted use only.",
  },
  paranoid: {
    label: "Paranoid — maximum",
    detects: "Blocks personal data, secrets, injection at the tightest thresholds.",
    help: "Everything Strict does, plus decoy “canary” tokens, and flags borderline prompts. Blocks the most — expect frequent interruptions.",
  },
};

const SENSITIVE_HELP_ASK =
  "When on, the “Send anyway” button also appears for personal data and secrets — so you can override even those. Off keeps PII and secrets always blocked, even in Ask mode.";
const SENSITIVE_HELP_DISABLED =
  "Only applies in Ask mode. In Strict and Observe this setting has no effect.";

const modeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mode]"),
);
const policySelect = requireElement<HTMLSelectElement>("policy");
const engineInput = requireElement<HTMLInputElement>("engine-url");
const checkEngineButton = requireElement<HTMLButtonElement>("check-engine");
const chatgptToggle = requireElement<HTMLInputElement>("site-chatgpt");
const claudeToggle = requireElement<HTMLInputElement>("site-claude");
const allowSensitiveToggle = requireElement<HTMLInputElement>("allow-sensitive");
const sensitiveRow = requireElement<HTMLElement>("sensitive-row");
const resetButton = requireElement<HTMLButtonElement>("reset");
const saved = requireElement<HTMLElement>("saved");
const engineStatus = requireElement<HTMLElement>("engine-status");
const engineDot = requireElement<HTMLElement>("engine-dot");
const lastScan = requireElement<HTMLElement>("last-scan");
const modeHelp = requireElement<HTMLElement>("mode-help");
const policyHelp = requireElement<HTMLElement>("policy-help");
const sensitiveHelp = requireElement<HTMLElement>("sensitive-help");

let currentSettings: ExtensionSettings;

for (const policyName of POLICY_OPTIONS) {
  const option = document.createElement("option");
  option.value = policyName;
  // Friendly label when known; fall back to the raw name for any future policy.
  option.textContent = POLICY_INFO[policyName]?.label ?? policyName;
  policySelect.appendChild(option);
}

void boot();

async function boot(): Promise<void> {
  currentSettings = await readSettings();
  renderSettings(currentSettings);
  renderLastScan(await readLastScan());
  await refreshEngineStatus(currentSettings);

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      if (isProtectionMode(mode)) void persist({ protectionMode: mode });
    });
  }

  policySelect.addEventListener("change", () => {
    void persist({ policyName: policySelect.value as ExtensionSettings["policyName"] });
  });

  engineInput.addEventListener("change", () => {
    void persist({ engineUrl: normalizeEngineUrl(engineInput.value) });
  });

  engineInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") engineInput.blur();
  });

  checkEngineButton.addEventListener("click", () => {
    void refreshEngineStatus(currentSettings);
  });

  chatgptToggle.addEventListener("change", () => {
    void persist({ enabledSites: { chatgpt: chatgptToggle.checked } });
  });

  claudeToggle.addEventListener("change", () => {
    void persist({ enabledSites: { claude: claudeToggle.checked } });
  });

  allowSensitiveToggle.addEventListener("change", () => {
    void persist({ allowSensitiveOverride: allowSensitiveToggle.checked });
  });

  resetButton.addEventListener("click", async () => {
    currentSettings = await resetSettings();
    renderSettings(currentSettings);
    setSaved("Reset");
    await refreshEngineStatus(currentSettings);
  });
}

async function persist(
  patch: Parameters<typeof saveSettings>[0],
): Promise<void> {
  currentSettings = await saveSettings(patch);
  renderSettings(currentSettings);
  setSaved("Saved");
  await refreshEngineStatus(currentSettings);
}

function renderSettings(settings: ExtensionSettings): void {
  for (const button of modeButtons) {
    const active = button.dataset.mode === settings.protectionMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  policySelect.value = settings.policyName;
  engineInput.value = settings.engineUrl;
  chatgptToggle.checked = settings.enabledSites.chatgpt;
  claudeToggle.checked = settings.enabledSites.claude;
  allowSensitiveToggle.checked = settings.allowSensitiveOverride;

  const askMode = settings.protectionMode === "ask";
  allowSensitiveToggle.disabled = !askMode;
  sensitiveRow.classList.toggle("is-disabled", !askMode);

  // Explanatory helper text — reflects the current selection.
  modeHelp.textContent = MODE_HELP[settings.protectionMode];
  renderPolicyHelp(settings.policyName);
  // The override only matters in Ask mode; say so when it's inert.
  sensitiveHelp.textContent = askMode
    ? SENSITIVE_HELP_ASK
    : SENSITIVE_HELP_DISABLED;
}

// Render the policy helper as a bold "detects" lead followed by the trade-off
// detail, so the differences between policies are scannable at a glance. Built
// with DOM nodes (not innerHTML) — copy is static but we keep the XSS-safe
// habit consistent with the rest of the UI.
function renderPolicyHelp(policyName: PolicyName): void {
  const info = POLICY_INFO[policyName];
  policyHelp.replaceChildren();
  if (!info) return;

  const lead = document.createElement("strong");
  lead.textContent = info.detects;
  policyHelp.append(lead, document.createTextNode(` ${info.help}`));
}

async function refreshEngineStatus(settings: ExtensionSettings): Promise<void> {
  engineStatus.textContent = "Checking engine";
  engineDot.classList.remove("is-online", "is-offline");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const response = await fetch(healthEndpointFor(settings), {
      signal: controller.signal,
    });
    engineStatus.textContent = response.ok ? "Engine online" : "Engine error";
    engineDot.classList.toggle("is-online", response.ok);
    engineDot.classList.toggle("is-offline", !response.ok);
  } catch {
    engineStatus.textContent = "Engine offline";
    engineDot.classList.add("is-offline");
  } finally {
    clearTimeout(timer);
  }
}

function renderLastScan(scan: LastScan | null): void {
  if (!scan) return;

  const action = scan.action === "block" ? "Blocked" : "Allowed";
  const when = formatTime(scan.at);
  const risk = typeof scan.riskScore === "number" ? `${Math.round(scan.riskScore * 100)}%` : "";
  const reason = friendlyReason(scan);

  lastScan.replaceChildren();

  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${action} on ${scan.site}`;
  const detail = document.createElement("span");
  detail.textContent = [scan.policyName, scan.decision, risk, when]
    .filter(Boolean)
    .join(" - ");
  text.append(title, detail);

  const pill = document.createElement("span");
  pill.className = `pill is-${scan.action}`;
  pill.textContent = reason;
  // The pill truncates; expose the full reason on hover so detail isn't lost.
  pill.title = reason;

  lastScan.append(text, pill);
}

/**
 * Human-readable summary for the last-scan pill.
 *
 * Raw error codes ("AbortError: signal is aborted without reason",
 * "relay-error", "fail-open") are meaningless to users and get truncated to
 * noise. Map the known failure modes to short, plain phrases; otherwise prefer
 * the engine's own `reason` text, then fall back to the protection mode.
 */
function friendlyReason(scan: LastScan): string {
  const err = scan.error?.trim();
  if (err) {
    // Engine unreachable: aborts (timeout), network failures, relay failures.
    if (/abort|networkerror|failed to fetch|relay-error|fail-open/i.test(err)) {
      return "Engine unreachable — allowed without scan";
    }
    if (/site-disabled/i.test(err)) return "Protection off for this site";
    // Unknown error: show a trimmed, single-line version rather than a code.
    const firstLine = err.split("\n")[0];
    return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  }
  return scan.reason || scan.mode;
}

function setSaved(message: string): void {
  saved.textContent = message;
  window.setTimeout(() => {
    if (saved.textContent === message) saved.textContent = "";
  }, 1200);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
}

function isProtectionMode(value: unknown): value is ProtectionMode {
  return value === "strict" || value === "ask" || value === "observe";
}
