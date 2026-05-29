export const SCAN_ENDPOINT =
  (import.meta.env.WXT_SCAN_ENDPOINT as string | undefined) ??
  "http://localhost:8000/v1/scan";

export const SCAN_TIMEOUT_MS = 5000;

export const USER_DECISION_TIMEOUT_MS = 60000;

export const VERDICT_WAIT_TIMEOUT_MS =
  SCAN_TIMEOUT_MS + USER_DECISION_TIMEOUT_MS + 2000;

export const MAIN_SOURCE = "aiprot-main" as const;
export const ISOLATED_SOURCE = "aiprot-isolated" as const;

export type Decision = "ALLOW" | "BLOCK" | "MODIFY" | "ERROR";
export type ScanAction = "allow" | "block";

export type Verdict = {
  decision: Decision | string;
  blocked_reason?: string | null;
  risk_score?: number;
  risk_flags?: Record<string, unknown>;
  intent?: string;
  scanner_results?: unknown;
  error?: string;
};

export type ScanReply = {
  verdict: Verdict;
  action: ScanAction;
};
