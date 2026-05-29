"""Lightweight scan-only pipeline runner.

This keeps the self-hosted browser-extension path out of the full chat
LangGraph stack while preserving the same scan node order and behavior.
"""

from __future__ import annotations

import structlog

from src.pipeline.nodes.decision import decision_node
from src.pipeline.nodes.intent import intent_node
from src.pipeline.nodes.parse import parse_node
from src.pipeline.nodes.rules import rules_node
from src.pipeline.nodes.scanners import parallel_scanners_node
from src.pipeline.state import PipelineState
from src.services.policy_config import get_policy_config

logger = structlog.get_logger()


async def run_scan_pipeline(
    *,
    request_id: str,
    client_id: str | None,
    policy_name: str,
    model: str,
    messages: list[dict],
    temperature: float,
    max_tokens: int | None,
    stream: bool,
    api_key: str | None = None,
) -> PipelineState:
    """Run parse -> intent -> rules -> scanners -> decision without chat deps."""
    policy_config = await get_policy_config(policy_name)

    state: PipelineState = {
        "request_id": request_id,
        "client_id": client_id,
        "policy_name": policy_name,
        "policy_config": policy_config,
        "model": model,
        "messages": messages,
        "user_message": "",
        "prompt_hash": "",
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
        "api_key": api_key,
    }

    for node in (parse_node, intent_node, rules_node, parallel_scanners_node, decision_node):
        state = await node(state)

    logger.info(
        "scan_pipeline_complete",
        request_id=request_id,
        policy=policy_name,
        decision=state.get("decision"),
        risk_score=state.get("risk_score"),
        intent=state.get("intent"),
        node_timings=state.get("node_timings"),
    )
    return state
