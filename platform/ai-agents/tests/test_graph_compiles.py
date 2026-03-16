import pytest

from src.orchestrator.graph_builder import GraphBuilder
from src.orchestrator.state_schema import AgentState


@pytest.mark.asyncio
async def test_graph_compiles_and_invokes_smoke():
    graph = GraphBuilder().compile()
    state = AgentState(user_prompt="Build a blog", project_id="test")
    result = await graph.ainvoke(state)
    assert result is not None


def test_graph_builder_compile_sync():
    graph = GraphBuilder().compile()
    assert graph is not None
