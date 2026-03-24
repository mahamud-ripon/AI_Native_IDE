// Validate environment variables at startup
import '@workspace/config/env';

import buildApp from './app';
import { config } from './config';
import { kafkaService, storageService } from './services';
import { createLogger } from './lib/logger';

const logger = createLogger('server');

async function start() {
  try {
    // Connect to Kafka
    await kafkaService.connect();

    // Initialize storage (create bucket if needed)
    const storageInitialized = await storageService.initialize();
    if (!storageInitialized) {
      logger.warn('Storage initialization failed, but continuing...');
    }

    // Build and start Fastify app
    const app = await buildApp();

    await app.listen({ port: config.port, host: '0.0.0.0' });

    logger.info(`Project service running on port ${config.port}`, {
      port: config.port,
      nodeEnv: config.nodeEnv,
    });

    // Log all registered routes in development
    if (config.nodeEnv === 'development') {
      const routes = app.printRoutes();
      logger.debug('Registered routes', { routes });
    }
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();
