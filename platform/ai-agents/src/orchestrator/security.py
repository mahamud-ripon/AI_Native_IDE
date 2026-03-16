from __future__ import annotations

import re


class JailbreakClassifier:
    BLOCKED_PATTERNS = [
        r"read.*\.env",
        r"exfiltrate",
        r"system\s*prompt",
        r"ignore\s*previous",
        r"override\s*instructions",
        r"sudo\s+rm",
    ]

    def classify(self, prompt: str) -> tuple[bool, str]:
        prompt_lower = (prompt or "").lower()
        for pattern in self.BLOCKED_PATTERNS:
            if re.search(pattern, prompt_lower):
                return False, f"Blocked pattern detected: {pattern}"
        return True, ""

    def abort_if_unsafe(self, prompt: str) -> None:
        is_safe, reason = self.classify(prompt)
        if not is_safe:
            raise ValueError(f"Prompt rejected by security classifier: {reason}")
