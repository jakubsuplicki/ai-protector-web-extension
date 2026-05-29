# AI Protector Web Extension

Self-hosted prompt protection for browser-based AI tools.

AI Protector Web Extension runs a local scan engine and a Chromium browser
extension together. The extension intercepts prompts before they leave ChatGPT
or Claude, asks the local engine for a verdict, and can block sensitive data,
secrets, and risky prompt content before it is sent.

No account, hosted service, or API key is required for scan-only protection.

## Status

Experimental public fork. The local engine is usable today, and the browser
extension works as an unpacked developer extension for Brave, Chrome, and Edge.
It is not packaged for browser-store distribution yet.

## What You Get

- Local prompt scanning at `http://localhost:8000/v1/scan`
- ChatGPT and Claude interception in a normal browser profile
- Strict, Ask, and Observe protection modes
- Policy switching from the extension popup
- A visible unpacked extension folder at `extension/dist/chrome-mv3`
- One-command setup for the engine and extension build

## Quickstart

Requirements:

- Docker Desktop or Docker Engine with Compose
- Bun
- Node.js 22+ for the extension build
- Brave, Chrome, or Edge

One command starts the engine, builds the extension, and opens your browser's
extensions page:

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

That manual browser step is required once. Browsers do not allow a local tool to
silently install an unpacked extension into a normal personal profile.

Open ChatGPT or Claude in that same browser profile and test with a deliberately
fake sensitive value:

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

After the extension is installed, future sessions usually only need the local
engine:

```bash
bun run engine
```

Check local readiness:

```bash
scripts/check-self-hosted.sh
```

## Daily Use

1. Start Docker Desktop if it is not already running.
2. Run `bun run engine` from this repo.
3. Open ChatGPT or Claude in the browser profile where the extension is loaded.
4. Use the extension popup to switch mode, policy, sites, or engine URL.

If you rebuild the extension after code changes, go to your browser extensions
page and click the extension card's Reload button. You do not need to remove and
load it again unless the folder path changes.

## What Runs Locally

`make self-hosted` starts:

- PostgreSQL for policies and request logs
- Redis for policy-cache lookups
- the self-hosted FastAPI engine on `http://localhost:8000`

The engine runs `src.main_self_hosted:app` with `DEFAULT_POLICY=dlp`.
Scan-only requests return `ALLOW`, `BLOCK`, or `MODIFY` without forwarding
the prompt to an LLM provider. Extension policy selection is sent with the
`x-policy` header.

## Troubleshooting

If the extension popup says the engine is offline:

```bash
bun run doctor
```

Common fixes:

- Start Docker Desktop, then rerun `bun run engine`.
- Make sure nothing else is using port `8000`.
- Reload the unpacked extension after rebuilding it.
- Use Node.js 22+ for extension builds. The setup script tries to find Node 22+
  automatically, but `AI_PROTECTOR_NODE=/path/to/node` can override it.

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
scripts/check-self-hosted.sh

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
- `CONTRIBUTING.md` - contribution guide
- `SECURITY.md` - vulnerability reporting
- `UPSTREAM.md` - upstream credit and fork notes
- `NOTICE` - attribution notice

## Upstream Credit

This project is derived from AI Protector by Lukasz / Szesnasty.

Upstream: https://github.com/Szesnasty/ai-protector

Base reference: v0.2.5

See `UPSTREAM.md` and `NOTICE` for attribution details.

## License

Apache-2.0. See `LICENSE`.
