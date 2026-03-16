"""Unit tests for ContextPruner module."""

import pytest

from src.orchestrator.context_pruner import (
    ContextPruner,
    prune_context_for_architect,
)


@pytest.fixture
def sample_python_source() -> str:
    """Sample Python source code for testing."""
    return '''
import os
import sys
from typing import List, Optional

class UserService:
    """Service for user operations."""
    
    def __init__(self, db):
        self.db = db
    
    def get_user(self, user_id: str):
        return self.db.query(User).get(user_id)
    
    def create_user(self, name: str, email: str):
        user = User(name=name, email=email)
        self.db.add(user)
        return user

class AuthService:
    """Service for authentication."""
    
    def login(self, email: str, password: str):
        # Login logic
        pass
    
    def logout(self):
        # Logout logic
        pass

def helper_function():
    """A helper function."""
    return "helper"

def main():
    """Main entry point."""
    service = UserService(db)
    user = service.get_user("123")
    print(user)
'''


@pytest.fixture
def sample_pm_output() -> dict:
    """Sample PM output for testing."""
    return {
        "project_name": "Test Project",
        "description": "A test project for context pruning",
        "requirements": [
            "User authentication",
            "Create posts",
            "Comments",
            "Categories",
            "Search",
            "Notifications",
            "Admin panel",
            "Analytics",
            "Export data",
            "API access",
            "Extra requirement 1",
            "Extra requirement 2",
        ],
        "target_users": "Developers and testers",
        "success_metrics": ["Active users", "Posts created", "API calls"],
        "tech_preferences": ["Python", "FastAPI"],
        "budget_tier": "standard",
        "timeline": "3 months",
        "user_personas": [
            {"name": "Developer", "role": "Build apps", "goals": [], "pain_points": []}
        ],
    }


class TestContextPruner:
    """Tests for ContextPruner class."""

    def test_prune_file_extracts_relevant_class(self, sample_python_source):
        """Should extract only the specified class."""
        pruner = ContextPruner()
        result = pruner.prune_file(sample_python_source, ["UserService"])

        assert "class UserService:" in result
        assert "def get_user" in result
        assert "def create_user" in result
        assert "class AuthService:" not in result

    def test_prune_file_extracts_relevant_function(self, sample_python_source):
        """Should extract only the specified function."""
        pruner = ContextPruner()
        result = pruner.prune_file(sample_python_source, ["helper_function"])

        assert "def helper_function" in result
        assert "class UserService:" not in result

    def test_prune_file_includes_imports(self, sample_python_source):
        """Should include imports when requested."""
        pruner = ContextPruner()
        result = pruner.prune_file(sample_python_source, ["UserService"], include_imports=True)

        assert "import os" in result
        assert "from typing import List" in result

    def test_prune_file_excludes_imports_when_disabled(self, sample_python_source):
        """Should exclude imports when not requested."""
        pruner = ContextPruner()
        result = pruner.prune_file(sample_python_source, ["UserService"], include_imports=False)

        assert "import os" not in result
        assert "class UserService:" in result

    def test_prune_file_fallback_on_syntax_error(self):
        """Should fallback to first N chars on syntax error."""
        pruner = ContextPruner()
        invalid_source = "def broken(:\n  pass"
        result = pruner.prune_file(invalid_source, ["broken"])

        # Should return first 5000 chars as fallback
        assert result == invalid_source[:5000]

    def test_prune_file_empty_source(self):
        """Should handle empty source."""
        pruner = ContextPruner()
        result = pruner.prune_file("", ["SomeClass"])

        assert result == ""

    def test_prune_file_no_matching_symbols(self, sample_python_source):
        """Should return imports when no symbols match."""
        pruner = ContextPruner()
        result = pruner.prune_file(sample_python_source, ["NonExistentClass"], include_imports=True)

        # Should return only imports (no matching symbols)
        assert "import os" in result
        assert "class UserService:" not in result
        assert "class AuthService:" not in result


class TestTokenEstimation:
    """Tests for token estimation."""

    def test_estimate_tokens_returns_int(self):
        """Token estimation should return integer."""
        pruner = ContextPruner()
        tokens = pruner.estimate_tokens("Hello world")

        assert isinstance(tokens, int)
        assert tokens > 0

    def test_estimate_tokens_empty_string(self):
        """Empty string should have zero tokens."""
        pruner = ContextPruner()
        tokens = pruner.estimate_tokens("")

        assert tokens == 0

    def test_estimate_tokens_scales_with_length(self):
        """Longer text should have more tokens."""
        pruner = ContextPruner()
        short_tokens = pruner.estimate_tokens("Hello")
        long_tokens = pruner.estimate_tokens("Hello" * 100)

        assert long_tokens > short_tokens

    def test_check_token_limit_within_limit(self):
        """Should return True for text within limit."""
        pruner = ContextPruner(max_tokens=1000)
        is_within, tokens = pruner.check_token_limit("Hello world")

        assert is_within is True
        assert tokens < 1000

    def test_check_token_limit_exceeds_limit(self):
        """Should return False for text exceeding limit."""
        pruner = ContextPruner(max_tokens=10)
        is_within, tokens = pruner.check_token_limit("Hello world" * 100)

        assert is_within is False


class TestPrunePMOutput:
    """Tests for PM output pruning."""

    def test_prune_pm_output_keeps_essential_fields(self, sample_pm_output):
        """Should keep only essential fields."""
        pruner = ContextPruner()
        result = pruner.prune_pm_output(sample_pm_output)

        assert "project_name" in result
        assert "description" in result
        assert "requirements" in result
        assert "target_users" in result
        assert "success_metrics" in result

    def test_prune_pm_output_removes_non_essential_fields(self, sample_pm_output):
        """Should remove non-essential fields."""
        pruner = ContextPruner()
        result = pruner.prune_pm_output(sample_pm_output)

        assert "budget_tier" not in result
        assert "timeline" not in result
        assert "user_personas" not in result

    def test_prune_pm_output_limits_requirements(self, sample_pm_output):
        """Should limit requirements to top 10."""
        pruner = ContextPruner()
        result = pruner.prune_pm_output(sample_pm_output)

        assert len(result["requirements"]) == 10


class TestPruneFiles:
    """Tests for multi-file pruning."""

    def test_prune_files_respects_token_budget(self):
        """Should respect total token budget across files."""
        pruner = ContextPruner(max_tokens=500)

        files = {
            "file1.py": "def func1(): pass\n" * 100,
            "file2.py": "def func2(): pass\n" * 100,
            "file3.py": "def func3(): pass\n" * 100,
        }

        result = pruner.prune_files(files, {})

        total_tokens = sum(pruner.estimate_tokens(content) for content in result.values())
        assert total_tokens <= 500

    def test_prune_files_priority_files_first(self):
        """Should process priority files first."""
        pruner = ContextPruner(max_tokens=10000)

        files = {
            "important.py": "class Important: pass",
            "other.py": "class Other: pass",
        }

        result = pruner.prune_files(
            files,
            {},
            priority_files=["important.py"]
        )

        assert "important.py" in result


class TestExtractDependencies:
    """Tests for symbol dependency extraction."""

    def test_extract_dependencies_finds_used_classes(self, sample_python_source):
        """Should find classes used within a symbol."""
        pruner = ContextPruner()
        deps = pruner.extract_symbol_dependencies(sample_python_source, "main")

        # UserService is used as a constructor
        assert "UserService" in deps
        # Note: get_user is accessed via attribute (service.get_user), not detected
        assert "db" in deps  # db is a Name node in main()

    def test_extract_dependencies_empty_for_nonexistent(self, sample_python_source):
        """Should return empty set for non-existent symbol."""
        pruner = ContextPruner()
        deps = pruner.extract_symbol_dependencies(sample_python_source, "NonExistent")

        assert deps == set()


class TestPruneContextForArchitect:
    """Tests for the convenience function."""

    def test_returns_pruned_pm_output(self, sample_pm_output):
        """Should return pruned PM output."""
        result = prune_context_for_architect(sample_pm_output)

        assert "pm_output" in result
        assert "pruned_files" in result
        assert "token_count" in result

    def test_handles_no_existing_files(self, sample_pm_output):
        """Should handle case with no existing files."""
        result = prune_context_for_architect(sample_pm_output)

        assert result["pruned_files"] == {}
        assert result["token_count"] == 0

    def test_prunes_existing_files(self, sample_pm_output):
        """Should prune existing files when provided."""
        existing_files = {
            "models.py": "class User: pass\nclass Post: pass",
        }
        relevant_symbols = {
            "models.py": ["User"],
        }

        result = prune_context_for_architect(
            sample_pm_output,
            existing_files=existing_files,
            relevant_symbols=relevant_symbols,
        )

        assert "models.py" in result["pruned_files"]
        assert result["token_count"] > 0
