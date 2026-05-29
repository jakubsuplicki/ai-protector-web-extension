# AI Protector Engine

Self-hosted prompt scanning and LLM firewall engine for the browser-extension
workflow.

In the public fork, this engine is the local backend for the browser extension.
It exposes `POST /v1/scan`, stores local request logs, and evaluates prompts
against seeded policies such as `dlp`, `balanced`, `strict`, and `paranoid`.
No account or hosted service is required.

## Quickstart

Start the self-hosted engine:

```bash
make self-hosted
```

The API listens on `http://localhost:8000`.

Check local readiness:

```bash
make doctor
```

Send a scan request:

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

The endpoint returns a verdict without forwarding the prompt to an LLM provider.

## Self-Hosted Runtime

`make self-hosted` starts the slim engine profile from `infra/docker-compose.yml`:

- PostgreSQL for policies and request logs
- Redis for policy-cache lookups
- `proxy-service-self-hosted` on port `8000`
- `APP_ENTRY=src.main_self_hosted:app`
- `DEFAULT_POLICY=dlp`

The self-hosted entrypoint registers only the core tables:

- `policies`
- `denylist_phrases`
- `requests`

It leaves out the demo UI, agent wizard, red-team benchmark UI, and hosted
administration surfaces.

This keeps the public path useful as a free local tool today. A cloud-hosted
deployment can be added later without making the local workflow depend on it.

## Browser Extension Pairing

The extension calls:

```text
POST http://localhost:8000/v1/scan
```

From the repository root, start the engine and extension together:

```bash
bun run setup:brave
```

Use `bun run setup:chrome`, `bun run setup:edge`, or `bun run setup` for other
Chromium-family browsers. The launcher checks common macOS, Windows, and Linux
browser locations, builds the unpacked extension, and opens the browser's
extensions page. Enable Developer mode, click Load unpacked, and select
`extension/dist/chrome-mv3`. The extension build requires Node.js 22+; set
`AI_PROTECTOR_NODE` if Node 22+ is installed outside your `PATH`.

After the extension is installed in your normal browser profile, you usually
only need to start the engine:

```bash
bun run engine
```

Open ChatGPT or Claude in the launched browser and submit a fake sensitive
value to see the warning UI.

The extension toolbar popup controls local behavior: `Strict`, `Ask`, or
`Observe` mode; seeded policy selection; enabled sites; and the local engine
URL. Policy selection is sent to the engine as the `x-policy` header.

Reload the unpacked extension from the browser extensions page after rebuilding
it. You do not need to remove and load it again unless the folder path changes.

## API Shape

### `POST /v1/scan`

Accepts an OpenAI-compatible chat-completions request body:

```json
{
  "model": "local-scan",
  "messages": [
    {"role": "user", "content": "hello"}
  ]
}
```

Useful headers:

| Header | Purpose |
|--------|---------|
| `x-policy` | Policy name. Defaults to `DEFAULT_POLICY`, usually `dlp`. |
| `x-client-id` | Optional local client label for request logs. |
| `x-correlation-id` | Optional trace/correlation id. |
| `x-api-key` | Provider key used only by full chat/proxy paths, not needed for scan-only use. |

Response fields:

| Field | Meaning |
|-------|---------|
| `decision` | `ALLOW`, `BLOCK`, or `MODIFY`. |
| `risk_score` | Aggregated score from rules, intent, and scanners. |
| `risk_flags` | Compact flags for detected risks. |
| `intent` | Classified intent, when available. |
| `blocked_reason` | Human-readable reason for block decisions. |
| `scanner_results` | Detailed scanner output for UI/debugging. |

## Policies

Seeded policies:

| Policy | Purpose |
|--------|---------|
| `fast` | Minimal checks for trusted local testing. |
| `balanced` | General-purpose firewall policy. |
| `strict` | Adds stronger PII handling and lower thresholds. |
| `dlp` | Default browser-extension policy; blocks PII and common secret patterns. |
| `paranoid` | Lowest thresholds and broadest scanner set. |

Built-in policies are read-only through the policy API. Create a custom policy
if you want to experiment with thresholds or scanner nodes.

## Full Demo Stack

The original demo stack is still available for contributors who want the
dashboard, agent demos, benchmark UI, and comparison playground:

```bash
make demo
```

Open `http://localhost:3000`.

The demo stack uses `src.main:app`; the self-hosted browser-extension path uses
`src.main_self_hosted:app`.

## Development

Common commands:

```bash
make self-hosted
make doctor
make demo
make down
make reset
```

Run focused Python checks from `apps/proxy-service`:

```bash
uv run --extra dev ruff check src tests
uv run --extra dev pytest tests -q
```

The DB-backed tests require PostgreSQL on `localhost:5432`. The Docker profile
is the easiest way to provide it.

## Troubleshooting

From the repository root:

```bash
bun run doctor
```

Check Docker Desktop, port `8000`, Node.js 22+, and whether the browser
extension was reloaded after rebuilds.

## More Docs

- [Self-hosted workflow](docs/SELF_HOSTED.md)
- [Proxy firewall pipeline](docs/architecture/PROXY_FIREWALL_PIPELINE.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Threat model](docs/architecture/THREAT_MODEL.md)
- [Contributing](CONTRIBUTING.md)
