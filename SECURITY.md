# Security Policy

## Reporting A Vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Use GitHub private vulnerability reporting for this repository if available, or
contact the maintainer directly.

## Scope

This policy covers the public self-hosted browser-extension fork:

- local scan engine
- browser extension
- setup scripts
- Docker self-hosted workflow

It does not cover ChatGPT, Claude, Docker Desktop, PostgreSQL, Redis, or other
third-party software.

## Local Data Boundary

The default browser-extension workflow sends prompts only to the local engine at
`http://localhost:8000/v1/scan`. Scan-only requests are not forwarded to an LLM
provider.

If you change the engine URL in the extension popup, prompts are sent to that
configured endpoint instead.

## Supported Version

This public fork is experimental and currently supports the latest `main`
branch only.
