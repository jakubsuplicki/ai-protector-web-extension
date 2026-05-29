# Contributing

Thanks for helping improve AI Protector.

The public fork's primary path is the self-hosted engine plus browser extension.
Keep changes local-first, documented, and easy to run.

## Setup

Start the self-hosted engine:

```bash
cd engine
make self-hosted
make doctor
```

Start the extension:

```bash
cd extension
bun install
bun run dev
```

The engine API runs on `http://localhost:8000`; the extension calls
`POST /v1/scan`.

## Optional Full Demo

The original demo stack is still available:

```bash
cd engine
make demo
```

Open `http://localhost:3000`.

## Local Development

Run infrastructure only:

```bash
cd engine
make dev
```

Run the proxy service locally:

```bash
cd engine/apps/proxy-service
uv run --extra dev uvicorn src.main_self_hosted:app --reload --port 8000
```

Run the extension locally:

```bash
cd extension
bun run dev
```

## Checks

Engine:

```bash
cd engine/apps/proxy-service
uv run --extra dev ruff check src tests
uv run --extra dev pytest tests -q
```

Extension:

```bash
cd extension
bun run compile
bun test
```

DB-backed engine tests require PostgreSQL on `localhost:5432`.

Local readiness:

```bash
cd engine
make doctor
```

## Code Style

| Area | Tool |
|------|------|
| Python | Ruff |
| TypeScript | TypeScript compiler and Bun test |
| Browser extension | WXT |

Prefer small, focused changes. Update docs when behavior, commands, endpoints,
or runtime assumptions change.

## Commit Messages

Use conventional prefixes:

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `test:` | Adding or fixing tests |
| `refactor:` | Code change without user-facing behavior |
| `dx:` | Developer experience |

## Project Layout

```text
engine/
  apps/proxy-service/      self-hosted scan engine and full demo API
  apps/frontend/           optional demo dashboard
  apps/agent-demo/         optional demo agent
  infra/                   Docker Compose stack
  docs/                    architecture and self-hosted docs
extension/
  entrypoints/             WXT service worker and content scripts
  ui/                      warning UI
```

## Pull Request Checklist

- Tests or smoke checks run.
- Public docs updated for command/API changes.
- No private planning material added to public-facing docs.
- New extension behavior is covered by tests where practical.
