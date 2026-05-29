# Apps

Applications used by the engine and optional demo stack.

| App | Tech | Port | Description |
|-----|------|------|-------------|
| **proxy-service** | Python / FastAPI | 8000 | Self-hosted scan engine and full demo API |
| **frontend** | Nuxt 4 / Vuetify 3 | 3000 | Optional demo dashboard, playground, policies, logs, analytics |
| **agent-demo** | Python / FastAPI | 8002 | Optional customer-support copilot demo behind the firewall |
| **reference-chat-target** | Python / FastAPI | 8010 | Optional OpenAI-compatible target for scans and comparisons |
| **test-agents** | Python / FastAPI | 8003 / 8004 | Optional pure-Python and LangGraph test agents |

The public self-hosted browser-extension path only needs `proxy-service`, plus
PostgreSQL and Redis from `infra/docker-compose.yml`.
