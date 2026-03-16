"""Tests for Schema Validation Middleware."""

import asyncio
import pytest
from datetime import datetime

from src.orchestrator.schema_validation import (
    ValidationMiddleware,
    ValidationResult,
    ValidationError,
    ValidationStatus,
    ValidationSeverity,
    PMOutputSchema,
    ArchitectOutputSchema,
    BackendOutputSchema,
    FrontendOutputSchema,
    DevOpsOutputSchema,
    QAOutputSchema,
    SecurityOutputSchema,
    FeatureSpec,
    APIEndpoint,
    DatabaseSchema,
    Vulnerability,
    SCHEMA_REGISTRY,
    get_validation_middleware,
    reset_validation_middleware,
    validate_output,
)


class TestValidationStatus:
    """Test suite for ValidationStatus."""

    def test_status_values(self):
        """Test status enum values."""
        assert ValidationStatus.VALID.value == "valid"
        assert ValidationStatus.INVALID.value == "invalid"
        assert ValidationStatus.WARNING.value == "warning"
        assert ValidationStatus.SKIPPED.value == "skipped"


class TestValidationError:
    """Test suite for ValidationError."""

    def test_error_creation(self):
        """Test error creation."""
        error = ValidationError(
            field="project_name",
            message="Project name is required",
        )
        assert error.field == "project_name"
        assert error.message == "Project name is required"
        assert error.severity == ValidationSeverity.ERROR

    def test_error_with_suggestion(self):
        """Test error with suggestion."""
        error = ValidationError(
            field="priority",
            message="Invalid priority",
            severity=ValidationSeverity.ERROR,
            suggestion="Use 'high', 'medium', or 'low'",
        )
        assert error.suggestion == "Use 'high', 'medium', or 'low'"

    def test_error_to_dict(self):
        """Test error to dict conversion."""
        error = ValidationError(
            field="features",
            message="At least one feature required",
            severity=ValidationSeverity.WARNING,
        )
        d = error.to_dict()
        assert d["field"] == "features"
        assert d["severity"] == "warning"


class TestValidationResult:
    """Test suite for ValidationResult."""

    def test_valid_result(self):
        """Test valid result."""
        result = ValidationResult(
            agent_name="pm_agent",
            status=ValidationStatus.VALID,
        )
        assert result.is_valid is True
        assert result.has_errors is False

    def test_invalid_result(self):
        """Test invalid result."""
        result = ValidationResult(
            agent_name="pm_agent",
            status=ValidationStatus.INVALID,
            errors=[ValidationError("field", "error")],
        )
        assert result.is_valid is False
        assert result.has_errors is True

    def test_warning_result(self):
        """Test warning result."""
        result = ValidationResult(
            agent_name="pm_agent",
            status=ValidationStatus.WARNING,
            warnings=[ValidationError("field", "warning", ValidationSeverity.WARNING)],
        )
        assert result.is_valid is True
        assert result.has_warnings is True

    def test_to_dict(self):
        """Test result to dict conversion."""
        result = ValidationResult(
            agent_name="pm_agent",
            status=ValidationStatus.VALID,
        )
        d = result.to_dict()
        assert d["agent_name"] == "pm_agent"
        assert d["status"] == "valid"
        assert d["is_valid"] is True


class TestFeatureSpec:
    """Test suite for FeatureSpec schema."""

    def test_valid_feature(self):
        """Test valid feature."""
        feature = FeatureSpec(
            name="User Authentication",
            description="OAuth2 login system",
            priority="high",
            acceptance_criteria=["User can login", "User can logout"],
        )
        assert feature.name == "User Authentication"
        assert feature.priority == "high"

    def test_invalid_priority(self):
        """Test invalid priority."""
        with pytest.raises(ValueError):
            FeatureSpec(
                name="Feature",
                description="Description",
                priority="urgent",  # Invalid
            )

    def test_priority_normalization(self):
        """Test priority is normalized to lowercase."""
        feature = FeatureSpec(
            name="Feature",
            description="Description",
            priority="HIGH",
        )
        assert feature.priority == "high"


class TestPMOutputSchema:
    """Test suite for PMOutputSchema."""

    def test_valid_output(self):
        """Test valid PM output."""
        output = PMOutputSchema(
            project_name="My Project",
            description="A test project with enough description",
            features=[
                FeatureSpec(name="Feature 1", description="First feature"),
            ],
        )
        assert output.project_name == "My Project"
        assert len(output.features) == 1

    def test_empty_project_name(self):
        """Test empty project name fails."""
        with pytest.raises(ValueError):
            PMOutputSchema(
                project_name="",
                description="Description here",
                features=[FeatureSpec(name="F1", description="D1")],
            )

    def test_short_description(self):
        """Test short description fails."""
        with pytest.raises(ValueError):
            PMOutputSchema(
                project_name="Project",
                description="short",  # Less than 10 chars
                features=[FeatureSpec(name="F1", description="D1")],
            )

    def test_no_features(self):
        """Test no features fails."""
        with pytest.raises(ValueError):
            PMOutputSchema(
                project_name="Project",
                description="A valid description",
                features=[],
            )

    def test_timeline_validation(self):
        """Test timeline validation."""
        output = PMOutputSchema(
            project_name="Project",
            description="Valid description",
            features=[FeatureSpec(name="F1", description="D1")],
            timeline_weeks=4,
        )
        assert output.timeline_weeks == 4

        with pytest.raises(ValueError):
            PMOutputSchema(
                project_name="Project",
                description="Valid description",
                features=[FeatureSpec(name="F1", description="D1")],
                timeline_weeks=0,  # Must be >= 1
            )


class TestArchitectOutputSchema:
    """Test suite for ArchitectOutputSchema."""

    def test_valid_output(self):
        """Test valid architect output."""
        output = ArchitectOutputSchema(
            architecture_type="microservices",
            components=["API Gateway", "User Service", "Order Service"],
            api_endpoints=[
                APIEndpoint(path="/users", method="GET", description="List users"),
            ],
        )
        assert output.architecture_type == "microservices"

    def test_invalid_architecture_type(self):
        """Test invalid architecture type."""
        with pytest.raises(ValueError):
            ArchitectOutputSchema(
                architecture_type="monolith",  # Should be 'monolithic'
                components=["Service"],
            )

    def test_api_endpoint_method_validation(self):
        """Test API endpoint method validation."""
        endpoint = APIEndpoint(
            path="/users",
            method="post",  # lowercase should be normalized
        )
        assert endpoint.method == "POST"

        with pytest.raises(ValueError):
            APIEndpoint(path="/users", method="INVALID")


class TestQAOutputSchema:
    """Test suite for QAOutputSchema."""

    def test_valid_output(self):
        """Test valid QA output."""
        output = QAOutputSchema(
            tests_passed=True,
            test_results={"test1": True, "test2": True},
            coverage_percent=85.5,
        )
        assert output.tests_passed is True

    def test_coverage_validation(self):
        """Test coverage percent validation."""
        with pytest.raises(ValueError):
            QAOutputSchema(
                tests_passed=True,
                coverage_percent=150,  # Must be <= 100
            )

    def test_consistency_validation(self):
        """Test consistency between tests_passed and test_results."""
        # If test_results has failures, tests_passed should be False
        output = QAOutputSchema(
            tests_passed=True,
            test_results={"test1": True, "test2": False},
        )
        # Model validator should set tests_passed to False
        assert output.tests_passed is False


class TestSecurityOutputSchema:
    """Test suite for SecurityOutputSchema."""

    def test_valid_output(self):
        """Test valid security output."""
        output = SecurityOutputSchema(
            is_secure=True,
            vulnerabilities=[],
            risk_score=2.5,
        )
        assert output.is_secure is True

    def test_vulnerability_severity_validation(self):
        """Test vulnerability severity validation."""
        vuln = Vulnerability(
            id="CVE-2024-1234",
            severity="critical",
            description="SQL Injection",
            location="api/users.py:45",
        )
        assert vuln.severity == "critical"

        with pytest.raises(ValueError):
            Vulnerability(
                id="CVE-2024-1234",
                severity="urgent",  # Invalid
                description="Issue",
                location="file.py",
            )

    def test_consistency_validation(self):
        """Test consistency between is_secure and vulnerabilities."""
        # If critical/high vulnerabilities exist, is_secure should be False
        output = SecurityOutputSchema(
            is_secure=True,
            vulnerabilities=[
                Vulnerability(
                    id="1",
                    severity="critical",
                    description="Issue",
                    location="file.py",
                )
            ],
        )
        assert output.is_secure is False


class TestValidationMiddleware:
    """Test suite for ValidationMiddleware."""

    def test_initialization(self):
        """Test middleware initialization."""
        middleware = ValidationMiddleware()
        assert middleware.strict_mode is True
        assert middleware.track_history is True

    def test_get_schema(self):
        """Test getting schema for agent."""
        middleware = ValidationMiddleware()
        schema = middleware.get_schema("pm_agent")
        assert schema == PMOutputSchema

        schema = middleware.get_schema("unknown_agent")
        assert schema is None

    @pytest.mark.asyncio
    async def test_validate_valid_output(self):
        """Test validating valid output."""
        middleware = ValidationMiddleware()
        output = {
            "project_name": "Test Project",
            "description": "A valid project description",
            "features": [
                {"name": "Feature 1", "description": "First feature"}
            ],
        }

        result = await middleware.validate("pm_agent", output)

        assert result.is_valid is True
        assert result.status == ValidationStatus.VALID
        assert len(result.errors) == 0

    @pytest.mark.asyncio
    async def test_validate_invalid_output(self):
        """Test validating invalid output."""
        middleware = ValidationMiddleware()
        output = {
            "project_name": "",  # Empty - invalid
            "description": "short",  # Too short
            "features": [],  # Empty - invalid
        }

        result = await middleware.validate("pm_agent", output)

        assert result.is_valid is False
        assert result.status == ValidationStatus.INVALID
        assert len(result.errors) > 0

    @pytest.mark.asyncio
    async def test_validate_none_output(self):
        """Test validating None output."""
        middleware = ValidationMiddleware()

        result = await middleware.validate("pm_agent", None)

        assert result.is_valid is False
        assert "None" in result.errors[0].message

    @pytest.mark.asyncio
    async def test_validate_unknown_agent(self):
        """Test validating unknown agent."""
        middleware = ValidationMiddleware()

        result = await middleware.validate("unknown_agent", {"data": "test"})

        assert result.status == ValidationStatus.SKIPPED

    @pytest.mark.asyncio
    async def test_validation_history(self):
        """Test validation history tracking."""
        middleware = ValidationMiddleware()

        await middleware.validate("pm_agent", {
            "project_name": "Test",
            "description": "Valid description",
            "features": [{"name": "F1", "description": "D1"}],
        })

        history = middleware.get_validation_history()
        assert len(history) == 1

    @pytest.mark.asyncio
    async def test_agent_validation_stats(self):
        """Test validation statistics."""
        middleware = ValidationMiddleware()

        # Run several validations
        for i in range(3):
            await middleware.validate("pm_agent", {
                "project_name": f"Project {i}",
                "description": "Valid description",
                "features": [{"name": "F1", "description": "D1"}],
            })

        stats = middleware.get_agent_validation_stats("pm_agent")
        assert stats["total"] == 3
        assert stats["valid"] == 3

    def test_custom_validator(self):
        """Test registering custom validator."""
        middleware = ValidationMiddleware()

        def custom_validator(data):
            errors = []
            if "special_field" not in data:
                errors.append(ValidationError(
                    field="special_field",
                    message="Special field required",
                    severity=ValidationSeverity.WARNING,
                ))
            return errors

        middleware.register_custom_validator("pm_agent", custom_validator)

        assert "pm_agent" in middleware._custom_validators

    @pytest.mark.asyncio
    async def test_custom_validator_execution(self):
        """Test custom validator is executed."""
        middleware = ValidationMiddleware()

        def custom_validator(data):
            return [ValidationError(
                field="custom",
                message="Custom validation failed",
                severity=ValidationSeverity.WARNING,
            )]

        middleware.register_custom_validator("pm_agent", custom_validator)

        result = await middleware.validate("pm_agent", {
            "project_name": "Test",
            "description": "Valid description",
            "features": [{"name": "F1", "description": "D1"}],
        })

        assert result.has_warnings is True

    def test_clear_history(self):
        """Test clearing history."""
        middleware = ValidationMiddleware()
        middleware._validation_history.append({"test": "entry"})

        middleware.clear_history()
        assert len(middleware.get_validation_history()) == 0


class TestSchemaRegistry:
    """Test suite for schema registry."""

    def test_registry_contains_all_agents(self):
        """Test registry contains all agent schemas."""
        expected_agents = [
            "pm_agent",
            "architect_agent",
            "backend_agent",
            "frontend_agent",
            "devops_agent",
            "qa_agent",
            "security_agent",
        ]

        for agent in expected_agents:
            assert agent in SCHEMA_REGISTRY, f"{agent} not in registry"


class TestValidationDecorator:
    """Test suite for validation decorator."""

    @pytest.mark.asyncio
    async def test_decorator_valid_output(self):
        """Test decorator with valid output."""
        @validate_output("pm_agent")
        async def agent_func():
            return {
                "project_name": "Test",
                "description": "Valid description",
                "features": [{"name": "F1", "description": "D1"}],
            }

        result = await agent_func()
        assert result is not None

    @pytest.mark.asyncio
    async def test_decorator_invalid_output_strict(self):
        """Test decorator with invalid output in strict mode."""
        reset_validation_middleware()
        middleware = get_validation_middleware()
        middleware.strict_mode = True

        @validate_output("pm_agent")
        async def agent_func():
            return {
                "project_name": "",  # Invalid
                "description": "short",
                "features": [],
            }

        with pytest.raises(ValueError) as exc_info:
            await agent_func()

        assert "validation failed" in str(exc_info.value).lower()


class TestGlobalMiddleware:
    """Test suite for global middleware functions."""

    def test_get_validation_middleware(self):
        """Test getting global middleware."""
        reset_validation_middleware()
        middleware1 = get_validation_middleware()
        assert middleware1 is not None

        middleware2 = get_validation_middleware()
        assert middleware1 is middleware2  # Same instance

    def test_reset_validation_middleware(self):
        """Test resetting global middleware."""
        reset_validation_middleware()
        middleware = get_validation_middleware()
        assert middleware is not None
