from __future__ import annotations

import operator
from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ConversationStatus(str, Enum):
    QUEUED = "queued"
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class FeatureSpec(BaseModel):
    name: str
    description: str
    priority: str
    dependencies: List[str] = Field(default_factory=list)


class Persona(BaseModel):
    name: str
    role: str
    goals: List[str]
    pain_points: List[str]


class PMOutput(BaseModel):
    project_name: str
    description: str
    requirements: List[str]
    features: List[FeatureSpec] = Field(default_factory=list)
    target_users: str
    user_personas: List[Persona] = Field(default_factory=list)
    success_metrics: List[str]
    budget_tier: Optional[str] = None
    timeline: Optional[str] = None
    tech_preferences: Optional[List[str]] = None


class ColumnDefinition(BaseModel):
    name: str
    type: str
    nullable: bool
    primary_key: bool = False
    foreign_key: Optional[str] = None


class TableDefinition(BaseModel):
    name: str
    columns: List[ColumnDefinition]
    relations: List[str] = Field(default_factory=list)


class EndpointDefinition(BaseModel):
    method: str
    path: str
    description: str
    request_body: Optional[str] = None
    response: Optional[str] = None


class FileSpec(BaseModel):
    path: str
    description: str
    priority: str


class ADR(BaseModel):
    id: str
    title: str
    decision: str
    rationale: str
    status: str


class ArchitectOutput(BaseModel):
    tech_stack: List[str]
    db_schema: str
    tables: List[TableDefinition] = Field(default_factory=list)
    api_design: str
    endpoints: List[EndpointDefinition] = Field(default_factory=list)
    files_to_create: List[FileSpec] = Field(default_factory=list)
    architecture_decisions: List[ADR] = Field(default_factory=list)
    architecture_diagram: Optional[str] = None


class PatchOperation(BaseModel):
    """A single patch operation for editing existing files."""
    action: Literal["replace", "insert", "delete"]
    startLine: int  # 1-based line number
    endLine: Optional[int] = None  # inclusive, for replace/delete
    content: Optional[str] = None  # new content for replace/insert


class CodeResult(BaseModel):
    """Hybrid output from code generation agents.
    
    Supports both:
    - create_files: for new files (full content)
    - patch_files: for editing existing files (patch operations)
    """
    create_files: Dict[str, str] = Field(default_factory=dict)
    patch_files: Dict[str, List[PatchOperation]] = Field(default_factory=dict)
    dependencies: List[str] = Field(default_factory=list)
    instructions: Optional[str] = None


# Backward compatibility alias
CodeOutput = CodeResult


class QAOutput(BaseModel):
    tests_passed: bool
    test_results: Dict[str, bool] = Field(default_factory=dict)
    errors: List[str] = Field(default_factory=list)
    coverage: Optional[float] = None


class SecurityOutput(BaseModel):
    vulnerabilities: List[Dict[str, Any]] = Field(default_factory=list)
    risk_level: str


class AgentState(BaseModel):
    user_prompt: str
    project_id: str

    pm_output: Optional[PMOutput] = None
    architect_output: Optional[ArchitectOutput] = None
    backend_output: Optional[CodeOutput] = None
    frontend_output: Optional[CodeOutput] = None
    devops_output: Optional[CodeOutput] = None
    qa_output: Optional[QAOutput] = None
    security_output: Optional[SecurityOutput] = None
    code_execution_output: Optional[Dict[str, Any]] = None

    iteration: Annotated[int, operator.add] = 0
    max_iterations: int = 3
    errors: Annotated[List[str], operator.add] = Field(default_factory=list)
    cost_sofar: float = 0.0
