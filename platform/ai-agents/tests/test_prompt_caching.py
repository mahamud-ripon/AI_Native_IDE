"""Tests for Prompt Caching functionality in CostManager."""

import pytest

from src.llm_router.cost_manager import CostManager, cost_manager


class TestPromptCaching:
    """Test suite for prompt caching features."""

    def test_cost_manager_initialization(self):
        """Test CostManager initializes with cache stats."""
        cm = CostManager()
        assert cm._cache_stats is not None
        assert "tier1" in cm._cache_stats
        assert "tier2" in cm._cache_stats
        assert "tier3" in cm._cache_stats

    def test_tier_costs_include_cached_pricing(self):
        """Test that tier costs include cached token pricing."""
        cm = CostManager()
        assert "cached" in cm.TIER_COSTS["tier1"]
        assert "cached" in cm.TIER_COSTS["tier2"]
        assert "cached" in cm.TIER_COSTS["tier3"]
        # Cached should be 90% cheaper
        assert cm.TIER_COSTS["tier1"]["cached"] == cm.TIER_COSTS["tier1"]["input"] * 0.10

    def test_estimate_cost_with_cached_tokens(self):
        """Test cost estimation with cached tokens."""
        cm = CostManager()
        # 10K input, 5K output, 5K cached
        cost = cm.estimate_cost("tier1", 10000, 5000, cached_tokens=5000)
        assert cost > 0
        # Verify cached tokens reduce cost
        cost_no_cache = cm.estimate_cost("tier1", 10000, 5000, cached_tokens=0)
        assert cost < cost_no_cache

    def test_estimate_cache_savings(self):
        """Test cache savings calculation."""
        cm = CostManager()
        savings = cm.estimate_cache_savings("tier1", 10000)
        # 10K tokens at tier1: regular = $0.15, cached = $0.015, savings = $0.135
        assert savings > 0
        expected_savings = (10000 / 1_000_000) * 15.0 * 0.90
        assert abs(savings - expected_savings) < 0.001

    def test_create_cached_system_message_large_prompt(self):
        """Test that large prompts get cache_control."""
        cm = CostManager()
        # Create a prompt > 1024 tokens (roughly 4096 chars)
        large_prompt = "x" * 5000
        msg = cm.create_cached_system_message(large_prompt, "tier1")
        
        assert msg["role"] == "system"
        assert isinstance(msg["content"], list)
        assert msg["content"][0]["type"] == "text"
        assert "cache_control" in msg["content"][0]
        assert msg["content"][0]["cache_control"]["type"] == "ephemeral"

    def test_create_cached_system_message_small_prompt(self):
        """Test that small prompts don't get cache_control."""
        cm = CostManager()
        # Create a prompt < 1024 tokens
        small_prompt = "Small prompt"
        msg = cm.create_cached_system_message(small_prompt, "tier1")
        
        assert msg["role"] == "system"
        assert isinstance(msg["content"], str)
        assert "cache_control" not in msg

    def test_create_cached_prompt_full(self):
        """Test creating full cached prompt with system, few-shot, and user."""
        cm = CostManager()
        system = "System prompt " * 500  # Large enough to cache
        few_shot = "Example input and output with detailed explanation. " * 150  # Large enough to cache (>4096 chars)
        user = "User request"
        
        messages = cm.create_cached_prompt(
            system_prompt=system,
            user_prompt=user,
            tier="tier1",
            few_shot_examples=few_shot,
        )
        
        # With few-shot: system, user (few-shot), assistant (ack), user (actual)
        assert len(messages) == 4
        # First message should be system with cache_control
        assert messages[0]["role"] == "system"
        # Last message should be user without cache_control
        assert messages[-1]["role"] == "user"
        assert isinstance(messages[-1]["content"], str)

    def test_create_cached_prompt_no_few_shot(self):
        """Test creating cached prompt without few-shot examples."""
        cm = CostManager()
        system = "System prompt " * 500
        user = "User request"
        
        messages = cm.create_cached_prompt(
            system_prompt=system,
            user_prompt=user,
            tier="tier1",
        )
        
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"

    def test_get_cache_stats_single_tier(self):
        """Test getting cache stats for a single tier."""
        cm = CostManager()
        # Trigger some caching
        cm.create_cached_system_message("x" * 5000, "tier1")
        
        stats = cm.get_cache_stats("tier1")
        assert "tier" in stats
        assert stats["tier"] == "tier1"
        assert "tokens_cached" in stats
        assert stats["tokens_cached"] > 0

    def test_get_cache_stats_all_tiers(self):
        """Test getting cache stats for all tiers."""
        cm = CostManager()
        stats = cm.get_cache_stats()
        
        assert "tiers" in stats
        assert "total_tokens_cached" in stats
        assert "tier1" in stats["tiers"]
        assert "tier2" in stats["tiers"]
        assert "tier3" in stats["tiers"]

    def test_reset_cache_stats(self):
        """Test resetting cache statistics."""
        cm = CostManager()
        # Trigger some caching
        cm.create_cached_system_message("x" * 5000, "tier1")
        
        # Verify stats exist
        assert cm._cache_stats["tier1"]["tokens_cached"] > 0
        
        # Reset
        cm.reset_cache_stats()
        
        # Verify reset
        assert cm._cache_stats["tier1"]["tokens_cached"] == 0
        assert cm._cache_stats["tier1"]["cache_hits"] == 0
        assert cm._cache_stats["tier1"]["cache_misses"] == 0

    def test_global_cost_manager_instance(self):
        """Test that global cost_manager instance works."""
        assert cost_manager is not None
        assert isinstance(cost_manager, CostManager)

    def test_min_cache_tokens_threshold(self):
        """Test MIN_CACHE_TOKENS threshold."""
        cm = CostManager()
        assert cm.MIN_CACHE_TOKENS == 1024

    def test_cached_token_cost_ratio(self):
        """Test cached token cost ratio is 10%."""
        from src.llm_router.cost_manager import CACHED_TOKEN_COST_RATIO
        assert CACHED_TOKEN_COST_RATIO == 0.10
