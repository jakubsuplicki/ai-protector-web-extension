"""AI Protector self-hosted engine entry point.

This FastAPI app is the slim local backend for browser-extension use. It keeps
the core scan, policy, request-log, and health APIs while leaving out hosted
administration concerns.

Usage:
    uvicorn src.main_self_hosted:app --host 0.0.0.0 --port 8000
"""

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

os.environ.setdefault("APP_MODE", "self-hosted")

from src.config import get_settings
from src.db.seed import seed_denylist, seed_policies
from src.db.session import close_db, close_redis, engine
from src.logging import CorrelationIdMiddleware, setup_logging
from src.models import Base
from src.routers.analytics import router as analytics_router
from src.routers.health import router as health_router
from src.routers.policies import router as policies_router
from src.routers.requests import router as requests_router
from src.routers.rules import router as rules_router
from src.routers.scan import router as scan_router

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle for the self-hosted engine."""
    settings = get_settings()
    setup_logging(log_level=settings.log_level, json_logs=settings.json_logs)

    os.environ["LITELLM_LOG"] = settings.litellm_log_level
    logger.info("self_hosted_starting", version=settings.app_version)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await seed_policies()
    await seed_denylist()

    import asyncio

    async def _preload_scanners() -> None:
        """Warm up heavy ML singletons so the first request is fast."""
        try:
            if settings.enable_llm_guard:
                from src.pipeline.nodes.llm_guard import get_scanners

                logger.info("preload_start", scanner="llm_guard")
                await asyncio.to_thread(get_scanners, {})
            if settings.enable_nemo_guardrails:
                from src.pipeline.nodes.nemo_guardrails import get_rails

                logger.info("preload_start", scanner="nemo_guardrails")
                await asyncio.to_thread(get_rails)
            if settings.enable_presidio:
                from src.pipeline.nodes.presidio import get_analyzer, get_anonymizer

                logger.info("preload_start", scanner="presidio")
                await asyncio.to_thread(get_analyzer)
                await asyncio.to_thread(get_anonymizer)
            logger.info("preload_complete")
        except Exception as exc:
            logger.error(
                "preload_failed",
                error_type=type(exc).__name__,
                msg="Non-fatal; models will lazy-load on first request",
            )

    asyncio.create_task(_preload_scanners())
    logger.info("self_hosted_ready")

    yield

    await close_db()
    await close_redis()
    logger.info("self_hosted_stopped")


settings = get_settings()

app = FastAPI(
    title="AI Protector Self-Hosted Engine",
    description="Local LLM prompt firewall and DLP scan engine",
    version=settings.app_version,
    lifespan=lifespan,
)

# The browser extension is the primary self-hosted client. Its requests carry
# an opaque, per-install origin (`chrome-extension://<id>` / `moz-extension://<id>`)
# that we can't enumerate ahead of time, so we allow the extension *schemes* via
# regex rather than listing IDs. This is safe here because the self-hosted engine
# binds to localhost for a single user; the hosted/multi-tenant app (main.py) does
# NOT grant this and must keep its explicit origin allowlist.
EXTENSION_ORIGIN_REGEX = r"^(chrome-extension|moz-extension)://[a-z0-9]+$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=EXTENSION_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "x-client-id",
        "x-policy",
        "x-api-key",
        "x-correlation-id",
    ],
    expose_headers=[
        "x-decision",
        "x-intent",
        "x-risk-score",
        "x-pipeline",
        "x-correlation-id",
    ],
)
app.add_middleware(CorrelationIdMiddleware)

app.include_router(health_router)
app.include_router(analytics_router, prefix="/v1")
app.include_router(policies_router, prefix="/v1")
app.include_router(requests_router, prefix="/v1")
app.include_router(rules_router, prefix="/v1")
app.include_router(scan_router)
