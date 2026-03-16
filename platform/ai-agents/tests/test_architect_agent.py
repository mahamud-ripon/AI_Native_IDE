"""Unit tests for ArchitectAgent."""

import pytest

from src.agents.architect_agent import ArchitectAgent, _get_stub_output, _estimate_cost
from src.orchestrator.state_schema import (
    AgentState,
    PMOutput,
    ArchitectOutput,
    TableDefinition,
    ColumnDefinition,
    EndpointDefinition,
    FileSpec,
    ADR,
)


@pytest.fixture
def sample_state() -> AgentState:
    """Create a sample state with PM output."""
    return AgentState(
        user_prompt="Build a blog app",
        project_id="test-123",
        pm_output=PMOutput(
            project_name="My Blog",
            description="A blogging platform for writers",
            requirements=["User authentication", "Create posts", "Comments", "Categories"],
            target_users="Writers and readers",
            success_metrics=["Active users", "Posts created", "Comments posted"],
        ),
    )


@pytest.fixture
def empty_state() -> AgentState:
    """Create an empty state without PM output."""
    return AgentState(
        user_prompt="Build something",
        project_id="test-456",
    )


class TestArchitectAgentStubMode:
    """Tests for architect agent in stub/offline mode."""

    @pytest.mark.asyncio
    async def test_returns_stub_output_when_no_api_key(self, sample_state, monkeypatch):
        """Should return stub output when ANTHROPIC_API_KEY is not set."""
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        agent = ArchitectAgent()
        result = await agent.run(sample_state)

        assert "architect_output" in result
        assert "errors" in result
        assert "Missing ANTHROPIC_API_KEY" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_stub_output_has_valid_schema(self, monkeypatch):
        """Stub output should match ArchitectOutput schema."""
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        stub = _get_stub_output()

        assert isinstance(stub, ArchitectOutput)
        assert len(stub.tech_stack) > 0
        assert len(stub.tables) > 0
        assert len(stub.endpoints) > 0
        assert len(stub.files_to_create) > 0
        assert len(stub.architecture_decisions) > 0

    @pytest.mark.asyncio
    async def test_stub_output_tables_have_required_fields(self, monkeypatch):
        """Stub tables should have all required fields."""
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        stub = _get_stub_output()

        for table in stub.tables:
            assert isinstance(table, TableDefinition)
            assert table.name
            assert len(table.columns) > 0
            for col in table.columns:
                assert isinstance(col, ColumnDefinition)
                assert col.name
                assert col.type


class TestArchitectAgentValidation:
    """Tests for input validation."""

    @pytest.mark.asyncio
    async def test_returns_error_when_missing_pm_output(self, empty_state):
        """Should return error when PM output is missing."""
        agent = ArchitectAgent()
        result = await agent.run(empty_state)

        assert "errors" in result
        assert "Missing PM output" in result["errors"][0]
        assert "architect_output" not in result


class TestCostEstimation:
    """Tests for cost estimation."""

    def test_estimate_cost_returns_float(self):
        """Cost estimation should return a float."""
        input_text = "Sample input text"
        output_text = "Sample output text"

        cost = _estimate_cost(input_text, output_text)

        assert isinstance(cost, float)
        assert cost >= 0

    def test_estimate_cost_scales_with_length(self):
        """Longer texts should result in higher cost."""
        short_input = "Short"
        long_input = "Short" * 1000

        short_cost = _estimate_cost(short_input, short_input)
        long_cost = _estimate_cost(long_input, long_input)

        assert long_cost > short_cost


class TestArchitectOutputSchema:
    """Tests for ArchitectOutput schema validation."""

    def test_architect_output_accepts_valid_data(self):
        """ArchitectOutput should accept valid structured data."""
        output = ArchitectOutput(
            tech_stack=["nextjs", "postgresql", "prisma"],
            db_schema="model User { id String @id }",
            tables=[
                TableDefinition(
                    name="User",
                    columns=[
                        ColumnDefinition(
                            name="id",
                            type="String",
                            nullable=False,
                            primary_key=True,
                        )
                    ],
                    relations=[],
                )
            ],
            api_design="REST API",
            endpoints=[
                EndpointDefinition(
                    method="GET",
                    path="/api/users",
                    description="List users",
                )
            ],
            files_to_create=[
                FileSpec(
                    path="src/app/api/users/route.ts",
                    description="Users API",
                    priority="high",
                )
            ],
            architecture_decisions=[
                ADR(
                    id="ADR-001",
                    title="Use Next.js",
                    decision="Use Next.js for frontend",
                    rationale="SSR, great DX",
                    status="accepted",
                )
            ],
        )

        assert output.tech_stack == ["nextjs", "postgresql", "prisma"]
        assert len(output.tables) == 1
        assert output.tables[0].name == "User"

    def test_architect_output_defaults_to_empty_lists(self):
        """Optional list fields should default to empty lists."""
        output = ArchitectOutput(
            tech_stack=["python"],
            db_schema="",
            api_design="",
        )

        assert output.tables == []
        assert output.endpoints == []
        assert output.files_to_create == []
        assert output.architecture_decisions == []


class TestFileSpec:
    """Tests for FileSpec model."""

    def test_file_spec_requires_all_fields(self):
        """FileSpec should require path, description, and priority."""
        spec = FileSpec(
            path="src/main.py",
            description="Main entry point",
            priority="critical",
        )

        assert spec.path == "src/main.py"
        assert spec.priority == "critical"


class TestADR:
    """Tests for ADR (Architecture Decision Record) model."""

    def test_adr_requires_all_fields(self):
        """ADR should require all fields."""
        adr = ADR(
            id="ADR-001",
            title="Use PostgreSQL",
            decision="Use PostgreSQL as primary database",
            rationale="ACID compliance, mature ecosystem",
            status="accepted",
        )

        assert adr.id == "ADR-001"
        assert adr.status == "accepted"
