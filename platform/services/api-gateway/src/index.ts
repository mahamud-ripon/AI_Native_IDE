// Load environment variables first - from platform root
import { config } from 'dotenv';
import { resolve } from 'path';
// Go up from services/api-gateway/src to platform root
config({ path: resolve(__dirname, '../../../.env') });

// Validate environment variables at startup
import '@workspace/config/env';

import { buildApp } from './app';

const PORT = parseInt(process.env.PORT || '8000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const startServer = async () => {
  try {
    const app = await buildApp();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`🚪 API Gateway running at http://${HOST}:${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

startServer();

