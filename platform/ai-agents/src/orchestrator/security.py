from __future__ import annotations

import re
import base64


class JailbreakClassifier:
    """Enhanced security classifier to detect prompt injection and jailbreak attempts."""
    
    BLOCKED_PATTERNS = [
        # Environment file access - various forms
        r"read.*\.env",
        r"cat\s+.*\.env",
        r"type\s+.*\.env",
        r"open\s*\(\s*['\"].*\.env",
        r"import\s+dotenv",
        r"load_dotenv",
        
        # Path traversal attacks
        r"\.\./",
        r"\.\.\\",
        r"/etc/passwd",
        r"/etc/shadow",
        r"/proc/",
        r"/sys/",
        r"C:\\Windows\\",
        
        # System destruction commands (with or without sudo)
        r"rm\s+-rf\s+/",
        r"rm\s+-rf\s+\\",
        r"dd\s+if=/dev/zero",
        r"mkfs\.",
        r":\(\)\s*\{\s*:\|:&\s*\};:",  # Fork bomb pattern
        r"chmod\s+777\s+/etc",
        r"chmod\s+-R\s+777\s+/",
        
        # Base64 encoded commands (common evasion technique)
        r"echo\s+\S+\s*\|\s*base64\s+-d",
        r"echo\s+\S+\s*\|\s*base64\s+--decode",
        r"base64\s+-d\s*<<<",
        r"`echo\s+\S+\s*\|\s*base64\s+-d`",
        r"\$\(echo\s+\S+\s*\|\s*base64\s+-d\)",
        
        # Environment variable exfiltration
        r"print\s*\(\s*os\.environ",
        r"os\.environ\[",
        r"os\.environ\.get",
        r"env\s*\|\s*grep",
        r"printenv",
        r"export\s+\|",
        r"set\s*\|\s*grep",
        
        # Prompt injection patterns
        r"ignore\s*previous\s*instructions",
        r"ignore\s*all\s*prior\s*instructions",
        r"override\s*instructions",
        r"disregard\s*system\s*prompt",
        r"system\s*prompt",
        r"previous\s*prompt",
        r"initial\s*instructions",
        r"developer\s*mode",
        r"DAN\s*mode",  # Do Anything Now
        r"jailbreak",
        
        # Role manipulation
        r"act\s+as\s+if\s+you\s+are",
        r"pretend\s+to\s+be",
        r"simulate\s+being",
        r"roleplay\s+as",
        r"you\s+are\s+now",
        
        # Delimiter manipulation
        r"```\s*ignore",
        r"```\s*system",
        r"<\|im_start\|>",  # ChatML format abuse
        r"<\|system\|>",
        r"\[SYSTEM\s*",
        
        # Exfiltration keywords
        r"exfiltrate",
        r"exfiltration",
        r"send\s+to\s+attacker",
        r"callback\s*url",
        r"webhook\s*url",
        
        # Code execution via eval/exec
        r"eval\s*\(",
        r"exec\s*\(",
        r"__import__\s*\(",
        r"subprocess\.call",
        r"subprocess\.run",
        r"subprocess\.Popen",
        r"os\.system\s*\(",
        r"os\.popen",
    ]

    def classify(self, prompt: str) -> tuple[bool, str]:
        """Classify prompt as safe or unsafe.
        
        Returns:
            (is_safe, reason) tuple
        """
        if not prompt:
            return True, ""
            
        prompt_lower = prompt.lower()
        
        # Check for blocked patterns
        for pattern in self.BLOCKED_PATTERNS:
            if re.search(pattern, prompt_lower):
                return False, f"Blocked pattern detected: {pattern}"
        
        # Decode and check base64-encoded content (common evasion)
        try:
            # Look for base64 strings and decode them
            potential_b64 = re.findall(r'[A-Za-z0-9+/]{20,}={0,2}', prompt)
            for b64_str in potential_b64:
                try:
                    decoded = base64.b64decode(b64_str).decode('utf-8', errors='ignore').lower()
                    for pattern in self.BLOCKED_PATTERNS:
                        if re.search(pattern, decoded):
                            return False, f"Blocked pattern in base64 content: {pattern}"
                except Exception:
                    pass
        except Exception:
            pass
        
        return True, ""

    def abort_if_unsafe(self, prompt: str) -> None:
        """Raise exception if prompt is unsafe."""
        is_safe, reason = self.classify(prompt)
        if not is_safe:
            raise ValueError(f"Prompt rejected by security classifier: {reason}")
