"""Pipeline runner — main entry point for running the firewall pipeline."""

from __future__ import annotations

import structlog
from langgraph.graph import END, StateGraph

from src.pipeline.graph import pipeline
from src.pipeline.nodes.decision import decision_node
from src.pipeline.nodes.intent import intent_node
from src.pipeline.nodes.parse import parse_node
from src.pipeline.nodes.rules import rules_node
from src.pipeline.nodes.scanners import parallel_scanners_node
from src.pipeline.state import PipelineState
from src.services.policy_config import get_policy_config

logger = structlog.get_logger()


async def run_pipeline(
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
    """Run the firewall pipeline and return the final state."""
    policy_config = await get_policy_config(policy_name)

    initial_state: PipelineState = {
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

    result = await pipeline.ainvoke(initial_state)
    logger.info(
        "pipeline_complete",
        request_id=request_id,
        policy=policy_name,
        decision=result.get("decision"),
        risk_score=result.get("risk_score"),
        intent=result.get("intent"),
        node_timings=result.get("node_timings"),
    )
    return result


def _build_pre_llm_pipeline():
    """Build a sub-graph that runs parse→intent→rules→scanners→decision (no LLM call)."""
    graph = StateGraph(PipelineState)
    graph.add_node("parse", parse_node)
    graph.add_node("intent", intent_node)
    graph.add_node("rules", rules_node)
    graph.add_node("scanners", parallel_scanners_node)
    graph.add_node("decision", decision_node)

    graph.add_edge("parse", "intent")
    graph.add_edge("intent", "rules")
    graph.add_edge("rules", "scanners")
    graph.add_edge("scanners", "decision")
    graph.add_edge("decision", END)
    graph.set_entry_point("parse")
    return graph.compile()


_pre_llm_pipeline = _build_pre_llm_pipeline()


async def run_pre_llm_pipeline(
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
    """Run only the pre-LLM nodes (parse→intent→rules→decision).

    Used for streaming: we need the ALLOW/BLOCK decision *before* starting
    the SSE stream.  The actual LLM call is done separately.
    """
    policy_config = await get_policy_config(policy_name)

    initial_state: PipelineState = {
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

    result = await _pre_llm_pipeline.ainvoke(initial_state)
    logger.info(
        "pre_llm_pipeline_complete",
        request_id=request_id,
        policy=policy_name,
        decision=result.get("decision"),
        risk_score=result.get("risk_score"),
        intent=result.get("intent"),
    )
    return result
