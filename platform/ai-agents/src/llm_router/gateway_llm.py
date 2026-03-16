"""
LangChain-compatible LLM wrapper for the LLM Gateway.

This module provides LangChain-compatible LLM classes that route calls
through the LLM Gateway instead of direct provider SDK calls.

Architecture:
    Agent → LangChain → GatewayLLM → LLMClient → HTTP → LLM Gateway → Provider
"""

from typing import Any, Dict, List, Optional

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from ..clients.llm_client import (
    LLMClient,
    LLMClientError,
    LLMCompletionRequest,
    LLMCompletionResponse,
    LLMMessage,
    LLMQuotaExceededError,
    LLMRole,
    LLMStreamEvent,
    LLMTaskType,
)
from ..config.settings import get_settings


class GatewayChatModel(BaseChatModel):
    """
    LangChain-compatible ChatModel that routes through the LLM Gateway.
    
    This replaces direct provider SDK calls (ChatAnthropic, ChatOpenAI) with
    calls to the centralized LLM Gateway for:
    - Unified routing and fallback
    - Cost tracking and quotas
    - Caching
    - Observability
    
    Usage:
        llm = GatewayChatModel(task_type="codegen")
        response = await llm.ainvoke([HumanMessage(content="Write a function")])
    """

    task_type: LLMTaskType = LLMTaskType.CHAT
    agent_name: str = "unknown"
    step_name: str = "unknown"
    workflow_id: str = "unknown"
    project_id: str = "unknown"
    temperature: float = 0.7
    max_tokens: int = 4096
    model_hint: Optional[str] = None
    
    client: Optional[LLMClient] = None
    user_id: Optional[str] = None
    org_id: Optional[str] = None

    def __init__(self, **data):
        super().__init__(**data)
        settings = get_settings()
        self.client = LLMClient(
            base_url=settings.llm_gateway_url,
            timeout=settings.llm_gateway_timeout,
        )
        self.user_id = data.get("user_id") or settings.default_user_id
        self.org_id = data.get("org_id") or settings.default_org_id

    @property
    def _llm_type(self) -> str:
        return "gateway-chat-model"

    @property
    def _identifying_params(self) -> Dict[str, Any]:
        return {
            "task_type": self.task_type.value,
            "agent_name": self.agent_name,
            "step_name": self.step_name,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

    def _convert_messages(self, messages: List[BaseMessage]) -> List[LLMMessage]:
        """Convert LangChain messages to gateway format."""
        result = []
        for msg in messages:
            if isinstance(msg, SystemMessage):
                result.append(LLMMessage(role=LLMRole.SYSTEM, content=msg.content))
            elif isinstance(msg, HumanMessage):
                result.append(LLMMessage(role=LLMRole.USER, content=msg.content))
            elif isinstance(msg, AIMessage):
                result.append(LLMMessage(role=LLMRole.ASSISTANT, content=msg.content))
            else:
                # Fallback for other message types
                role = LLMRole.USER if msg.type == "human" else LLMRole.ASSISTANT
                result.append(LLMMessage(role=role, content=str(msg.content)))
        return result

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Synchronous generation (calls async internally)."""
        import asyncio
        
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(self._agenerate(messages, stop, run_manager, **kwargs))

    async def _agenerate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Async generation through the gateway."""
        request = LLMCompletionRequest(
            workflow_id=self.workflow_id,
            project_id=self.project_id,
            agent_name=self.agent_name,
            step_name=self.step_name,
            task_type=self.task_type,
            messages=self._convert_messages(messages),
            temperature=kwargs.get("temperature", self.temperature),
            max_tokens=kwargs.get("max_tokens", self.max_tokens),
            model_hint=self.model_hint,
            user_id=self.user_id,
            org_id=self.org_id,
        )

        try:
            response = await self.client.complete(request, self.user_id, self.org_id)
            
            message = AIMessage(content=response.output_text)
            generation = ChatGeneration(
                message=message,
                generation_info={
                    "request_id": response.request_id,
                    "provider": response.provider,
                    "model": response.model,
                    "tokens_in": response.tokens_in,
                    "tokens_out": response.tokens_out,
                    "latency_ms": response.latency_ms,
                    "cost_usd": response.cost_usd,
                    "cache_hit": response.cache_hit,
                },
            )
            
            return ChatResult(generations=[generation])

        except LLMQuotaExceededError as e:
            raise ValueError(f"Quota exceeded: {e.message} (limit: {e.limit}, current: {e.current})")
        except LLMClientError as e:
            raise ValueError(f"LLM Gateway error: {e.message}")

    @classmethod
    def from_agent(
        cls,
        agent_name: str,
        task_type: LLMTaskType,
        workflow_id: str = "unknown",
        project_id: str = "unknown",
        **kwargs,
    ) -> "GatewayChatModel":
        """
        Create a GatewayChatModel configured for a specific agent.
        
        Args:
            agent_name: Name of the agent (e.g., "backend_agent")
            task_type: Type of task (e.g., LLMTaskType.CODEGEN)
            workflow_id: Workflow ID for tracing
            project_id: Project ID for context
            **kwargs: Additional parameters (temperature, max_tokens, etc.)
            
        Returns:
            Configured GatewayChatModel instance
        """
        return cls(
            agent_name=agent_name,
            task_type=task_type,
            workflow_id=workflow_id,
            project_id=project_id,
            **kwargs,
        )


def create_gateway_llm(
    agent_name: str,
    task_type: str = "chat",
    workflow_id: str = "unknown",
    project_id: str = "unknown",
    **kwargs,
) -> GatewayChatModel:
    """
    Factory function to create a GatewayChatModel.
    
    This is the recommended way to create LLM instances after gateway integration.
    
    Args:
        agent_name: Name of the agent
        task_type: Task type string (plan, codegen, qa, security, chat)
        workflow_id: Workflow ID for tracing
        project_id: Project ID for context
        **kwargs: Additional parameters
        
    Returns:
        GatewayChatModel instance
    """
    task_enum = LLMTaskType(task_type)
    return GatewayChatModel.from_agent(
        agent_name=agent_name,
        task_type=task_enum,
        workflow_id=workflow_id,
        project_id=project_id,
        **kwargs,
    )
