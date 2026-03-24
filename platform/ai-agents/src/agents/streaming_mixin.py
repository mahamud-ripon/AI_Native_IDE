"""Streaming LLM mixin for agents.

This module provides token-by-token streaming capability to agents,
enabling real-time response display in the frontend similar to Claude Code.

Usage:
    from src.agents.streaming_mixin import StreamingMixin
    
    class MyAgent(StreamingMixin):
        async def run(self, state):
            async for token in self.stream_llm(prompt):
                yield token  # Frontend receives tokens in real-time
"""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Optional

from ..clients.llm_client import LLMClient, LLMCompletionRequest, LLMStreamEvent
from ..config.settings import get_settings


class StreamingMixin:
    """Mixin class that provides streaming LLM capabilities to agents.
    
    Add this to your agent classes to enable token-by-token streaming:
        
        class PMAgent(StreamingMixin):
            async def run(self, state):
                async for token in self.stream_llm("Analyze: " + state.user_prompt):
                    yield token
    """

    # Shared LLM client instance
    _llm_client: Optional[LLMClient] = None

    @classmethod
    def get_llm_client(cls) -> LLMClient:
        """Get or create shared LLM client instance."""
        if cls._llm_client is None:
            settings = get_settings()
            cls._llm_client = LLMClient(
                base_url=settings.llm_gateway_url or "http://ai-service:8003",
                timeout=120.0,
            )
        return cls._llm_client

    async def stream_llm(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        agent_name: str = "agent",
        step_name: str = "run",
        workflow_id: str = "default",
        project_id: str = "default",
        task_type: str = "chat",
    ) -> AsyncGenerator[str, None]:
        """Stream LLM response token by token.
        
        This yields individual tokens/deltas that can be streamed to the frontend
        in real-time, providing the progressive display effect like Claude Code.
        
        Args:
            prompt: User prompt
            system_prompt: Optional system instructions
            agent_name: Name of the agent (for tracking)
            step_name: Step name (for tracking)
            workflow_id: Workflow ID
            project_id: Project ID
            task_type: Task type (plan, codegen, qa, security, chat)
            
        Yields:
            Text deltas (individual tokens or short phrases)
        """
        from ..clients.llm_client import LLMMessage, LLMRole, LLMTaskType
        
        client = self.get_llm_client()
        
        # Build messages
        messages = []
        
        if system_prompt:
            messages.append(LLMMessage(
                role=LLMRole.SYSTEM,
                content=system_prompt,
            ))
        
        messages.append(LLMMessage(
            role=LLMRole.USER,
            content=prompt,
        ))
        
        # Create request
        request = LLMCompletionRequest(
            workflow_id=workflow_id,
            project_id=project_id,
            agent_name=agent_name,
            step_name=step_name,
            task_type=LLMTaskType(task_type),
            messages=messages,
            max_tokens=4096,
        )
        
        # Stream tokens directly to caller
        async for event in client.stream(request):
            if event.event_type == "chunk":
                text_delta = event.data.get("textDelta", "")
                if text_delta:
                    yield text_delta
            elif event.event_type == "error":
                error_msg = event.data.get("message", "Unknown error")
                yield f"\n\n[Error: {error_msg}]"
                break
            elif event.event_type == "done":
                # Stream complete
                break

    async def stream_llm_with_metadata(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        agent_name: str = "agent",
        step_name: str = "run",
        workflow_id: str = "default",
        project_id: str = "default",
        task_type: str = "chat",
    ) -> AsyncGenerator[tuple[str, dict], None]:
        """Stream LLM response with metadata.
        
        Yields tuples of (token, metadata) where metadata includes:
        - is_first: bool - first token of the response
        - is_final: bool - last token of the response
        - model: str - model being used
        - provider: str - provider name
        
        Args:
            prompt: User prompt
            system_prompt: Optional system instructions
            agent_name: Name of the agent
            step_name: Step name
            workflow_id: Workflow ID
            project_id: Project ID
            task_type: Task type
            
        Yields:
            Tuples of (text_delta, metadata)
        """
        from ..clients.llm_client import LLMMessage, LLMRole, LLMTaskType
        
        client = self.get_llm_client()
        
        messages = []
        if system_prompt:
            messages.append(LLMMessage(
                role=LLMRole.SYSTEM,
                content=system_prompt,
            ))
        
        messages.append(LLMMessage(
            role=LLMRole.USER,
            content=prompt,
        ))
        
        request = LLMCompletionRequest(
            workflow_id=workflow_id,
            project_id=project_id,
            agent_name=agent_name,
            step_name=step_name,
            task_type=LLMTaskType(task_type),
            messages=messages,
            max_tokens=4096,
        )
        
        is_first = True
        model = ""
        provider = ""
        
        async for event in client.stream(request):
            if event.event_type == "meta":
                model = event.data.get("model", "")
                provider = event.data.get("provider", "")
            elif event.event_type == "chunk":
                text_delta = event.data.get("textDelta", "")
                if text_delta:
                    metadata = {
                        "is_first": is_first,
                        "is_final": False,
                        "model": model,
                        "provider": provider,
                    }
                    is_first = False
                    yield text_delta, metadata
            elif event.event_type == "done":
                metadata = {
                    "is_first": False,
                    "is_final": True,
                    "model": model,
                    "provider": provider,
                    "tokens_in": event.data.get("tokensIn", 0),
                    "tokens_out": event.data.get("tokensOut", 0),
                    "latency_ms": event.data.get("latencyMs", 0),
                    "cost_usd": event.data.get("costUsd", 0),
                }
                yield "", metadata
            elif event.event_type == "error":
                yield f"\n\n[Error: {event.data.get('message', 'Unknown error')}]", {"is_final": True}


# Global instance for simple access
_streaming_mixin = StreamingMixin()


async def stream_llm(
    prompt: str,
    system_prompt: Optional[str] = None,
    agent_name: str = "agent",
    step_name: str = "run",
    workflow_id: str = "default",
    project_id: str = "default",
    task_type: str = "chat",
) -> AsyncGenerator[str, None]:
    """Convenience function for streaming LLM responses."""
    async for token in _streaming_mixin.stream_llm(
        prompt=prompt,
        system_prompt=system_prompt,
        agent_name=agent_name,
        step_name=step_name,
        workflow_id=workflow_id,
        project_id=project_id,
        task_type=task_type,
    ):
        yield token