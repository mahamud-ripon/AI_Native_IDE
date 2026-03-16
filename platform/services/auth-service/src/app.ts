import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import { authRoutes } from './controllers/auth_controller';

dotenv.config();

export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: true,
  });

  // Plugins
  await app.register(fastifyCors, {
    origin: process.env.NODE_ENV === 'production' ? ['https://platform.io', /.*\.platform\.io$/] : true,
    credentials: true,
  });

  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'fallback-super-secret', // Securely signed cookies
    hook: 'onRequest',
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Healthcheck Route
  app.get('/health', async () => {
    return { status: 'ok', service: 'auth-service' };
  });

  // Register Auth Routes
  app.register(authRoutes, { prefix: '/api/v1/auth' });

  return app;
};
