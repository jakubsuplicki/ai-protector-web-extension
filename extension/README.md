# AI Protector Browser Extension

Developer-preview browser extension for self-hosted prompt scanning.

The extension intercepts ChatGPT and Claude prompt submissions, sends the prompt
to a self-hosted AI Protector engine, and renders an in-page warning when the
engine returns `BLOCK` or `MODIFY`. The toolbar popup controls local settings
such as protection mode, policy, enabled sites, and engine URL.

## Requirements

- Bun
- Node.js 22+ for the extension build (pinned in `.nvmrc` / `engines`; run
  `nvm use`). Node 20 fails the WXT/rolldown build — rolldown's CLI calls
  `node:util.styleText` with an array of styles, which only Node 22+ accepts.
- Brave, Chrome, or Edge
- The engine running at `http://localhost:8000`

Start the engine first:

```bash
cd ../engine
make self-hosted
make doctor
```

## Normal Browser Setup

From the repo root, one command starts the self-hosted engine, builds the
unpacked extension, and opens your browser's extensions page:

```bash
bun run setup:brave
```

Browser-specific commands:

```bash
bun run setup          # Auto-detect Brave, Chrome, or Edge
bun run setup:chrome   # Google Chrome
bun run setup:brave    # Brave
bun run setup:edge     # Microsoft Edge
```

These commands assume common browser install locations on macOS, Windows, and
Linux. If your browser lives somewhere custom, set `CHROME_PATH`:

```bash
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" bun run setup:brave
```

If Node 22+ is installed outside your `PATH`, set `AI_PROTECTOR_NODE`:

```bash
AI_PROTECTOR_NODE="$HOME/.nvm/versions/node/v22.22.2/bin/node" bun run setup:brave
```

In the extensions page:

1. Enable Developer mode.
2. Click Load unpacked.
3. Select `extension/dist/chrome-mv3`.

The extension stays installed in that normal browser profile until you remove
it. After the first setup, you usually only need to start the engine:

```bash
bun run engine
```

The extension posts to:

```text
http://localhost:8000/v1/scan
```

Override the default scan endpoint at build/dev time:

```bash
WXT_SCAN_ENDPOINT=http://localhost:8000/v1/scan bun run setup:brave
```

You can also change the local engine URL from the extension popup after the
extension is loaded.

## Popup Settings

The extension popup is the quick local control surface:

| Setting | Options |
|---------|---------|
| Protection mode | `Strict` blocks `BLOCK` verdicts, `Ask` pauses before sending, `Observe` warns but allows. |
| Policy | `dlp`, `balanced`, `strict`, `fast`, or `paranoid`. |
| Engine URL | Defaults to `http://localhost:8000`. |
| Sites | Enable or disable ChatGPT and Claude interception. |
| PII/secrets override | Lets `Ask` mode show `Send anyway` for sensitive findings. Off by default. |

PII and secrets remain hard-blocked in `Ask` mode unless the override is
explicitly enabled.

## Manual Test

1. Run `bun run setup:brave` from the repo root.
2. Load `extension/dist/chrome-mv3` when your browser opens its extensions page.
3. Open the extension popup and confirm the engine is online.
4. In that normal browser, open `https://chatgpt.com` or `https://claude.ai`.
5. Paste a fake sensitive value:

```text
my test credit card is 4532-1234-5678-9010
```

6. Submit the prompt.

You should see an in-page warning box. The service-worker console logs the full
scan verdict.

## What It Does

- Wraps `window.fetch` in the page MAIN world for ChatGPT and Claude.
- Extracts outgoing prompt text from supported request payloads.
- Sends a scan-only request to the local engine.
- Relays the verdict back to the isolated content script.
- Displays a shadow-DOM warning with sensitive values masked.

The scan-only endpoint does not call an LLM provider.

## Layout

| Path | Purpose |
|------|---------|
| `entrypoints/background.ts` | Service worker; calls `/v1/scan`. |
| `entrypoints/popup.html` | Toolbar popup markup and styles. |
| `entrypoints/popup/main.ts` | Toolbar popup settings controller. |
| `entrypoints/chatgpt-main.content.ts` | MAIN world wrapper for ChatGPT fetch calls. |
| `entrypoints/chatgpt.content.ts` | Isolated relay and warning renderer for ChatGPT. |
| `entrypoints/claude-main.content.ts` | MAIN world wrapper for Claude fetch calls. |
| `entrypoints/claude.content.ts` | Isolated relay and warning renderer for Claude. |
| `settings.ts` | Local extension settings and last-scan storage. |
| `risk.ts` | Sensitive-finding helpers for prompt decisions. |
| `ui/warning.ts` | Shadow-DOM warning UI and masking logic. |
| `types/jsdom.d.ts` | Test-only jsdom type shim. |

## Extension Development

WXT's development runner uses a temporary browser profile. That is useful for
extension contributors, but it is not the normal user setup.

```bash
bun install
bun run dev
```

## Checks

```bash
bun run compile
bun test
```

## Current Limits

- ChatGPT and Claude only.
- Developer preview only; not packaged for store distribution.
- Prompt extraction is request-shape dependent and may need updates when the
  target sites change.
- The engine endpoint is local-first by default.
