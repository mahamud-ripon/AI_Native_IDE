"""
Execution Stream

SSE (Server-Sent Events) parser for real-time execution events.
Handles heartbeat, reconnect logic, and fallback to polling.
"""

import asyncio
import json
import logging
from typing import AsyncGenerator, Optional, Callable

import httpx

from .execution_types import ExecutionEvent
from .execution_errors import StreamConnectionError

logger = logging.getLogger(__name__)


class ExecutionStream:
    """
    SSE stream handler for execution events.
    
    Features:
    - Heartbeat handling (ignores keepalive comments)
    - Reconnect with Last-Event-ID header
    - Fallback to polling on connection failure
    - Event parsing and ordering
    """
    
    POLL_INTERVAL_SECONDS = 1.5
    MAX_RECONNECT_ATTEMPTS = 3
    RECONNECT_DELAY_SECONDS = 1.0
    
    def __init__(
        self,
        client,  # ExecutionClient
        poll_fallback: bool = True
    ):
        """
        Initialize stream handler.
        
        Args:
            client: ExecutionClient instance for HTTP requests
            poll_fallback: Whether to fall back to polling on SSE failure
        """
        self.client = client
        self.poll_fallback = poll_fallback
    
    async def stream(
        self,
        task_id: str,
        last_event_id: Optional[int] = None
    ) -> AsyncGenerator[ExecutionEvent, None]:
        """
        Stream execution events via SSE.
        
        Args:
            task_id: Task to stream events for
            last_event_id: Resume from this event ID (for reconnect)
            
        Yields:
            ExecutionEvent objects as they occur
        """
        try:
            async for event in self._stream_sse(task_id, last_event_id):
                yield event
        except StreamConnectionError as e:
            logger.warning(f"SSE stream failed: {e.message}, falling back to polling")
            
            if self.poll_fallback:
                async for event in self._stream_polling(task_id, last_event_id):
                    yield event
            else:
                raise
    
    async def _stream_sse(
        self,
        task_id: str,
        last_event_id: Optional[int] = None
    ) -> AsyncGenerator[ExecutionEvent, None]:
        """
        Stream events via SSE.
        
        Handles:
        - Event parsing
        - Heartbeat (keepalive) comments
        - Reconnect with Last-Event-ID
        """
        url = self.client.get_stream_url(task_id)
        headers = self.client.get_stream_headers()
        
        # Add Last-Event-ID for reconnect
        if last_event_id is not None:
            headers["Last-Event-ID"] = str(last_event_id)
        
        reconnect_attempts = 0
        last_sequence = last_event_id or -1
        
        while reconnect_attempts < self.MAX_RECONNECT_ATTEMPTS:
            try:
                async with httpx.AsyncClient(timeout=self.client.timeout) as client:
                    async with client.stream("GET", url, headers=headers) as response:
                        response.raise_for_status()
                        
                        current_event_type = None
                        current_data = {}
                        
                        async for line in response.aiter_lines():
                            # Handle heartbeat/keepalive
                            if line.startswith(":"):
                                continue
                            
                            # Parse event type
                            if line.startswith("event: "):
                                current_event_type = line[7:].strip()
                                continue
                            
                            # Parse data
                            if line.startswith("data: "):
                                try:
                                    current_data = json.loads(line[6:])
                                except json.JSONDecodeError:
                                    logger.warning(f"Failed to parse SSE data: {line}")
                                    continue
                            
                            # Empty line indicates end of event
                            if line == "":
                                if current_data:
                                    event = ExecutionEvent.from_dict({
                                        **current_data,
                                        "eventType": current_event_type or "unknown",
                                    })
                                    
                                    # Update last sequence for reconnect
                                    if event.sequence > last_sequence:
                                        last_sequence = event.sequence
                                        yield event
                                    
                                    # Terminal event ends stream
                                    if event.is_terminal():
                                        return
                                    
                                    # Reset for next event
                                    current_event_type = None
                                    current_data = {}
                
                # Stream ended normally
                return
                
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500:
                    reconnect_attempts += 1
                    if reconnect_attempts < self.MAX_RECONNECT_ATTEMPTS:
                        await asyncio.sleep(self.RECONNECT_DELAY_SECONDS * reconnect_attempts)
                        continue
                raise StreamConnectionError(f"HTTP {e.response.status_code}", e)
                
            except httpx.RequestError as e:
                reconnect_attempts += 1
                if reconnect_attempts < self.MAX_RECONNECT_ATTEMPTS:
                    await asyncio.sleep(self.RECONNECT_DELAY_SECONDS * reconnect_attempts)
                    continue
                raise StreamConnectionError(f"Connection failed: {str(e)}", e)
        
        raise StreamConnectionError(f"Max reconnect attempts ({self.MAX_RECONNECT_ATTEMPTS}) exceeded")
    
    async def _stream_polling(
        self,
        task_id: str,
        last_sequence: Optional[int] = None
    ) -> AsyncGenerator[ExecutionEvent, None]:
        """
        Fallback polling for events.
        
        Used when SSE connection fails.
        """
        last_seq = last_sequence or -1
        
        while True:
            try:
                # Get events from API
                response = await self.client.get_events(task_id, limit=100)
                events = response.get("events", [])
                
                for event_data in events:
                    sequence = event_data.get("sequence", 0)
                    
                    if sequence > last_seq:
                        last_seq = sequence
                        event = ExecutionEvent.from_dict(event_data)
                        yield event
                        
                        if event.is_terminal():
                            return
                
                # Wait before next poll
                await asyncio.sleep(self.POLL_INTERVAL_SECONDS)
                
            except Exception as e:
                logger.error(f"Polling error: {e}")
                await asyncio.sleep(self.POLL_INTERVAL_SECONDS * 2)


async def stream_events(
    client,
    task_id: str,
    progress_callback: Optional[Callable[[ExecutionEvent], None]] = None,
    last_event_id: Optional[int] = None
) -> AsyncGenerator[ExecutionEvent, None]:
    """
    Convenience function to stream events with optional callback.
    
    Args:
        client: ExecutionClient instance
        task_id: Task to stream
        progress_callback: Optional callback for each event
        last_event_id: Resume from this event
        
    Yields:
        ExecutionEvent objects
    """
    stream = ExecutionStream(client)
    
    async for event in stream.stream(task_id, last_event_id):
        if progress_callback:
            try:
                progress_callback(event)
            except Exception as e:
                logger.warning(f"Progress callback error: {e}")
        
        yield event
