import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import http from 'http';
import { config } from './config.js';
import { aiRoutes } from './routes/api.js';
import { llmRoutes } from './routes/llm.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { disconnectKafka } from './kafka/billing.js';
import { disconnectLlmKafka } from './kafka/ai_llm_events.js';
import { 
  initWebSocketGateway, 
  shutdownWebSocketGateway 
} from './realtime/ws_gateway.js';
import { startWorkflowWorker, stopWorkflowWorker } from './workflows/worker/workflow_worker.js';
import { getWorkflowRegistry } from './workflows/registry.js';
import { projectGenerationWorkflow } from './workflows/definitions/project_generation.workflow.js';
import { startExecutionWorker, stopExecutionWorker } from './execution/index.js';
import { registerExecutionRoutes } from './controllers/execution_controller.js';
import { disconnectExecutionKafka } from './execution/index.js';

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
      origin: true,
    });

    await fastify.register(aiRoutes, { prefix: '/ai' });
    await fastify.register(llmRoutes, { prefix: '/ai/llm' });
    await registerWorkflowRoutes(fastify);
    await registerExecutionRoutes(fastify);

    fastify.get('/health', async () => ({ status: 'ok', service: 'ai-service' }));

    await fastify.ready();
    
    // Get HTTP server for WebSocket
    httpServer = fastify.server;
    
    // Initialize WebSocket gateway
    await initWebSocketGateway(httpServer);
    console.log('[Main] WebSocket gateway initialized');

    // Register workflow definitions
    const registry = getWorkflowRegistry();
    registry.register(projectGenerationWorkflow);
    console.log('[Main] Workflow definitions registered');

    // Start workflow worker
    await startWorkflowWorker();
    console.log('[Main] Workflow worker started');

    // Start execution worker
    await startExecutionWorker();
    console.log('[Main] Execution worker started');

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
  await shutdownWebSocketGateway();
  await fastify.close();
  await disconnectKafka();
  await disconnectLlmKafka();
  await disconnectExecutionKafka();
  
  process.exit(0);
});

start();
