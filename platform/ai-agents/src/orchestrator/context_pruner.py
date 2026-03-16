"""Context pruning module for token-efficient LLM calls.

Uses AST-based pruning to extract only relevant code sections,
keeping context within the 500k token limit.
"""

from __future__ import annotations

import ast
import re
from typing import List, Dict, Optional, Set


class ContextPruner:
    """Prune context to stay within token limits using AST-based extraction."""

    MAX_TOKENS = 500000
    FALLBACK_CHAR_LIMIT = 5000

    def __init__(self, max_tokens: int = MAX_TOKENS):
        self.max_tokens = max_tokens

    def prune_file(
        self,
        source: str,
        relevant_symbols: List[str],
        include_imports: bool = True,
    ) -> str:
        """
        Use AST to extract only relevant parts of a file.

        Args:
            source: Source code content
            relevant_symbols: List of class/function names to extract
            include_imports: Whether to include import statements

        Returns:
            Pruned source code containing only relevant symbols
        """
        if not source:
            return ""

        try:
            tree = ast.parse(source)
        except SyntaxError:
            # Fallback: return first N chars
            return source[: self.FALLBACK_CHAR_LIMIT]

        relevant_nodes: List[str] = []
        imports: List[str] = []

        for node in ast.walk(tree):
            # Extract imports
            if include_imports and isinstance(node, (ast.Import, ast.ImportFrom)):
                segment = ast.get_source_segment(source, node)
                if segment:
                    imports.append(segment)

            # Extract relevant classes/functions
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if node.name in relevant_symbols:
                    segment = ast.get_source_segment(source, node)
                    if segment:
                        relevant_nodes.append(segment)

        # Build pruned output
        parts = []
        if imports:
            parts.append("\n".join(imports))
        if relevant_nodes:
            parts.append("\n\n".join(relevant_nodes))

        result = "\n\n".join(parts) if parts else source[: self.FALLBACK_CHAR_LIMIT]

        # Ensure we don't exceed token limit
        if self.estimate_tokens(result) > self.max_tokens:
            return result[: self._chars_for_tokens(self.max_tokens)]

        return result

    def prune_files(
        self,
        files: Dict[str, str],
        relevant_symbols: Dict[str, List[str]],
        priority_files: Optional[List[str]] = None,
    ) -> Dict[str, str]:
        """
        Prune multiple files, respecting total token budget.

        Args:
            files: Dict mapping file paths to source content
            relevant_symbols: Dict mapping file paths to symbol names
            priority_files: Files to include first (in order)

        Returns:
            Dict of pruned file contents
        """
        pruned: Dict[str, str] = {}
        total_tokens = 0

        # Process priority files first
        if priority_files:
            for file_path in priority_files:
                if file_path in files:
                    symbols = relevant_symbols.get(file_path, [])
                    pruned_content = self.prune_file(files[file_path], symbols)
                    tokens = self.estimate_tokens(pruned_content)

                    if total_tokens + tokens <= self.max_tokens:
                        pruned[file_path] = pruned_content
                        total_tokens += tokens

        # Process remaining files
        for file_path, content in files.items():
            if file_path in pruned:
                continue

            symbols = relevant_symbols.get(file_path, [])
            pruned_content = self.prune_file(content, symbols)
            tokens = self.estimate_tokens(pruned_content)

            if total_tokens + tokens <= self.max_tokens:
                pruned[file_path] = pruned_content
                total_tokens += tokens

        return pruned

    def prune_pm_output(self, pm_output: dict) -> dict:
        """
        Prune PM output to essential fields for architect agent.

        Args:
            pm_output: Full PM output dict

        Returns:
            Pruned PM output with essential fields only
        """
        essential_fields = [
            "project_name",
            "description",
            "requirements",
            "target_users",
            "success_metrics",
            "tech_preferences",
        ]

        pruned = {k: v for k, v in pm_output.items() if k in essential_fields}

        # Limit requirements to top 10 if too many
        if "requirements" in pruned and len(pruned["requirements"]) > 10:
            pruned["requirements"] = pruned["requirements"][:10]

        return pruned

    def extract_symbol_dependencies(self, source: str, symbol_name: str) -> Set[str]:
        """
        Extract dependencies (called functions, used classes) for a symbol.

        Args:
            source: Source code content
            symbol_name: Name of the symbol to analyze

        Returns:
            Set of dependency symbol names
        """
        dependencies: Set[str] = set()

        try:
            tree = ast.parse(source)
        except SyntaxError:
            return dependencies

        # Find the target symbol
        target_node = None
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if node.name == symbol_name:
                    target_node = node
                    break

        if not target_node:
            return dependencies

        # Extract all names used in the target symbol
        for node in ast.walk(target_node):
            if isinstance(node, ast.Name):
                dependencies.add(node.id)
            elif isinstance(node, ast.Attribute):
                if isinstance(node.value, ast.Name):
                    dependencies.add(node.value.id)

        # Remove the symbol itself
        dependencies.discard(symbol_name)

        return dependencies

    def estimate_tokens(self, text: str) -> int:
        """
        Estimate token count for text.

        Uses rough approximation: 1 token ≈ 4/3 words
        """
        if not text:
            return 0
        # More accurate estimation for code
        words = len(text.split())
        chars = len(text)
        # Average between word-based and char-based estimation
        return int((words * 4 // 3 + chars // 4) / 2)

    def _chars_for_tokens(self, tokens: int) -> int:
        """Convert token count to approximate character count."""
        return tokens * 4  # Rough: 1 token ≈ 4 chars

    def check_token_limit(self, text: str) -> tuple[bool, int]:
        """
        Check if text is within token limit.

        Args:
            text: Text to check

        Returns:
            Tuple of (is_within_limit, token_count)
        """
        tokens = self.estimate_tokens(text)
        return tokens <= self.max_tokens, tokens


def prune_context_for_architect(
    pm_output: dict,
    existing_files: Optional[Dict[str, str]] = None,
    relevant_symbols: Optional[Dict[str, List[str]]] = None,
) -> dict:
    """
    Convenience function to prune context for architect agent.

    Args:
        pm_output: PM agent output
        existing_files: Optional dict of existing project files
        relevant_symbols: Optional dict of relevant symbols per file

    Returns:
        Dict with pruned pm_output and pruned_files
    """
    pruner = ContextPruner()

    result: dict = {
        "pm_output": pruner.prune_pm_output(pm_output),
        "pruned_files": {},
        "token_count": 0,
    }

    if existing_files:
        pruned_files = pruner.prune_files(
            existing_files,
            relevant_symbols or {},
            priority_files=list(relevant_symbols.keys())[:5] if relevant_symbols else None,
        )
        result["pruned_files"] = pruned_files
        result["token_count"] = sum(
            pruner.estimate_tokens(content) for content in pruned_files.values()
        )

    return result
