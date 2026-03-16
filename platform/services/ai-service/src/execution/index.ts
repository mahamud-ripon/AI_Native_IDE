/**
 * Execution Control Plane Module (Phase-6A / Phase-6C)
 * 
 * Exports execution task service, worker, types, and event streaming.
 */

// Types
export * from './execution_types.js';

// Event Types (Phase-6C) - exclude duplicates
export {
  // Lifecycle Events
  LifecycleEventType,
  ProgressEventType,
  PatchEventType,
  ExecutionEventType,
  // Event Interfaces
  BaseExecutionEvent,
  EventMetadata,
  // Lifecycle Events
  TaskQueuedEvent,
  TaskStartedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskTimeoutEvent,
  TaskCancelledEvent,
  TaskRetryingEvent,
  LifecycleEvent,
  // Progress Events
  StageStartedEvent,
  StageCompletedEvent,
  ProgressUpdateEvent,
  AgentPlanningEvent,
  AgentGeneratingEvent,
  AgentStepEvent,
  ProgressEvent,
  // Patch Events
  PatchGeneratedEvent,
  PatchValidatingEvent,
  PatchValidationPassedEvent,
  PatchValidationFailedEvent,
  PatchApplyingEvent,
  PatchAppliedEvent,
  FileModifiedEvent,
  RollbackStartedEvent,
  RollbackCompletedEvent,
  PatchEvent,
  // Union
  ExecutionEvent,
  // Kafka
  KafkaExecutionMessage,
  // Channels
  EXECUTION_CHANNELS,
  EXECUTION_STREAM_KEYS,
  // Helpers
  getTopicForEvent,
  isTerminalEvent,
  isLifecycleEvent,
  isProgressEvent,
  isPatchEvent,
} from './execution_event_types.js';

// Service
export {
  ExecutionTaskService,
  getExecutionTaskService,
  disconnectExecutionKafka,
} from './execution_task_service.js';

// Worker
export {
  startExecutionWorker,
  stopExecutionWorker,
  getWorkerStatus,
} from './execution_worker.js';

// Event Producer (Phase-6C)
export {
  initExecutionEventProducer,
  shutdownExecutionEventProducer,
  getProducerStatus,
  emitEvent,
  emitEventBatch,
  emitTaskQueued,
  emitTaskStarted,
  emitProgressUpdate,
  emitPatchGenerated,
  emitFileModified,
  emitTaskCompleted,
  emitTaskFailed,
} from './execution_event_producer.js';

// Event Consumer (Phase-6C)
export {
  initExecutionEventConsumer,
  shutdownExecutionEventConsumer,
  getConsumerStatus,
  getEventsSince,
  getAllEvents,
  getLatestEvent,
} from './execution_event_consumer.js';
