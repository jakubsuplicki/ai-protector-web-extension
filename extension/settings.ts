import { SCAN_ENDPOINT, type ScanAction } from "./config";

export const POLICY_OPTIONS = [
  "dlp",
  "balanced",
  "strict",
  "fast",
  "paranoid",
] as const;

export const PROTECTION_MODES = ["strict", "ask", "observe"] as const;
export const SITES = ["chatgpt", "claude"] as const;

export type PolicyName = (typeof POLICY_OPTIONS)[number];
export type ProtectionMode = (typeof PROTECTION_MODES)[number];
export type SiteId = (typeof SITES)[number];

export type ExtensionSettings = {
  protectionMode: ProtectionMode;
  policyName: PolicyName;
  engineUrl: string;
  enabledSites: Record<SiteId, boolean>;
  allowSensitiveOverride: boolean;
};

export type SettingsPatch = Partial<Omit<ExtensionSettings, "enabledSites">> & {
  enabledSites?: Partial<Record<SiteId, boolean>>;
};

export type LastScan = {
  at: string;
  site: SiteId;
  decision: string;
  action: ScanAction;
  mode: ProtectionMode;
  policyName: PolicyName;
  riskScore?: number;
  reason?: string | null;
  sensitive?: boolean;
  error?: string;
};

const SETTINGS_KEY = "aiprot.settings";
const LAST_SCAN_KEY = "aiprot.lastScan";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  protectionMode: "strict",
  policyName: "dlp",
  engineUrl: endpointToEngineUrl(SCAN_ENDPOINT),
  enabledSites: {
    chatgpt: true,
    claude: true,
  },
  allowSensitiveOverride: false,
};

export async function readSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(
  patch: SettingsPatch,
): Promise<ExtensionSettings> {
  const current = await readSettings();
  const next = normalizeSettings({
    ...current,
    ...patch,
    enabledSites: {
      ...current.enabledSites,
      ...(patch.enabledSites ?? {}),
    },
  });
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings(): Promise<ExtensionSettings> {
  await browser.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

export async function readLastScan(): Promise<LastScan | null> {
  const result = await browser.storage.local.get(LAST_SCAN_KEY);
  return normalizeLastScan(result[LAST_SCAN_KEY]);
}

export async function writeLastScan(scan: LastScan): Promise<void> {
  await browser.storage.local.set({ [LAST_SCAN_KEY]: scan });
}

export function scanEndpointFor(settings: ExtensionSettings): string {
  return `${normalizeEngineUrl(settings.engineUrl)}/v1/scan`;
}

export function healthEndpointFor(settings: ExtensionSettings): string {
  return `${normalizeEngineUrl(settings.engineUrl)}/health`;
}

export function normalizeEngineUrl(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.engineUrl;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_SETTINGS.engineUrl;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return withScheme
    .replace(/\/+$/, "")
    .replace(/\/v1\/scan$/i, "")
    .replace(/\/health$/i, "");
}

function normalizeSettings(raw: unknown): ExtensionSettings {
  const source = isRecord(raw) ? raw : {};
  const rawSites = isRecord(source.enabledSites) ? source.enabledSites : {};

  return {
    protectionMode: isProtectionMode(source.protectionMode)
      ? source.protectionMode
      : DEFAULT_SETTINGS.protectionMode,
    policyName: isPolicyName(source.policyName)
      ? source.policyName
      : DEFAULT_SETTINGS.policyName,
    engineUrl: normalizeEngineUrl(source.engineUrl),
    enabledSites: {
      chatgpt:
        typeof rawSites.chatgpt === "boolean"
          ? rawSites.chatgpt
          : DEFAULT_SETTINGS.enabledSites.chatgpt,
      claude:
        typeof rawSites.claude === "boolean"
          ? rawSites.claude
          : DEFAULT_SETTINGS.enabledSites.claude,
    },
    allowSensitiveOverride:
      typeof source.allowSensitiveOverride === "boolean"
        ? source.allowSensitiveOverride
        : DEFAULT_SETTINGS.allowSensitiveOverride,
  };
}

function normalizeLastScan(raw: unknown): LastScan | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.at !== "string" ||
    !isSiteId(raw.site) ||
    typeof raw.decision !== "string" ||
    !isScanAction(raw.action) ||
    !isProtectionMode(raw.mode) ||
    !isPolicyName(raw.policyName)
  ) {
    return null;
  }

  return {
    at: raw.at,
    site: raw.site,
    decision: raw.decision,
    action: raw.action,
    mode: raw.mode,
    policyName: raw.policyName,
    riskScore: typeof raw.riskScore === "number" ? raw.riskScore : undefined,
    reason: typeof raw.reason === "string" || raw.reason === null ? raw.reason : undefined,
    sensitive: typeof raw.sensitive === "boolean" ? raw.sensitive : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

function endpointToEngineUrl(endpoint: string): string {
  return endpoint.replace(/\/v1\/scan$/i, "").replace(/\/+$/, "");
}

function isProtectionMode(value: unknown): value is ProtectionMode {
  return PROTECTION_MODES.includes(value as ProtectionMode);
}

function isPolicyName(value: unknown): value is PolicyName {
  return POLICY_OPTIONS.includes(value as PolicyName);
}

function isSiteId(value: unknown): value is SiteId {
  return SITES.includes(value as SiteId);
}

function isScanAction(value: unknown): value is ScanAction {
  return value === "allow" || value === "block";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
