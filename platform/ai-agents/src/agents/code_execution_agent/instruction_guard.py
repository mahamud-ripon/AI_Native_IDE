"""
Instruction Guard

Validates and sanitizes instructions before submission to the Execution Engine.
Prevents LLM hallucination disasters by blocking dangerous commands and
enforcing instruction quality standards.

Architecture:
    CodeExecutionAgent
           │
    InstructionBuilder
           │
    InstructionGuard  ← THIS MODULE
           │
    Execution API
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional, List, Set
from enum import Enum


class InstructionValidationError(Exception):
    """Raised when instruction validation fails."""
    
    def __init__(self, message: str, violation: str, recoverable: bool = False):
        super().__init__(message)
        self.violation = violation
        self.recoverable = recoverable


class ViolationType(Enum):
    """Types of instruction violations."""
    TOO_SHORT = "too_short"
    TOO_LONG = "too_long"
    EMPTY = "empty"
    FORBIDDEN_COMMAND = "forbidden_command"
    DANGEROUS_PATTERN = "dangerous_pattern"
    SHELL_INJECTION = "shell_injection"
    PATH_TRAVERSAL = "path_traversal"
    INVALID_FORMAT = "invalid_format"
    SUSPICIOUS_KEYWORD = "suspicious_keyword"


@dataclass
class ValidationConfig:
    """Configuration for instruction validation."""
    
    # Length constraints
    min_length: int = 15
    max_length: int = 10000
    
    # Forbidden shell commands
    forbidden_commands: Set[str] = field(default_factory=lambda: {
        # Filesystem destruction
        "rm -rf",
        "rm -fr",
        "rmdir /s",
        "del /s",
        "format",
        "mkfs",
        
        # Privilege escalation
        "sudo",
        "su -",
        "doas",
        "pkexec",
        
        # Dangerous permissions
        "chmod 777",
        "chmod -R 777",
        "chown -R",
        
        # System modification
        "dd if=",
        "dd of=",
        "> /dev/",
        "shutdown",
        "reboot",
        "init 0",
        "init 6",
        
        # Network dangerous
        "iptables",
        "ufw disable",
        "firewall-cmd --disable",
        
        # Process killing
        "kill -9",
        "pkill -9",
        "killall",
        
        # Credential access
        "cat /etc/passwd",
        "cat /etc/shadow",
        ".ssh/id_rsa",
        ".pem",
        "aws_credentials",
        ".env",
        
        # Package system abuse
        "curl | bash",
        "wget | bash",
        "curl | sh",
        "wget | sh",
    })
    
    # Dangerous regex patterns
    dangerous_patterns: List[str] = field(default_factory=lambda: [
        # Path traversal
        r'\.\./\.\./\.\.',
        r'\.\.\\?\.\.\\?\.\.',
        
        # Shell injection
        r';\s*rm\s',
        r'&&\s*rm\s',
        r'\|\s*rm\s',
        r'`[^`]*rm[^`]*`',
        r'\$\([^)]*rm[^)]*\)',
        
        # Environment variable access
        r'process\.env',
        r'os\.environ',
        r'getenv\s*\(',
        
        # Eval/exec patterns
        r'eval\s*\(',
        r'exec\s*\(',
        r'exec\s+',
        r'subprocess\.call\s*\([^)]*shell\s*=\s*True',
    ])
    
    # Suspicious keywords (warn but don't block)
    suspicious_keywords: Set[str] = field(default_factory=lambda: {
        "password",
        "secret",
        "api_key",
        "apikey",
        "token",
        "credential",
        "private_key",
        "access_key",
    })
    
    # Allow certain patterns in code context
    allowed_in_code_blocks: Set[str] = field(default_factory=lambda: {
        "password",  # Variable names
        "token",     # Variable names
        "secret",    # Variable names
    })


class InstructionGuard:
    """
    Validates and sanitizes instructions before execution.
    
    Responsibilities:
    - Validate instruction length
    - Detect forbidden commands
    - Prevent shell injection
    - Block path traversal
    - Warn on suspicious keywords
    
    Usage:
        guard = InstructionGuard()
        
        try:
            validated = guard.validate(instruction)
        except InstructionValidationError as e:
            print(f"Invalid instruction: {e.violation}")
    """
    
    def __init__(self, config: Optional[ValidationConfig] = None):
        self.config = config or ValidationConfig()
        
        # Compile dangerous patterns
        self._compiled_patterns = [
            re.compile(pattern, re.IGNORECASE)
            for pattern in self.config.dangerous_patterns
        ]
    
    def validate(self, instruction: str) -> str:
        """
        Validate an instruction string.
        
        Args:
            instruction: The instruction to validate
            
        Returns:
            The validated (and potentially sanitized) instruction
            
        Raises:
            InstructionValidationError: If validation fails
        """
        if not instruction:
            raise InstructionValidationError(
                "Instruction is empty",
                ViolationType.EMPTY.value,
                recoverable=False,
            )
        
        # Normalize whitespace
        instruction = instruction.strip()
        
        # Check length
        if len(instruction) < self.config.min_length:
            raise InstructionValidationError(
                f"Instruction too short (min {self.config.min_length} chars)",
                ViolationType.TOO_SHORT.value,
                recoverable=True,
            )
        
        if len(instruction) > self.config.max_length:
            raise InstructionValidationError(
                f"Instruction too long (max {self.config.max_length} chars)",
                ViolationType.TOO_LONG.value,
                recoverable=True,
            )
        
        # Check for forbidden commands
        instruction_lower = instruction.lower()
        for forbidden in self.config.forbidden_commands:
            if forbidden.lower() in instruction_lower:
                # Check if it's in a code block (allowed)
                if self._is_in_code_block(instruction, forbidden):
                    continue
                
                raise InstructionValidationError(
                    f"Forbidden command detected: '{forbidden}'",
                    ViolationType.FORBIDDEN_COMMAND.value,
                    recoverable=False,
                )
        
        # Check dangerous patterns
        for pattern in self._compiled_patterns:
            match = pattern.search(instruction)
            if match:
                # Check if it's in a code block (allowed for some)
                matched_text = match.group()
                if self._is_in_code_block(instruction, matched_text):
                    continue
                
                raise InstructionValidationError(
                    f"Dangerous pattern detected: '{matched_text}'",
                    ViolationType.DANGEROUS_PATTERN.value,
                    recoverable=False,
                )
        
        # Check for path traversal
        if self._has_path_traversal(instruction):
            raise InstructionValidationError(
                "Path traversal attempt detected",
                ViolationType.PATH_TRAVERSAL.value,
                recoverable=False,
            )
        
        # Warn on suspicious keywords (but don't block)
        self._check_suspicious_keywords(instruction)
        
        return instruction
    
    def validate_and_sanitize(self, instruction: str) -> str:
        """
        Validate and sanitize an instruction.
        
        Removes or escapes dangerous patterns where possible.
        """
        validated = self.validate(instruction)
        
        # Additional sanitization could be added here
        # For now, just return the validated instruction
        return validated
    
    def _is_in_code_block(self, instruction: str, text: str) -> bool:
        """Check if text is inside a code block."""
        # Find all code blocks
        code_block_pattern = re.compile(r'```[\s\S]*?```', re.MULTILINE)
        code_blocks = code_block_pattern.findall(instruction)
        
        for block in code_blocks:
            if text.lower() in block.lower():
                return True
        
        # Also check inline code
        inline_code_pattern = re.compile(r'`[^`]+`')
        inline_codes = inline_code_pattern.findall(instruction)
        
        for code in inline_codes:
            if text.lower() in code.lower():
                return True
        
        return False
    
    def _has_path_traversal(self, instruction: str) -> bool:
        """Check for path traversal patterns."""
        # Check for multiple parent directory references
        traversal_patterns = [
            r'\.\./\.\./\.\.',  # ../../../
            r'\.\.\\\.\.\\\.\.',  # ..\..\..\
            r'/\.\./\.\./',  # /../../
            r'\\\.\.\\\.\.\\',  # \..\..\
        ]
        
        for pattern in traversal_patterns:
            if re.search(pattern, instruction):
                return True
        
        return False
    
    def _check_suspicious_keywords(self, instruction: str) -> List[str]:
        """Check for suspicious keywords and return warnings."""
        warnings = []
        instruction_lower = instruction.lower()
        
        for keyword in self.config.suspicious_keywords:
            if keyword.lower() in instruction_lower:
                # Skip if in code block and allowed
                if self._is_in_code_block(instruction, keyword):
                    if keyword in self.config.allowed_in_code_blocks:
                        continue
                
                warnings.append(keyword)
        
        if warnings:
            # Log warning but don't block
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(
                f"Suspicious keywords in instruction: {warnings}. "
                "Instruction will proceed but review recommended."
            )
        
        return warnings
    
    def is_safe(self, instruction: str) -> bool:
        """
        Quick check if instruction is safe without raising.
        
        Returns:
            True if instruction passes validation, False otherwise
        """
        try:
            self.validate(instruction)
            return True
        except InstructionValidationError:
            return False
    
    def get_validation_errors(self, instruction: str) -> List[str]:
        """
        Get all validation errors without raising.
        
        Returns:
            List of error messages
        """
        errors = []
        
        try:
            self.validate(instruction)
        except InstructionValidationError as e:
            errors.append(str(e))
        
        return errors


# ========================================
# SINGLETON INSTANCE
# ========================================

_default_guard: Optional[InstructionGuard] = None


def get_instruction_guard(config: Optional[ValidationConfig] = None) -> InstructionGuard:
    """Get or create the default instruction guard."""
    global _default_guard
    
    if _default_guard is None:
        _default_guard = InstructionGuard(config)
    
    return _default_guard


def validate_instruction(instruction: str) -> str:
    """
    Convenience function to validate an instruction.
    
    Args:
        instruction: The instruction to validate
        
    Returns:
        Validated instruction
        
    Raises:
        InstructionValidationError: If validation fails
    """
    return get_instruction_guard().validate(instruction)
