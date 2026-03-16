from __future__ import annotations

from .graph_builder import GraphBuilder
from .security import JailbreakClassifier
from .state_schema import AgentState


async def run_pipeline(user_prompt: str, project_id: str) -> AgentState:
    JailbreakClassifier().abort_if_unsafe(user_prompt)
    graph = GraphBuilder().compile()
    initial_state = AgentState(user_prompt=user_prompt, project_id=project_id)
    result = await graph.ainvoke(initial_state)
    return result
