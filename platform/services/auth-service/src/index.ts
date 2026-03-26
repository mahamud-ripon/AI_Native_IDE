// Validate environment variables at startup
import '@workspace/config/env';

import { buildApp } from './app';

const PORT = parseInt(process.env.PORT || '3100', 10);
const HOST = process.env.HOST || '0.0.0.0';

const startServer = async () => {
  try {
    const app = await buildApp();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`🔐 Auth Service running at http://${HOST}:${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

startServer();

process.on('unhandledRejection', (reason) => {
  console.error('[auth-service] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[auth-service] Uncaught Exception:', error);
  process.exit(1);
});
