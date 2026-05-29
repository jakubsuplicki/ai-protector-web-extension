import type { Verdict } from "./config";

const SECRET_ENTITY_TYPES = new Set([
  "SECRET",
  "API_KEY",
  "PASSWORD",
  "CRYPTO",
  "ACCESS_TOKEN",
  "TOKEN",
  "PRIVATE_KEY",
]);

export function isProtectiveDecision(verdict: Verdict): boolean {
  return verdict.decision === "BLOCK" || verdict.decision === "MODIFY";
}

export function hasSensitiveFindings(verdict: Verdict): boolean {
  return hasPiiFlags(verdict) || hasPresidioEntities(verdict) || hasSecretSignal(verdict);
}

function hasPiiFlags(verdict: Verdict): boolean {
  const flags = asRecord(verdict.risk_flags);
  const pii = flags?.pii;
  if (Array.isArray(pii) && pii.length > 0) return true;
  if (typeof flags?.pii_count === "number" && flags.pii_count > 0) return true;
  return false;
}

function hasPresidioEntities(verdict: Verdict): boolean {
  const scanners = asRecord(verdict.scanner_results);
  const presidio = asRecord(scanners?.presidio);
  const entities = presidio?.entities;
  return Array.isArray(entities) && entities.length > 0;
}

function hasSecretSignal(verdict: Verdict): boolean {
  const flags = asRecord(verdict.risk_flags);
  if (truthyRisk(flags?.secrets) || truthyRisk(flags?.secret)) return true;

  const scanners = asRecord(verdict.scanner_results);
  if (!scanners) return false;

  for (const [name, value] of Object.entries(scanners)) {
    const lowerName = name.toLowerCase();
    if (
      (lowerName.includes("secret") ||
        lowerName.includes("credential") ||
        lowerName.includes("token")) &&
      scannerRejected(value)
    ) {
      return true;
    }
    if (containsSecretEntity(value)) return true;
  }
  return false;
}

function truthyRisk(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return value > 0;
  return value === true;
}

function scannerRejected(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  return record.is_valid === false || record.valid === false || record.detected === true;
}

function containsSecretEntity(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretEntity);
  const record = asRecord(value);
  if (!record) return false;

  const entityType = record.entity_type ?? record.type ?? record.label;
  if (typeof entityType === "string" && SECRET_ENTITY_TYPES.has(entityType)) {
    return true;
  }

  return Object.values(record).some(containsSecretEntity);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
