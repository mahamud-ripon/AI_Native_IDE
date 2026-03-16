/**
 * Realtime Infrastructure Module
 * 
 * Provides WebSocket-based real-time communication for AI agent streaming
 * with horizontal scaling support via Redis Pub/Sub.
 */

// PubSub Registry
export {
  pubSubRegistry,
  ConnectionInfo,
  SubscriptionInfo,
} from './pubsub_registry.js';

// Redis Stream Bridge
export {
  initRedisStreamBridge,
  shutdownRedisStreamBridge,
  subscribeToChannel,
  unsubscribeFromChannel,
  subscribeToProject,
  unsubscribeFromProject,
  subscribeToAgentStreams,
  subscribeToWorkflowEvents,
  publishAgentStream,
  publishWorkflowEvent,
  AgentStreamMessage,
  WorkflowEventMessage,
  RealtimeMessage,
  getBridgeStatus,
} from './redis_stream_bridge.js';

// WebSocket Gateway
export {
  initWebSocketGateway,
  shutdownWebSocketGateway,
  getGatewayStatus,
  getConnection,
  sendToConnection,
  broadcastToProject,
  broadcastToUser,
} from './ws_gateway.js';

// Agent Stream Publisher
export {
  publishStreamStart,
  publishStreamChunk,
  publishStreamEnd,
  publishStepUpdate,
  publishStepCompleted,
  publishStepFailed,
  publishWorkflowCompleted,
  publishWorkflowFailed,
  StreamStartPayload,
  StreamChunkPayload,
  StreamEndPayload,
  StepUpdatePayload,
} from './agent_stream_publisher.js';
