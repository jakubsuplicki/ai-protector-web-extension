# Contributing

Thanks for helping improve AI Protector Web Extension.

This fork is local-first: keep the self-hosted engine and browser extension easy
to run without an account or hosted service.

## Setup

```bash
bun run setup:brave
```

Load `extension/dist/chrome-mv3` once from your browser extensions page. After
that, use `bun run engine` for normal local runs.

## Checks

```bash
scripts/check-self-hosted.sh

cd extension
bun run compile
bun test

cd ../engine/apps/proxy-service
uv run --extra dev ruff check src tests
uv run --extra dev pytest tests -q
```

DB-backed engine tests need PostgreSQL on `localhost:5432`; the Docker profile
is the easiest way to provide it.

## Commit Style

Use conventional prefixes:

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `test:` | Adding or fixing tests |
| `refactor:` | Internal code change |
| `chore:` | Repo maintenance |

Update docs when commands, setup flow, endpoints, browser support, or user
visible behavior changes.

## Pull Request Checklist

- Local setup still works or the limitation is documented.
- Extension changes include TypeScript compile and relevant Bun tests.
- Engine changes include focused Python checks where practical.
- No private planning notes, secrets, credentials, or local machine paths are
  added to public files.

