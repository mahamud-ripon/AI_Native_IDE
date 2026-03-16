"""Schema Validation Middleware for validating agent outputs.

This module provides:
- Pydantic schemas for each agent output
- Validation middleware to validate outputs before passing to next agent
- Error handling with retry suggestions
- Validation events for streaming

Usage:
    from src.orchestrator.schema_validation import (
        ValidationMiddleware,
        PMOutputSchema,
        ArchitectOutputSchema,
    )

    middleware = ValidationMiddleware()

    # Validate agent output
    result = await middleware.validate("pm_agent", output_data)
    if result.is_valid:
        # Pass to next agent
        pass
    else:
        # Handle validation errors
        print(result.errors)
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Type, Union

from pydantic import BaseModel, Field, field_validator, model_validator


# ============================================================================
# Validation Status
# ============================================================================


class ValidationStatus(str, Enum):
    """Status of validation."""
    VALID = "valid"
    INVALID = "invalid"
    WARNING = "warning"  # Valid but with issues
    SKIPPED = "skipped"  # Validation skipped


class ValidationSeverity(str, Enum):
    """Severity of validation issues."""
    ERROR = "error"      # Must fix before proceeding
    WARNING = "warning"  # Should fix but can proceed
    INFO = "info"        # Informational


# ============================================================================
# Validation Result
# ============================================================================


@dataclass
class ValidationError:
    """A single validation error."""
    field: str
    message: str
    severity: ValidationSeverity = ValidationSeverity.ERROR
    suggestion: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "field": self.field,
            "message": self.message,
            "severity": self.severity.value,
            "suggestion": self.suggestion,
        }


@dataclass
class ValidationResult:
    """Result of schema validation."""
    agent_name: str
    status: ValidationStatus
    errors: List[ValidationError] = field(default_factory=list)
    warnings: List[ValidationError] = field(default_factory=list)
    validated_data: Optional[Dict[str, Any]] = None
    raw_data: Optional[Dict[str, Any]] = None
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def is_valid(self) -> bool:
        """Check if validation passed."""
        return self.status == ValidationStatus.VALID or self.status == ValidationStatus.WARNING

    @property
    def has_errors(self) -> bool:
        """Check if there are errors."""
        return len(self.errors) > 0

    @property
    def has_warnings(self) -> bool:
        """Check if there are warnings."""
        return len(self.warnings) > 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "agent_name": self.agent_name,
            "status": self.status.value,
            "is_valid": self.is_valid,
            "errors": [e.to_dict() for e in self.errors],
            "warnings": [w.to_dict() for w in self.warnings],
            "timestamp": self.timestamp,
        }


# ============================================================================
# Agent Output Schemas
# ============================================================================


# PM Agent Output Schema
class FeatureSpec(BaseModel):
    """Feature specification."""
    name: str = Field(..., description="Feature name")
    description: str = Field(..., description="Feature description")
    priority: str = Field(default="medium", description="Priority: high, medium, low")
    acceptance_criteria: List[str] = Field(default_factory=list, description="Acceptance criteria")

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        if v.lower() not in ["high", "medium", "low"]:
            raise ValueError("Priority must be high, medium, or low")
        return v.lower()


class PMOutputSchema(BaseModel):
    """Output schema for PM Agent."""
    project_name: str = Field(..., description="Project name", min_length=1)
    description: str = Field(..., description="Project description", min_length=10)
    features: List[FeatureSpec] = Field(..., description="List of features", min_length=1)
    tech_stack: List[str] = Field(default_factory=list, description="Technology stack")
    constraints: List[str] = Field(default_factory=list, description="Project constraints")
    timeline_weeks: Optional[int] = Field(default=None, ge=1, description="Estimated timeline")

    @field_validator("project_name")
    @classmethod
    def validate_project_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Project name cannot be empty")
        return v.strip()

    @field_validator("features")
    @classmethod
    def validate_features(cls, v: List[FeatureSpec]) -> List[FeatureSpec]:
        if not v:
            raise ValueError("At least one feature is required")
        return v


# Architect Agent Output Schema
class APIEndpoint(BaseModel):
    """API endpoint specification."""
    path: str = Field(..., description="Endpoint path")
    method: str = Field(..., description="HTTP method")
    description: str = Field(default="", description="Endpoint description")
    request_body: Optional[Dict[str, Any]] = Field(default=None, description="Request body schema")
    response_schema: Optional[Dict[str, Any]] = Field(default=None, description="Response schema")

    @field_validator("method")
    @classmethod
    def validate_method(cls, v: str) -> str:
        allowed = ["GET", "POST", "PUT", "PATCH", "DELETE"]
        if v.upper() not in allowed:
            raise ValueError(f"Method must be one of {allowed}")
        return v.upper()


class DatabaseSchema(BaseModel):
    """Database schema specification."""
    table_name: str = Field(..., description="Table name")
    columns: Dict[str, str] = Field(..., description="Column definitions")
    indexes: List[str] = Field(default_factory=list, description="Index definitions")
    relationships: List[str] = Field(default_factory=list, description="Table relationships")


class ArchitectOutputSchema(BaseModel):
    """Output schema for Architect Agent."""
    architecture_type: str = Field(default="monolithic", description="Architecture type")
    components: List[str] = Field(default_factory=list, description="System components")
    api_endpoints: List[APIEndpoint] = Field(default_factory=list, description="API endpoints")
    database_schema: List[DatabaseSchema] = Field(default_factory=list, description="Database schemas")
    tech_stack: Dict[str, str] = Field(default_factory=dict, description="Technology decisions")
    diagrams: List[str] = Field(default_factory=list, description="Diagram references")

    @field_validator("architecture_type")
    @classmethod
    def validate_architecture_type(cls, v: str) -> str:
        allowed = ["monolithic", "microservices", "serverless", "hybrid"]
        if v.lower() not in allowed:
            raise ValueError(f"Architecture type must be one of {allowed}")
        return v.lower()


# Backend Agent Output Schema
class RouteDefinition(BaseModel):
    """Route definition."""
    file_path: str = Field(..., description="File path")
    content: str = Field(..., description="Route code content")
    endpoints: List[str] = Field(default_factory=list, description="Endpoint names")


class BackendOutputSchema(BaseModel):
    """Output schema for Backend Agent."""
    routes: List[RouteDefinition] = Field(default_factory=list, description="API routes")
    models: List[str] = Field(default_factory=list, description="Data models")
    services: List[str] = Field(default_factory=list, description="Service files")
    tests: List[str] = Field(default_factory=list, description="Test files")
    dependencies: Dict[str, str] = Field(default_factory=dict, description="Dependencies")
    config: Dict[str, Any] = Field(default_factory=dict, description="Configuration")


# Frontend Agent Output Schema
class ComponentDefinition(BaseModel):
    """Component definition."""
    name: str = Field(..., description="Component name")
    file_path: str = Field(..., description="File path")
    content: str = Field(..., description="Component code")
    props: List[str] = Field(default_factory=list, description="Props")


class FrontendOutputSchema(BaseModel):
    """Output schema for Frontend Agent."""
    components: List[ComponentDefinition] = Field(default_factory=list, description="React components")
    pages: List[str] = Field(default_factory=list, description="Page files")
    styles: List[str] = Field(default_factory=list, description="Style files")
    hooks: List[str] = Field(default_factory=list, description="Custom hooks")
    dependencies: Dict[str, str] = Field(default_factory=dict, description="Dependencies")


# DevOps Agent Output Schema
class DockerConfig(BaseModel):
    """Docker configuration."""
    dockerfile: str = Field(..., description="Dockerfile content")
    docker_compose: Optional[str] = Field(default=None, description="docker-compose.yml content")


class CIConfig(BaseModel):
    """CI/CD configuration."""
    platform: str = Field(..., description="CI platform")
    config_file: str = Field(..., description="Config file path")
    content: str = Field(..., description="Configuration content")


class DevOpsOutputSchema(BaseModel):
    """Output schema for DevOps Agent."""
    docker: Optional[DockerConfig] = Field(default=None, description="Docker configuration")
    ci_cd: List[CIConfig] = Field(default_factory=list, description="CI/CD configurations")
    kubernetes: List[str] = Field(default_factory=list, description="Kubernetes manifests")
    scripts: Dict[str, str] = Field(default_factory=dict, description="Deployment scripts")
    infrastructure: Dict[str, Any] = Field(default_factory=dict, description="Infrastructure config")


# QA Agent Output Schema
class TestResult(BaseModel):
    """Test result."""
    name: str = Field(..., description="Test name")
    passed: bool = Field(..., description="Test passed")
    duration_ms: int = Field(default=0, description="Test duration")
    error_message: Optional[str] = Field(default=None, description="Error message if failed")


class QAOutputSchema(BaseModel):
    """Output schema for QA Agent."""
    tests_passed: bool = Field(..., description="All tests passed")
    test_results: Dict[str, bool] = Field(default_factory=dict, description="Test results")
    coverage_percent: Optional[float] = Field(default=None, ge=0, le=100, description="Code coverage")
    issues_found: List[str] = Field(default_factory=list, description="Issues found")
    recommendations: List[str] = Field(default_factory=list, description="Recommendations")

    @model_validator(mode="after")
    def validate_consistency(self) -> "QAOutputSchema":
        # If any test failed, tests_passed should be False
        if self.test_results and self.tests_passed:
            if not all(self.test_results.values()):
                self.tests_passed = False
        return self


# Security Agent Output Schema
class Vulnerability(BaseModel):
    """Vulnerability finding."""
    id: str = Field(..., description="Vulnerability ID")
    severity: str = Field(..., description="Severity level")
    description: str = Field(..., description="Description")
    location: str = Field(..., description="Code location")
    recommendation: str = Field(default="", description="Fix recommendation")

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        allowed = ["critical", "high", "medium", "low", "info"]
        if v.lower() not in allowed:
            raise ValueError(f"Severity must be one of {allowed}")
        return v.lower()


class SecurityOutputSchema(BaseModel):
    """Output schema for Security Agent."""
    is_secure: bool = Field(..., description="Code is secure")
    vulnerabilities: List[Vulnerability] = Field(default_factory=list, description="Vulnerabilities found")
    owasp_compliance: Dict[str, bool] = Field(default_factory=dict, description="OWASP compliance")
    recommendations: List[str] = Field(default_factory=list, description="Security recommendations")
    risk_score: Optional[float] = Field(default=None, ge=0, le=10, description="Risk score (0-10)")

    @model_validator(mode="after")
    def validate_consistency(self) -> "SecurityOutputSchema":
        # If vulnerabilities exist, is_secure should be False
        if self.vulnerabilities and self.is_secure:
            critical_or_high = [v for v in self.vulnerabilities if v.severity in ["critical", "high"]]
            if critical_or_high:
                self.is_secure = False
        return self


# ============================================================================
# Schema Registry
# ============================================================================


SCHEMA_REGISTRY: Dict[str, Type[BaseModel]] = {
    "pm_agent": PMOutputSchema,
    "architect_agent": ArchitectOutputSchema,
    "backend_agent": BackendOutputSchema,
    "frontend_agent": FrontendOutputSchema,
    "devops_agent": DevOpsOutputSchema,
    "qa_agent": QAOutputSchema,
    "security_agent": SecurityOutputSchema,
}


# ============================================================================
# Validation Middleware
# ============================================================================


class ValidationMiddleware:
    """Middleware for validating agent outputs before passing to next agent.

    Features:
    - Schema validation for each agent output
    - Custom validation rules
    - Error suggestions for common issues
    - Validation history tracking
    - Integration with streaming events

    Usage:
        middleware = ValidationMiddleware()

        # Validate output
        result = await middleware.validate("pm_agent", output_data)

        if result.is_valid:
            # Proceed to next agent
            pass
        else:
            # Handle errors
            for error in result.errors:
                print(f"{error.field}: {error.message}")
    """

    def __init__(
        self,
        strict_mode: bool = True,
        track_history: bool = True,
    ):
        """Initialize validation middleware.

        Args:
            strict_mode: If True, validation errors block execution
            track_history: If True, track validation history
        """
        self.strict_mode = strict_mode
        self.track_history = track_history
        self._validation_history: List[ValidationResult] = []
        self._custom_validators: Dict[str, List[Callable]] = {}

    def register_custom_validator(
        self,
        agent_name: str,
        validator: Callable[[Dict[str, Any]], List[ValidationError]],
    ) -> None:
        """Register a custom validator for an agent.

        Args:
            agent_name: Name of the agent
            validator: Function that takes output data and returns list of errors
        """
        if agent_name not in self._custom_validators:
            self._custom_validators[agent_name] = []
        self._custom_validators[agent_name].append(validator)

    def get_schema(self, agent_name: str) -> Optional[Type[BaseModel]]:
        """Get the schema for an agent.

        Args:
            agent_name: Name of the agent

        Returns:
            Schema class or None if not found
        """
        return SCHEMA_REGISTRY.get(agent_name)

    async def validate(
        self,
        agent_name: str,
        output_data: Any,
        skip_custom: bool = False,
    ) -> ValidationResult:
        """Validate agent output against its schema.

        Args:
            agent_name: Name of the agent
            output_data: Output data to validate
            skip_custom: Skip custom validators

        Returns:
            ValidationResult with status and errors
        """
        errors: List[ValidationError] = []
        warnings: List[ValidationError] = []
        validated_data = None

        # Handle None or empty output
        if output_data is None:
            return ValidationResult(
                agent_name=agent_name,
                status=ValidationStatus.INVALID,
                errors=[ValidationError(
                    field="output",
                    message="Output is None",
                    suggestion="Agent must produce valid output",
                )],
            )

        # Convert to dict if needed
        if hasattr(output_data, "model_dump"):
            raw_data = output_data.model_dump()
        elif hasattr(output_data, "dict"):
            raw_data = output_data.dict()
        elif isinstance(output_data, dict):
            raw_data = output_data
        else:
            raw_data = {"value": output_data}

        # Get schema
        schema_class = self.get_schema(agent_name)

        if schema_class is None:
            # No schema registered - skip validation
            result = ValidationResult(
                agent_name=agent_name,
                status=ValidationStatus.SKIPPED,
                warnings=[ValidationError(
                    field="schema",
                    message=f"No schema registered for {agent_name}",
                    severity=ValidationSeverity.INFO,
                )],
                raw_data=raw_data,
            )
            if self.track_history:
                self._validation_history.append(result)
            return result

        # Schema validation
        try:
            validated = schema_class(**raw_data)
            validated_data = validated.model_dump()
        except Exception as e:
            # Parse validation errors
            if hasattr(e, "errors"):
                for err in e.errors():
                    field_path = ".".join(str(loc) for loc in err.get("loc", []))
                    errors.append(ValidationError(
                        field=field_path,
                        message=err.get("msg", str(e)),
                        suggestion=self._get_suggestion(field_path, err.get("msg", "")),
                    ))
            else:
                errors.append(ValidationError(
                    field="output",
                    message=str(e),
                    suggestion="Check output format",
                ))

        # Run custom validators
        if not skip_custom and agent_name in self._custom_validators:
            for validator in self._custom_validators[agent_name]:
                try:
                    custom_errors = await validator(raw_data) if inspect.iscoroutinefunction(validator) else validator(raw_data)
                    for err in custom_errors:
                        if err.severity == ValidationSeverity.ERROR:
                            errors.append(err)
                        else:
                            warnings.append(err)
                except Exception as e:
                    warnings.append(ValidationError(
                        field="custom_validator",
                        message=f"Custom validator failed: {e}",
                        severity=ValidationSeverity.WARNING,
                    ))

        # Determine status
        if errors:
            status = ValidationStatus.INVALID
        elif warnings:
            status = ValidationStatus.WARNING
        else:
            status = ValidationStatus.VALID

        result = ValidationResult(
            agent_name=agent_name,
            status=status,
            errors=errors,
            warnings=warnings,
            validated_data=validated_data,
            raw_data=raw_data,
        )

        if self.track_history:
            self._validation_history.append(result)

        return result

    def _get_suggestion(self, field: str, error_msg: str) -> Optional[str]:
        """Get suggestion for common validation errors."""
        suggestions = {
            "project_name": "Provide a descriptive project name",
            "description": "Description should be at least 10 characters",
            "features": "Include at least one feature specification",
            "priority": "Use 'high', 'medium', or 'low'",
            "method": "Use GET, POST, PUT, PATCH, or DELETE",
            "architecture_type": "Use monolithic, microservices, serverless, or hybrid",
            "severity": "Use critical, high, medium, low, or info",
            "tests_passed": "Must be a boolean value",
            "is_secure": "Must be a boolean value",
        }

        for key, suggestion in suggestions.items():
            if key in field.lower():
                return suggestion

        return None

    def get_validation_history(self, limit: int = 100) -> List[ValidationResult]:
        """Get validation history.

        Args:
            limit: Maximum number of results to return

        Returns:
            List of validation results
        """
        return self._validation_history[-limit:]

    def get_agent_validation_stats(self, agent_name: str) -> Dict[str, Any]:
        """Get validation statistics for an agent.

        Args:
            agent_name: Name of the agent

        Returns:
            Statistics dictionary
        """
        agent_results = [
            r for r in self._validation_history
            if r.agent_name == agent_name
        ]

        if not agent_results:
            return {"agent": agent_name, "total": 0}

        return {
            "agent": agent_name,
            "total": len(agent_results),
            "valid": sum(1 for r in agent_results if r.status == ValidationStatus.VALID),
            "invalid": sum(1 for r in agent_results if r.status == ValidationStatus.INVALID),
            "warnings": sum(1 for r in agent_results if r.status == ValidationStatus.WARNING),
            "skipped": sum(1 for r in agent_results if r.status == ValidationStatus.SKIPPED),
        }

    def clear_history(self) -> None:
        """Clear validation history."""
        self._validation_history.clear()


# Need asyncio import for iscoroutinefunction check
import asyncio
import inspect


# ============================================================================
# Validation Decorator
# ============================================================================


def validate_output(agent_name: str):
    """Decorator to automatically validate agent output.

    Usage:
        @validate_output("pm_agent")
        async def run_pm_agent(state):
            # ... agent logic ...
            return output
    """
    def decorator(func):
        async def wrapper(*args, **kwargs):
            middleware = get_validation_middleware()

            # Execute function
            result = await func(*args, **kwargs)

            # Validate output
            validation = await middleware.validate(agent_name, result)

            # If invalid and strict mode, raise exception
            if not validation.is_valid and middleware.strict_mode:
                errors_str = "; ".join(
                    f"{e.field}: {e.message}" for e in validation.errors
                )
                raise ValueError(f"Output validation failed: {errors_str}")

            return result

        return wrapper
    return decorator


# ============================================================================
# Global Instance
# ============================================================================


_global_middleware: Optional[ValidationMiddleware] = None


def get_validation_middleware() -> ValidationMiddleware:
    """Get or create global validation middleware instance."""
    global _global_middleware
    if _global_middleware is None:
        _global_middleware = ValidationMiddleware()
    return _global_middleware


def reset_validation_middleware() -> None:
    """Reset global middleware (for testing)."""
    global _global_middleware
    _global_middleware = None
