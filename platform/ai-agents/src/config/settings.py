"""
Configuration settings for ai-agents service.
"""

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class Settings:
    """Application settings loaded from environment variables."""
    
    # LLM Gateway Configuration
    llm_gateway_url: str = os.getenv("LLM_GATEWAY_URL", "http://ai-service:8005")
    llm_gateway_timeout: float = float(os.getenv("LLM_GATEWAY_TIMEOUT", "120.0"))
    
    # Redis Configuration
    redis_url: str = os.getenv("REDIS_URL", "redis://redis:6379")
    
    # Kafka Configuration
    kafka_brokers: str = os.getenv("KAFKA_BROKERS", "kafka:29092")
    
    # Database Configuration
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://ainative:ainative_pass@postgres:5432/ainative_ide"
    )
    
    # API Keys (for fallback direct calls - deprecated after gateway integration)
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    
    # User context (set by API gateway via headers)
    default_user_id: str = os.getenv("DEFAULT_USER_ID", "anonymous")
    default_org_id: str = os.getenv("DEFAULT_ORG_ID", "")
    
    # Feature flags
    use_llm_gateway: bool = os.getenv("USE_LLM_GATEWAY", "true").lower() == "true"
    enable_cost_tracking: bool = os.getenv("ENABLE_COST_TRACKING", "true").lower() == "true"


# Singleton instance
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Get the settings singleton instance."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
