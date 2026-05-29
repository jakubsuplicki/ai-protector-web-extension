import { USER_DECISION_TIMEOUT_MS, type Verdict } from "../config";

const WARNING_ID = "aiprot-warning";

// Module-level reference for robust removal (doesn't depend on DOM lookup)
let currentHost: HTMLElement | null = null;
let currentResolve: ((choice: WarningChoice) => void) | null = null;

export type WarningMode = "strict" | "ask" | "observe";
export type WarningChoice = "dismiss" | "allow" | "block";

export type RenderWarningOptions = {
  mode?: WarningMode;
  sensitive?: boolean;
  timeoutMs?: number;
};

const ENTITY_LABELS: Record<string, string> = {
  US_SSN: "Social Security Number",
  EMAIL_ADDRESS: "Email address",
  PHONE_NUMBER: "Phone number",
  CREDIT_CARD: "Credit card number",
  PERSON: "Person name",
  IP_ADDRESS: "IP address",
  IBAN_CODE: "IBAN",
  LOCATION: "Location",
  DATE_TIME: "Date/time",
  NRP: "Nationality/religion/political group",
  SECRET: "Secret",
  API_KEY: "API key",
  PASSWORD: "Password",
};

// Entity types that should never show any part of their value — high-entropy
// secrets or credentials where even a few visible chars meaningfully reduce
// brute-force search space.
const NEVER_REVEAL = new Set([
  "SECRET",
  "API_KEY",
  "PASSWORD",
  "CRYPTO",
  "ACCESS_TOKEN",
]);

type PresidioEntity = {
  entity_type: string;
  score: number;
  start: number;
  end: number;
};

/**
 * Mask a detected entity value for display.
 *
 * Strategy: show at most 4 characters. Secrets/API keys show none.
 * For PII we show a short suffix so the user can recognize *which* of their
 * values was detected without leaking the sensitive portion.
 *
 * Examples:
 *   "123-45-6789"  (SSN)            → "*******6789"
 *   "4532123456789010" (CC)         → "************9010"
 *   "sk_live_abc123def456..." (key) → "***" (never reveals any chars)
 *   "hi" (too short)                → "***"
 */
export function maskValue(raw: string, entityType: string): string {
  if (NEVER_REVEAL.has(entityType)) return "***";

  // Use code-point iteration for Unicode safety (avoids bisecting surrogate
  // pairs on emoji / non-BMP characters in PERSON / LOCATION entities).
  const chars = Array.from(raw);
  if (chars.length <= 3) return "***";

  // Cap at 4 visible chars. Never show more than 25% of the value.
  const visible = Math.min(4, Math.floor(chars.length / 4));
  if (visible <= 0) return "***";

  const maskedLen = chars.length - visible;
  return "*".repeat(maskedLen) + chars.slice(-visible).join("");
}

/**
 * Type-guard / validator for a single Presidio entity. Rejects malformed
 * entries so we fail closed rather than rendering "NaN" or "undefined".
 */
function isValidEntity(x: unknown): x is PresidioEntity {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.entity_type === "string" &&
    typeof e.start === "number" &&
    Number.isFinite(e.start) &&
    typeof e.end === "number" &&
    Number.isFinite(e.end) &&
    typeof e.score === "number"
  );
}

function extractEntities(
  verdict: Verdict,
  prompt: string,
): { label: string; masked: string }[] {
  const results: { label: string; masked: string }[] = [];
  const scannerResults = verdict.scanner_results as Record<string, unknown> | undefined;
  const presidio = scannerResults?.presidio as
    | { entities?: unknown }
    | undefined;
  const rawEntities = Array.isArray(presidio?.entities) ? presidio.entities : [];

  if (rawEntities.length === 0) {
    // Fall back to risk_flags.pii when detailed scanner results aren't present
    const riskFlags = verdict.risk_flags as Record<string, unknown> | undefined;
    const piiFlags = riskFlags?.pii;
    if (Array.isArray(piiFlags)) {
      for (const type of piiFlags) {
        const typeStr = String(type);
        results.push({
          label: ENTITY_LABELS[typeStr] ?? typeStr,
          masked: "",
        });
      }
    }
    return results;
  }

  for (const raw of rawEntities) {
    if (!isValidEntity(raw)) continue;

    // Clamp offsets: slice() silently clamps but start > end returns "", and
    // out-of-range values indicate corrupt verdict data we shouldn't surface.
    const safeStart = Math.max(0, Math.min(raw.start, prompt.length));
    const safeEnd = Math.max(safeStart, Math.min(raw.end, prompt.length));
    const value = prompt.slice(safeStart, safeEnd);
    if (!value) continue;

    results.push({
      label: ENTITY_LABELS[raw.entity_type] ?? raw.entity_type,
      masked: maskValue(value, raw.entity_type),
    });
  }
  return results;
}

// One notification variant per protection mode. `block` (strict): the prompt
// was stopped. `review` (ask): the interactive cancel / send-anyway dialog.
// `observe`: a passive "heads up" notice; the prompt is allowed through.
export type Variant = "block" | "review" | "observe";

const STYLES = `
  :host {
    all: initial;
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    /* Self-isolating: page CSS can't reach in (closed shadow), and these
       defaults guard against page styles leaking through inheritable props. */
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color-scheme: light;
  }

  /* Narrow viewports: span the bottom edge with a small gutter instead of a
     fixed 380px card that can overflow a slim browser window. */
  @media (max-width: 440px) {
    :host {
      left: 12px;
      right: 12px;
      bottom: 12px;
    }
  }

  .toast {
    box-sizing: border-box;
    width: 360px;
    max-width: 100%;
    background: #ffffff;
    color: #1f2937;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, .08);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, .06),
      0 12px 28px -8px rgba(0, 0, 0, .25);
    overflow: hidden;
    animation: toast-in .22s cubic-bezier(.16, 1, .3, 1) both;
    /* A solid backdrop means the toast reads cleanly on dark *and* light
       page backgrounds without inheriting either. */
  }

  @media (max-width: 440px) {
    .toast { width: 100%; }
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(10px) scale(.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Respect users who opt out of motion: no slide/scale, just appear. */
  @media (prefers-reduced-motion: reduce) {
    .toast { animation: none; }
  }

  /* Severity accent: a top rule + tinted header. */
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-top: 3px solid var(--accent);
    background: var(--accent-tint);
  }

  .toast--block   { --accent: #dc2626; --accent-tint: #fef2f2; --accent-strong: #b91c1c; }
  .toast--review  { --accent: #d97706; --accent-tint: #fffbeb; --accent-strong: #b45309; }
  .toast--observe { --accent: #2563eb; --accent-tint: #eff6ff; --accent-strong: #1d4ed8; }

  .icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    color: var(--accent);
  }
  .icon svg { display: block; width: 100%; height: 100%; }

  .title {
    font-size: 14px;
    font-weight: 650;
    line-height: 1.3;
    color: #111827;
    margin: 0;
  }

  .body {
    padding: 12px 16px 4px;
  }

  .reason {
    font-size: 12.5px;
    line-height: 1.45;
    color: #4b5563;
    margin: 0 0 12px;
  }

  .findings-label {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: #6b7280;
    margin: 0 0 6px;
  }

  .entities {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .entity {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 7px;
    background: #f3f4f6;
    line-height: 1.4;
  }

  .entity-type {
    font-weight: 550;
    color: #374151;
  }

  .entity-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    color: #6b7280;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding: 8px 16px 16px;
  }

  .btn {
    border: 1px solid transparent;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1;
    transition: background-color .12s ease, border-color .12s ease;
  }
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Primary = the safe/default action. Filled with the severity accent. */
  .btn--primary {
    background: var(--accent);
    color: #ffffff;
  }
  .btn--primary:hover { background: var(--accent-strong); }

  /* Danger = "Send anyway" / override. Deliberately quieter than primary:
     a ghost button with red text so the safe action stays dominant. */
  .btn--danger {
    background: transparent;
    color: #b91c1c;
    border-color: rgba(185, 28, 28, .35);
  }
  .btn--danger:hover {
    background: rgba(185, 28, 28, .06);
    border-color: rgba(185, 28, 28, .55);
  }

  /* Neutral dismiss for passive notices. */
  .btn--ghost {
    background: transparent;
    color: #4b5563;
    border-color: rgba(0, 0, 0, .15);
  }
  .btn--ghost:hover { background: rgba(0, 0, 0, .04); }

  @media (prefers-reduced-motion: reduce) {
    .btn { transition: none; }
  }
`;

// Inline SVG icons (no emoji — consistent rendering across OSes/fonts).
// currentColor lets each inherit the variant accent set on .icon.
const ICONS: Record<Variant, string> = {
  // block: shield with slash
  block:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="4.5" y1="4.5" x2="19.5" y2="19.5"/></svg>',
  // review: eye (look before you leap)
  review:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  // observe: info circle
  observe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>',
};

export function renderWarning(
  verdict: Verdict,
  prompt: string,
  options: RenderWarningOptions = {},
): Promise<WarningChoice> {
  // Remove existing warning via module ref; fall back to DOM lookup in case the
  // host element was carried over from a previous page-load execution of this
  // script (SPA navigations can re-run content scripts).
  closeCurrentWarning("block");

  const entities = extractEntities(verdict, prompt);
  const mode = options.mode ?? "strict";
  const sensitive = options.sensitive ?? false;
  const variant = variantFor(mode);

  // Host element with shadow DOM for style isolation from the page.
  const host = document.createElement("div");
  host.id = WARNING_ID;
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = STYLES;

  const toast = document.createElement("div");
  toast.className = `toast toast--${variant}`;
  toast.setAttribute("role", mode === "ask" ? "alertdialog" : "status");
  toast.setAttribute("aria-live", mode === "ask" ? "assertive" : "polite");

  // Header: severity icon + title
  const header = document.createElement("div");
  header.className = "header";

  const icon = document.createElement("span");
  icon.className = "icon";
  icon.setAttribute("aria-hidden", "true");
  // ICONS values are static, developer-authored SVG strings (no user data),
  // so innerHTML here carries no injection risk.
  icon.innerHTML = ICONS[variant];

  const title = document.createElement("h2");
  title.className = "title";
  title.textContent = titleFor(variant, sensitive);

  header.append(icon, title);
  toast.append(header);

  // Body: reason + masked findings
  const body = document.createElement("div");
  body.className = "body";

  const reason = document.createElement("p");
  reason.className = "reason";
  reason.textContent = reasonFor(verdict, variant);
  body.append(reason);

  if (entities.length > 0) {
    const findingsLabel = document.createElement("p");
    findingsLabel.className = "findings-label";
    findingsLabel.textContent =
      entities.length === 1 ? "Detected" : `Detected (${entities.length})`;
    body.append(findingsLabel);

    const entityList = document.createElement("ul");
    entityList.className = "entities";
    for (const ent of entities) {
      const li = document.createElement("li");
      li.className = "entity";

      const typeSpan = document.createElement("span");
      typeSpan.className = "entity-type";
      typeSpan.textContent = ent.label;
      li.appendChild(typeSpan);

      if (ent.masked) {
        const valSpan = document.createElement("span");
        valSpan.className = "entity-value";
        valSpan.textContent = ent.masked;
        li.appendChild(valSpan);
      }
      entityList.appendChild(li);
    }
    body.append(entityList);
  }

  toast.append(body);

  // Actions
  const actions = document.createElement("div");
  actions.className = "actions";

  let choicePromise = Promise.resolve<WarningChoice>("dismiss");

  if (mode === "ask") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    choicePromise = new Promise<WarningChoice>((resolve) => {
      const finish = (choice: WarningChoice) => {
        if (timer) clearTimeout(timer);
        if (currentHost === host) currentHost = null;
        if (currentResolve === finish) currentResolve = null;
        host.remove();
        resolve(choice);
      };

      currentResolve = finish;

      // Safe/default action ("Cancel") is the visually dominant primary
      // button. The override ("Send anyway") is a quieter danger-ghost so the
      // protective choice stays the obvious one. Order in the DOM puts the
      // primary last (right-most), matching platform dialog conventions.
      const cancel = createButton("Cancel", "btn--primary");
      cancel.addEventListener("click", () => finish("block"));

      const allow = createButton("Send anyway", "btn--danger");
      allow.addEventListener("click", () => finish("allow"));

      actions.append(allow, cancel);
      timer = setTimeout(
        () => finish("block"),
        options.timeoutMs ?? USER_DECISION_TIMEOUT_MS,
      );
    });
  } else {
    const dismiss = createButton("Dismiss", "btn--ghost");
    dismiss.addEventListener("click", () => {
      host.remove();
      if (currentHost === host) currentHost = null;
    });
    actions.appendChild(dismiss);
  }

  toast.append(actions);

  shadow.append(style, toast);
  (document.body ?? document.documentElement).appendChild(host);
  currentHost = host;
  return choicePromise;
}

function closeCurrentWarning(choice: WarningChoice): void {
  const resolve = currentResolve;
  currentResolve = null;
  if (currentHost) {
    currentHost.remove();
    currentHost = null;
  } else {
    const existing = document.getElementById(WARNING_ID);
    if (existing) existing.remove();
  }
  if (resolve) resolve(choice);
}

function createButton(label: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `btn ${className}`;
  button.textContent = label;
  return button;
}

/**
 * Resolve the visual variant from the protection mode. The mode fully
 * determines the outcome a protective verdict produces:
 *   ask     → review  (interactive cancel / send-anyway dialog)
 *   observe → observe (passive notice; prompt is allowed through)
 *   strict  → block   (prompt was stopped — BLOCK and MODIFY both block here)
 */
export function variantFor(mode: WarningMode): Variant {
  if (mode === "ask") return "review";
  if (mode === "observe") return "observe";
  return "block";
}

/** Short, human title per variant. Avoids jargon and product-name noise. */
export function titleFor(variant: Variant, sensitive: boolean): string {
  switch (variant) {
    case "review":
      return "Review before sending";
    case "observe":
      return "This prompt may expose private data";
    case "block":
      return sensitive
        ? "Sensitive data blocked"
        : "This prompt was blocked";
  }
}

/**
 * One-line plain-language explanation under the title. We prefer the engine's
 * blocked_reason when present (it's the authoritative policy explanation), but
 * fall back to friendly per-variant copy so the toast never reads as empty or
 * over-technical.
 */
export function reasonFor(verdict: Verdict, variant: Variant): string {
  const raw = verdict.blocked_reason?.trim();
  if (raw) return raw;
  switch (variant) {
    case "review":
      return "We found data that may be private. Review it before sending.";
    case "observe":
      return "We noticed potentially private data in this prompt.";
    case "block":
      return "This prompt was blocked to protect private data.";
  }
}
