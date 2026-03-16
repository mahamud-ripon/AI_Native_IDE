from __future__ import annotations

import os
from typing import Any, Dict, List, Literal, Optional, Union

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI

from ..config.settings import get_settings

LLM_TIER = Literal["tier1", "tier2", "tier3"]

# Cached token costs (90% cheaper than regular)
CACHED_TOKEN_COST_RATIO = 0.10  # Cached tokens cost 10% of regular


class CostManager:
    """Dynamic LLM routing for cost optimization with Prompt Caching support.

    Prompt Caching Benefits:
    - 90% cost reduction on cached tokens
    - Cache lasts 5 min idle, max 1 hour
    - Best for repeated system prompts

    Gateway Integration:
    - When USE_LLM_GATEWAY=true, routes all calls through LLM Gateway
    - Gateway handles: routing, fallback, caching, quotas, observability
    """

    TIER_COSTS = {
        "tier1": {"input": 15.0, "output": 75.0, "cached": 15.0 * CACHED_TOKEN_COST_RATIO},
        "tier2": {"input": 0.25, "output": 1.25, "cached": 0.25 * CACHED_TOKEN_COST_RATIO},
        "tier3": {"input": 0.10, "output": 0.40, "cached": 0.10 * CACHED_TOKEN_COST_RATIO},
    }

    # Map tiers to task types for gateway routing
    TIER_TO_TASK_TYPE = {
        "tier1": "plan",      # Complex planning tasks
        "tier2": "codegen",   # Code generation
        "tier3": "chat",      # Simple tasks
    }

    # Minimum tokens required for caching (Anthropic requirement)
    MIN_CACHE_TOKENS = 1024

    def __init__(self) -> None:
        self._tier1: Optional[ChatAnthropic] = None
        self._tier2: Optional[ChatAnthropic] = None
        self._tier3: Optional[ChatOpenAI] = None

        # Gateway LLM instances (when using gateway)
        self._gateway_llms: Dict[str, Optional[BaseChatModel]] = {
            "tier1": None,
            "tier2": None,
            "tier3": None,
        }

        # Track cache statistics
        self._cache_stats: Dict[str, Dict[str, int]] = {
            "tier1": {"cache_hits": 0, "cache_misses": 0, "tokens_cached": 0},
            "tier2": {"cache_hits": 0, "cache_misses": 0, "tokens_cached": 0},
            "tier3": {"cache_hits": 0, "cache_misses": 0, "tokens_cached": 0},
        }

        # Check if gateway is enabled
        self._use_gateway = get_settings().use_llm_gateway

    def get_llm(self, tier: LLM_TIER) -> Union[ChatAnthropic, ChatOpenAI, BaseChatModel]:
        """Get LLM instance based on tier.

        When USE_LLM_GATEWAY=true, returns a GatewayChatModel that routes
        through the LLM Gateway. Otherwise, returns direct SDK instances.
        """
        if self._use_gateway:
            return self._get_gateway_llm(tier)
        return self._get_direct_llm(tier)

    def _get_gateway_llm(self, tier: LLM_TIER) -> BaseChatModel:
        """Get a GatewayChatModel for the specified tier."""
        from .gateway_llm import GatewayChatModel, LLMTaskType

        if self._gateway_llms[tier] is None:
            settings = get_settings()
            task_type = LLMTaskType(self.TIER_TO_TASK_TYPE[tier])
            
            self._gateway_llms[tier] = GatewayChatModel(
                task_type=task_type,
                agent_name=f"tier_{tier}",
                step_name="unknown",
                workflow_id="unknown",
                project_id="unknown",
                user_id=settings.default_user_id,
                org_id=settings.default_org_id,
            )
        return self._gateway_llms[tier]

    def _get_direct_llm(self, tier: LLM_TIER) -> Union[ChatAnthropic, ChatOpenAI]:
        """Get direct SDK LLM instance (legacy mode)."""
        if tier == "tier1":
            if self._tier1 is None:
                self._tier1 = ChatAnthropic(
                    model="claude-3-5-sonnet-20241022",
                    anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
                    # Enable extended thinking for complex tasks
                    max_tokens=4096,
                )
            return self._tier1

        if tier == "tier2":
            if self._tier2 is None:
                self._tier2 = ChatAnthropic(
                    model="claude-3-haiku-20240307",
                    anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
                    max_tokens=4096,
                )
            return self._tier2

        if tier == "tier3":
            if self._tier3 is None:
                self._tier3 = ChatOpenAI(
                    model="llama-3-70b-8192",
                    base_url="https://api.groq.com/openai/v1",
                    api_key=os.getenv("GROQ_API_KEY", ""),
                )
            return self._tier3

        raise ValueError(f"Unknown tier: {tier}")

    def get_tier_for_agent(self, agent_name: str) -> LLM_TIER:
        """Route agent to appropriate tier."""
        tier_map: Dict[str, LLM_TIER] = {
            "pm_agent": "tier1",
            "architect_agent": "tier1",
            "backend_agent": "tier2",
            "frontend_agent": "tier2",
            "devops_agent": "tier2",
            "qa_agent": "tier2",
            "security_agent": "tier3",
        }
        return tier_map.get(agent_name, "tier2")

    def estimate_cost(
        self,
        tier: LLM_TIER,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int = 0,
    ) -> float:
        """Estimate cost for a call, accounting for cached tokens.

        Args:
            tier: LLM tier (tier1, tier2, tier3)
            input_tokens: Total input tokens
            output_tokens: Output tokens generated
            cached_tokens: Tokens that were cached (90% cheaper)

        Returns:
            Estimated cost in USD
        """
        costs = self.TIER_COSTS[tier]

        # Calculate cost with cache savings
        uncached_input = input_tokens - cached_tokens
        cache_cost = (cached_tokens / 1_000_000) * costs["cached"]
        input_cost = (uncached_input / 1_000_000) * costs["input"]
        output_cost = (output_tokens / 1_000_000) * costs["output"]

        return input_cost + output_cost + cache_cost

    def estimate_cache_savings(
        self,
        tier: LLM_TIER,
        cached_tokens: int,
    ) -> float:
        """Calculate savings from caching.

        Args:
            tier: LLM tier
            cached_tokens: Number of cached tokens

        Returns:
            Amount saved in USD
        """
        costs = self.TIER_COSTS[tier]
        regular_cost = (cached_tokens / 1_000_000) * costs["input"]
        cached_cost = (cached_tokens / 1_000_000) * costs["cached"]
        return regular_cost - cached_cost

    def create_cached_system_message(
        self,
        content: str,
        tier: LLM_TIER,
    ) -> Dict[str, Any]:
        """Create a system message with cache control for Anthropic.

        Anthropic requires cache_control on messages you want to cache.
        The first message with cache_control will be cached.

        Args:
            content: System prompt content
            tier: LLM tier (for tracking)

        Returns:
            Message dict with cache_control for Anthropic API
        """
        # Estimate tokens (rough: ~4 chars per token)
        estimated_tokens = len(content) // 4

        if estimated_tokens >= self.MIN_CACHE_TOKENS:
            # Track cache attempt
            self._cache_stats[tier]["cache_misses"] += 1
            self._cache_stats[tier]["tokens_cached"] += estimated_tokens

            return {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": content,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
            }
        else:
            # Not enough tokens to cache, return regular message
            return {"role": "system", "content": content}

    def create_cached_prompt(
        self,
        system_prompt: str,
        user_prompt: str,
        tier: LLM_TIER,
        few_shot_examples: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Create a full prompt with caching for system + few-shot.

        Cache strategy:
        1. System prompt (cached if >= 1024 tokens)
        2. Few-shot examples (cached if present and large enough)
        3. User prompt (never cached - changes each time)

        Args:
            system_prompt: System instructions
            user_prompt: User's specific request
            tier: LLM tier for tracking
            few_shot_examples: Optional few-shot examples to cache

        Returns:
            List of messages with cache_control
        """
        messages: List[Dict[str, Any]] = []

        # System prompt with caching
        system_msg = self.create_cached_system_message(system_prompt, tier)
        messages.append(system_msg)

        # Few-shot examples with caching (if provided)
        if few_shot_examples:
            estimated_tokens = len(few_shot_examples) // 4
            if estimated_tokens >= self.MIN_CACHE_TOKENS:
                self._cache_stats[tier]["tokens_cached"] += estimated_tokens
                messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": few_shot_examples,
                            "cache_control": {"type": "ephemeral"},
                        }
                    ],
                })
                # Assistant acknowledgment (also cacheable)
                messages.append({
                    "role": "assistant",
                    "content": "I understand. I will follow these examples.",
                })

        # User prompt (never cached)
        messages.append({"role": "user", "content": user_prompt})

        return messages

    def get_cache_stats(self, tier: Optional[LLM_TIER] = None) -> Dict[str, Any]:
        """Get cache statistics.

        Args:
            tier: Specific tier or None for all tiers

        Returns:
            Cache statistics dict
        """
        if tier:
            return {
                "tier": tier,
                **self._cache_stats[tier],
                "estimated_savings": self.estimate_cache_savings(
                    tier, self._cache_stats[tier]["tokens_cached"]
                ),
            }

        # Return stats for all tiers
        total_cached = sum(s["tokens_cached"] for s in self._cache_stats.values())
        return {
            "tiers": self._cache_stats,
            "total_tokens_cached": total_cached,
        }

    def reset_cache_stats(self) -> None:
        """Reset cache statistics."""
        for tier in self._cache_stats:
            self._cache_stats[tier] = {
                "cache_hits": 0,
                "cache_misses": 0,
                "tokens_cached": 0,
            }


# Global instance
cost_manager = CostManager()
