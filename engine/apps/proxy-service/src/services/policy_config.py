"""Policy config lookup with a small Redis-backed cache."""

from __future__ import annotations

import json

import structlog
from sqlalchemy import select

from src.config import get_settings
from src.db.session import async_session, get_redis
from src.models.policy import Policy

logger = structlog.get_logger()

_POLICY_CACHE_TTL = 60  # seconds


async def get_policy_config(policy_name: str) -> dict:
    """Fetch active policy config by name, falling back to the default policy."""
    cache_key = f"policy_config:{policy_name}"

    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached is not None:
            return json.loads(cached)
    except Exception:
        logger.debug("policy_config_redis_unavailable", policy=policy_name)

    async with async_session() as session:
        stmt = select(Policy.config).where(Policy.name == policy_name, Policy.is_active == True)  # noqa: E712
        result = await session.execute(stmt.limit(1))
        config = result.scalar_one_or_none()

    if config is None:
        settings = get_settings()
        logger.warning(
            "policy_not_found_using_default",
            requested=policy_name,
            default=settings.default_policy,
        )
        if policy_name != settings.default_policy:
            return await get_policy_config(settings.default_policy)
        return {
            "thresholds": {
                "max_risk": 0.7,
                "injection_weight": 0.5,
                "toxicity_weight": 0.5,
                "nemo_weight": 0.7,
            }
        }

    try:
        redis = await get_redis()
        await redis.set(cache_key, json.dumps(config), ex=_POLICY_CACHE_TTL)
    except Exception:
        logger.debug("policy_config_redis_write_failed", policy=policy_name)

    return config
