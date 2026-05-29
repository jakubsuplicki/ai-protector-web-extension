#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_URL="${AI_PROTECTOR_ENGINE_URL:-http://localhost:8000}"
SCAN_URL="${AI_PROTECTOR_SCAN_URL:-$ENGINE_URL/v1/scan}"

ERRORS=0
WARNINGS=0

ok() {
  printf 'ok    %s\n' "$1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'warn  %s\n' "$1"
}

fail() {
  ERRORS=$((ERRORS + 1))
  printf 'fail  %s\n' "$1"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

check_docker() {
  if ! have docker; then
    fail "Docker CLI is not installed"
    return
  fi
  ok "Docker CLI found"

  if ! docker compose version >/dev/null 2>&1; then
    fail "docker compose is not available"
    return
  fi
  ok "docker compose found"

  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon is not running"
    return
  fi
  ok "Docker daemon is running"
}

check_engine_files() {
  if [ -f "$ROOT/engine/infra/docker-compose.yml" ]; then
    ok "engine/infra/docker-compose.yml found"
  else
    fail "engine/infra/docker-compose.yml is missing"
  fi

  if [ -f "$ROOT/engine/Makefile" ]; then
    ok "engine/Makefile found"
  else
    fail "engine/Makefile is missing"
  fi
}

check_engine_health() {
  if ! have curl; then
    warn "curl is not installed; skipping engine HTTP checks"
    return
  fi

  health_body="$(mktemp)"
  if curl -fsS "$ENGINE_URL/health" -o "$health_body" >/dev/null 2>&1; then
    if grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$health_body"; then
      ok "engine health is ok at $ENGINE_URL/health"
    else
      warn "engine answered /health but did not report status=ok"
    fi
  else
    warn "engine is not reachable at $ENGINE_URL; run 'cd engine && make self-hosted'"
    rm -f "$health_body"
    return
  fi
  rm -f "$health_body"

  scan_body="$(mktemp)"
  scan_code="$(
    curl -sS -o "$scan_body" -w '%{http_code}' \
      -H 'content-type: application/json' \
      -H 'x-policy: dlp' \
      -d '{"model":"local-scan","messages":[{"role":"user","content":"my test card is 4532-1234-5678-9010"}]}' \
      "$SCAN_URL" 2>/dev/null || true
  )"

  if [ "$scan_code" = "200" ] || [ "$scan_code" = "403" ]; then
    if grep -Eq '"decision"[[:space:]]*:' "$scan_body"; then
      ok "scan endpoint responded with a decision at $SCAN_URL"
    else
      warn "scan endpoint returned HTTP $scan_code but no decision field"
    fi
  else
    warn "scan endpoint did not respond as expected; HTTP ${scan_code:-none}"
  fi
  rm -f "$scan_body"
}

check_extension() {
  if [ ! -f "$ROOT/extension/package.json" ]; then
    warn "extension/package.json is missing"
    return
  fi
  ok "extension/package.json found"

  if have bun; then
    ok "Bun found"
  else
    warn "Bun is not installed; install it before running the extension"
  fi

  check_node

  if [ -d "$ROOT/extension/node_modules" ]; then
    ok "extension dependencies are installed"
  else
    warn "extension dependencies are not installed; run 'cd extension && bun install'"
  fi
}

node_major() {
  "$1" -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
}

check_node() {
  if have node; then
    major="$(node_major node)"
    if [ -n "$major" ] && [ "$major" -ge 22 ] 2>/dev/null; then
      ok "Node.js 22+ found"
      return
    fi
  fi

  if [ -n "${AI_PROTECTOR_NODE:-}" ] && [ -x "$AI_PROTECTOR_NODE" ]; then
    major="$(node_major "$AI_PROTECTOR_NODE")"
    if [ -n "$major" ] && [ "$major" -ge 22 ] 2>/dev/null; then
      ok "Node.js 22+ found via AI_PROTECTOR_NODE"
      return
    fi
  fi

  for candidate in "$HOME"/.nvm/versions/node/v*/bin/node; do
    [ -x "$candidate" ] || continue
    major="$(node_major "$candidate")"
    if [ -n "$major" ] && [ "$major" -ge 22 ] 2>/dev/null; then
      ok "Node.js 22+ found via nvm"
      return
    fi
  done

  if have node; then
    major="$(node_major node)"
    warn "Node.js 22+ is required to build the extension (current node is v${major:-unknown})"
  else
    warn "Node.js 22+ is required to build the extension"
  fi
}

check_browser_hint() {
  case "$(uname -s)" in
    Darwin)
      if open -Ra "Google Chrome" >/dev/null 2>&1 || \
        open -Ra "Brave Browser" >/dev/null 2>&1 || \
        open -Ra "Microsoft Edge" >/dev/null 2>&1; then
        ok "Chromium browser found"
      else
        warn "Chrome, Brave, or Edge was not found"
      fi
      ;;
    Linux)
      if have google-chrome || have google-chrome-stable || have chromium || have chromium-browser || \
        have brave-browser || have brave || have microsoft-edge || have microsoft-edge-stable; then
        ok "Chromium browser found"
      else
        warn "Chromium browser not found in PATH"
      fi
      ;;
    *)
      warn "browser detection skipped for this OS"
      ;;
  esac
}

printf 'AI Protector self-hosted readiness check\n'
printf 'Engine URL: %s\n\n' "$ENGINE_URL"

check_docker
check_engine_files
check_engine_health
check_extension
check_browser_hint

printf '\n'
if [ "$ERRORS" -gt 0 ]; then
  printf 'Result: %s error(s), %s warning(s)\n' "$ERRORS" "$WARNINGS"
  exit 1
fi

printf 'Result: ready with %s warning(s)\n' "$WARNINGS"
printf '\nNext steps:\n'
printf '  1. From the repo root, run one command:\n'
printf '     bun run setup:brave    # or setup:chrome / setup:edge / setup\n'
printf '  2. In the extensions page, enable Developer mode and Load unpacked\n'
printf '  3. Select extension/dist/chrome-mv3, then test ChatGPT or Claude\n'
