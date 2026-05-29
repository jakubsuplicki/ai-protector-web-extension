# AI Protector Self-Hosted

Self-hosted prompt protection for browser-based AI tools.

This repository packages the AI Protector engine with a browser extension that
can inspect prompts before they are sent to ChatGPT or Claude. The public shape
is intentionally local-first: run the scan engine yourself, load the extension
unpacked, and point it at your own endpoint.

No account or hosted service is required. A hosted deployment can be layered on
later, but the public fork works as a free local setup.

## Status

Experimental public fork. The engine is mature enough to run locally. The
browser extension is a proof of concept for ChatGPT and Claude interception,
warning UI, and local scan calls. Treat it as a developer preview, not a
packaged store release.

## Quickstart

Requirements:

- Docker Desktop or Docker Engine with Compose
- Bun
- Node.js 22+ for the extension build
- Brave, Chrome, or Edge

One command starts the self-hosted engine and opens the extension in Brave:

```bash
bun run setup:brave
```

Other launch options:

```bash
bun run setup          # Auto-detect Brave, Chrome, or Edge
bun run setup:chrome   # Google Chrome
bun run setup:edge     # Microsoft Edge
```

When your browser opens its extensions page, enable Developer mode, click Load
unpacked, and select `extension/dist/chrome-mv3`.

Open ChatGPT or Claude in that normal browser profile and test with a
deliberately fake sensitive value, such as:

```text
my test credit card is 4532-1234-5678-9010
```

The extension calls `http://localhost:8000/v1/scan` by default. Override it at
build time with `WXT_SCAN_ENDPOINT` if your engine runs elsewhere. After the
extension is loaded, the toolbar popup can also change the local engine URL.

The toolbar popup controls:

- protection mode: `Strict`, `Ask`, or `Observe`
- policy: `dlp`, `balanced`, `strict`, `fast`, or `paranoid`
- enabled sites: ChatGPT and Claude
- PII/secrets override for `Ask` mode

PII and secret findings stay hard-blocked in `Ask` mode unless the override is
explicitly enabled.

If your browser is installed somewhere custom, set `CHROME_PATH` before the
command. The launcher checks common macOS, Windows, and Linux install paths.
If Node 22+ is installed outside your `PATH`, set `AI_PROTECTOR_NODE`.

After the extension is installed, start only the local engine with:

```bash
bun run engine
```

Check local readiness:

```bash
scripts/check-self-hosted.sh
```

## What Runs Locally

`make self-hosted` starts:

- PostgreSQL for policies and request logs
- Redis for policy-cache lookups
- the self-hosted FastAPI engine on `http://localhost:8000`

The engine runs `src.main_self_hosted:app` with `DEFAULT_POLICY=dlp`.
Scan-only requests return `ALLOW`, `BLOCK`, or `MODIFY` without forwarding
the prompt to an LLM provider. Extension policy selection is sent with the
`x-policy` header.

## Smoke Test

```bash
curl -i http://localhost:8000/v1/scan \
  -H 'content-type: application/json' \
  -H 'x-policy: dlp' \
  -d '{
    "model": "local-scan",
    "messages": [
      {"role": "user", "content": "my test card is 4532-1234-5678-9010"}
    ]
  }'
```

## Checks

```bash
cd engine/apps/proxy-service
uv run --extra dev ruff check src tests

cd ../../../extension
bun run compile
bun test
```

DB-backed engine tests require PostgreSQL on `localhost:5432`.

## Repository Layout

- `engine/` - self-hosted AI Protector scan engine and demo stack
- `extension/` - WXT browser extension for prompt interception and warning UI
- `scripts/check-self-hosted.sh` - local readiness checker
- `scripts/self-hosted-dev.mjs` - one-command engine + extension launcher
- `engine/docs/SELF_HOSTED.md` - self-hosted workflow details
- `UPSTREAM.md` - upstream credit and fork notes
- `NOTICE` - attribution notice

## Upstream Credit

This project is derived from AI Protector by Lukasz / Szesnasty.

Upstream: https://github.com/Szesnasty/ai-protector

Base reference: v0.2.5

See `UPSTREAM.md` and `NOTICE` for attribution details.

## License

Apache-2.0. See `LICENSE`.
