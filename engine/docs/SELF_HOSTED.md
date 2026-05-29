# Self-Hosted Browser Extension Workflow

This document describes the public fork's primary runtime: a local scan engine
paired with a browser extension.

No account or hosted service is required. The local path is the product surface
for this public fork; hosted/cloud deployments can be separate options later.

## Runtime Shape

```text
ChatGPT / Claude page
        |
        v
Browser extension fetch wrapper
        |
        v
POST http://localhost:8000/v1/scan
        |
        v
AI Protector self-hosted engine
        |
        v
ALLOW / BLOCK / MODIFY verdict
```

The self-hosted engine evaluates the prompt and returns a verdict. It does not
forward scan-only requests to an LLM provider.

## Start The Engine

```bash
cd engine
make self-hosted
```

Check local readiness:

```bash
make doctor
```

The Docker profile starts:

- `db`
- `redis`
- `proxy-service-self-hosted`

The service runs:

```text
APP_ENTRY=src.main_self_hosted:app
APP_MODE=self-hosted
DEFAULT_POLICY=dlp
```

## Start The Extension

From the repository root, use the one-command local workflow:

```bash
bun run setup:brave
```

Other Chromium launch options:

```bash
bun run setup          # Auto-detect Brave, Chrome, or Edge
bun run setup:chrome   # Google Chrome
bun run setup:edge     # Microsoft Edge
```

The launcher starts the Docker engine, waits for `/health`, installs extension
dependencies if needed, builds the unpacked extension, and opens your browser's
extensions page. Enable Developer mode, click Load unpacked, and select
`extension/dist/chrome-mv3`. If your browser is installed in a custom
location, set `CHROME_PATH`. The extension build requires Node.js 22+; set
`AI_PROTECTOR_NODE` if Node 22+ is installed outside your `PATH`.

After the extension is installed in your normal browser profile, start only the
engine with:

```bash
bun run engine
```

Reload the unpacked extension from the browser extensions page after rebuilding
it. You only need to remove and load it again if the folder path changes.

Open ChatGPT or Claude in the launched browser. The extension calls the engine
at `http://localhost:8000/v1/scan` by default.

The toolbar popup controls the local runtime settings:

- `Strict` blocks `BLOCK` verdicts immediately.
- `Ask` pauses the outgoing prompt and shows `Cancel` / `Send anyway` where
  user choice is allowed.
- `Observe` allows prompts through while still surfacing warnings.
- Policy selection sends the chosen policy in the `x-policy` header.
- The engine URL defaults to `http://localhost:8000`.

PII and secret findings stay hard-blocked in `Ask` mode unless the local
PII/secrets override is explicitly enabled in the popup.

## Self-Hosted Entry Point

`src.main_self_hosted:app` includes:

- `GET /health`
- `POST /v1/scan`
- `GET /v1/policies`
- policy CRUD for custom policies
- request-log and analytics endpoints
- rules endpoints

It leaves out the full demo UI, agent wizard routers, red-team benchmark UI,
chat proxy/model catalog routes, and hosted administration concerns.

## Data Model

In self-hosted mode, model registration is limited to:

- `policies`
- `denylist_phrases`
- `requests`

The public fork keeps the local data model intentionally small.

## Default Policy

The browser-extension path defaults to `dlp`.

`dlp` blocks common PII and secret patterns before the prompt reaches the target
AI tool. It is seeded as a built-in policy and is read-only through the policy
API. Create a custom policy for local experiments.

The extension popup can switch between the seeded policies without rebuilding
the extension: `dlp`, `balanced`, `strict`, `fast`, and `paranoid`.

## Smoke Test

After `make self-hosted`, run:

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

Expected result:

- HTTP `403` for `BLOCK`, or HTTP `200` for `ALLOW` / `MODIFY`
- `x-decision` response header
- JSON body containing `decision`, `risk_score`, `risk_flags`, and
  `scanner_results`

## Verification

Readiness check:

```bash
cd engine
make doctor
```

Engine checks:

```bash
cd engine/apps/proxy-service
uv run --extra dev ruff check src tests
uv run --extra dev pytest tests -q
```

Extension checks:

```bash
cd extension
bun run compile
bun test
```

The DB-backed engine tests need PostgreSQL on `localhost:5432`.

## Troubleshooting

Run the readiness check from the repo root:

```bash
bun run doctor
```

Common issues:

- Docker Desktop is not running.
- Port `8000` is already in use.
- The extension was rebuilt but not reloaded in the browser.
- Node.js 22+ is missing for extension builds.
