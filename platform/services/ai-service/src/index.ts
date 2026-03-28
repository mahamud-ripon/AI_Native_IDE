// Validate environment variables at startup
import '@workspace/config/env';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import http from 'http';
import { config } from './config.js';
import { aiRoutes } from './routes/api.js';
import { llmRoutes } from './routes/llm.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { adminConfigRoutes } from './routes/admin_config.js';
import { disconnectKafka } from './kafka/billing.js';
import { disconnectLlmKafka } from './kafka/ai_llm_events.js';
import { 
  initWebSocketGateway, 
  shutdownWebSocketGateway 
} from './realtime/ws_gateway.js';
import { startWorkflowWorker, stopWorkflowWorker } from './workflows/worker/workflow_worker.js';
import { getWorkflowRegistry } from './workflows/registry.js';
import { projectGenerationWorkflow } from './workflows/definitions/project_generation.workflow.js';
import { 
  startExecutionWorker, 
  stopExecutionWorker,
  initExecutionEventConsumer,
  shutdownExecutionEventConsumer,
  initExecutionEventProducer,
  shutdownExecutionEventProducer,
  disconnectExecutionKafka 
} from './execution/index.js';
import { registerExecutionRoutes } from './controllers/execution_controller.js';
import { setLLMProvider } from './coding/agent/index.js';
import { getGatewayLLMProvider } from './coding/agent/llm_adapter.js';

const fastify = Fastify({
  logger: true,
  serverFactory: (handler) => {
    const server = http.createServer(handler);
    return server;
  },
});

// Get underlying HTTP server for WebSocket
let httpServer: http.Server | null = null;

async function start() {
  try {
    await fastify.register(helmet);
    
    await fastify.register(cors, {
      origin: process.env.NODE_ENV === 'production'
        ? ['https://platform.io', /^https:\/\/.*\.platform\.io$/]
        : true,
      credentials: true,
    });

    await fastify.register(aiRoutes, { prefix: '/ai' });
    await fastify.register(llmRoutes, { prefix: '/ai/llm' });
    await registerWorkflowRoutes(fastify);
    await registerExecutionRoutes(fastify);
    await fastify.register(adminConfigRoutes);

    fastify.get('/health', async () => ({ status: 'ok', service: 'ai-service' }));

    await fastify.ready();
    
    // Get HTTP server for WebSocket
    httpServer = fastify.server;
    
    // Initialize WebSocket gateway
    await initWebSocketGateway(httpServer);
    console.log('[Main] WebSocket gateway initialized');

    // Register workflow definitions
    // Register workflow definitions
    const registry = getWorkflowRegistry();
    registry.register(projectGenerationWorkflow);
    console.log('[Main] Workflow definitions registered');

    // Initialize CodeAgent LLM provider
    setLLMProvider(getGatewayLLMProvider());
    console.log('[Main] LLM provider registered for CodeAgent');

    // Start workflow worker (optional - doesn't block if Kafka fails)
    try {
      await startWorkflowWorker();
      console.log('[Main] Workflow worker started');
    } catch (err) {
      console.warn('[Main] Workflow worker failed to start (Kafka may be unavailable):', err);
    }

    // Start execution worker (optional - doesn't block if Kafka fails)
    try {
      await startExecutionWorker();
      console.log('[Main] Execution worker started');
    } catch (err) {
      console.warn('[Main] Execution worker failed to start (Kafka may be unavailable):', err);
    }

    // Start execution event producer (Phase-7 partitioned Kafka topics)
    try {
      await initExecutionEventProducer();
      console.log('[Main] Execution event producer started');
    } catch (err) {
      console.warn('[Main] Execution event producer failed to start:', err);
    }

    // Start execution event consumer (bridges Kafka -> WebSocket)
    try {
      await initExecutionEventConsumer();
      console.log('[Main] Execution event consumer started');
    } catch (err) {
      console.warn('[Main] Execution event consumer failed to start:', err);
    }

    await fastify.listen({ port: config.port, host: '0.0.0.0' });

    console.log(`AI Service running on port ${config.port}`);
    console.log(`WebSocket available at ws://localhost:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('[Main] SIGTERM received, shutting down...');
  
  // Stop workers
  await stopWorkflowWorker();
  await stopExecutionWorker();
  await shutdownExecutionEventConsumer();
  await shutdownExecutionEventProducer();
  
  // Shutdown WebSocket gateway
  await shutdownWebSocketGateway();
  
  // Close Fastify
  await fastify.close();
  
  // Disconnect Kafka
  await disconnectKafka();
  await disconnectLlmKafka();
  await disconnectExecutionKafka();
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Main] SIGINT received, shutting down...');
  
  await stopWorkflowWorker();
  await stopExecutionWorker();
  await shutdownExecutionEventConsumer();
  await shutdownExecutionEventProducer();
  await shutdownWebSocketGateway();
  await fastify.close();
  await disconnectKafka();
  await disconnectLlmKafka();
  await disconnectExecutionKafka();
  
  process.exit(0);
});

start();

process.on('unhandledRejection', (reason) => {
  console.error('[ai-service] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[ai-service] Uncaught Exception:', error);
  process.exit(1);
});
